import { execFile } from "node:child_process";
import { mkdir, open, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ArchiveCache } from "./archive-cache";
import { GitSource } from "./code-source";
import { git, GitError, githubAuthConfig } from "./git";
import { RepoStoreError, validateOpen, type OpenRequest, type OpenResult, type RepoStore } from "./types";

const run = promisify(execFile);

export interface LocalGitStoreOptions {
  /** Directory holding <owner>/<repo>.git bare repositories. */
  root: string;
  /** Shared second-level cache (directory or Cloud Storage); optional. */
  archive?: ArchiveCache;
  maxRepoMb?: number;
  maxTotalGb?: number;
  /** Where to fetch from; GitHub by default. Tests point it at local repositories. */
  remoteUrl?: (owner: string, repo: string) => string;
  /** Transports git may use; "https" by default. */
  allowProtocols?: string;
}

/** Marker next to (not inside) each repo dir, so touching it never changes what gets archived. */
const lastUsedFile = (dir: string) => `${dir}.last-used`;
const LOCK_STALE_MS = 3 * 60_000;
const EVICT_EVERY_MS = 10 * 60_000;

/**
 * Bare git repositories on local disk, one commit fetched at a time (`fetch --depth 1 <sha>`).
 * No working tree is ever checked out, so nothing in the repository can run. Used in-process for
 * local development and inside the repo service (scripts/repo-service.ts) in the cloud.
 */
export class LocalGitStore implements RepoStore {
  readonly kind = "local";
  private readonly inflight = new Map<string, Promise<OpenResult["origin"]>>();
  private readonly sources = new Map<string, GitSource>();
  private lastEviction = 0;

  constructor(private readonly opts: LocalGitStoreOptions) {}

  async open(req: OpenRequest): Promise<OpenResult> {
    validateOpen(req);
    const maxKb = (this.opts.maxRepoMb ?? 1500) * 1024;
    if (req.sizeKb && req.sizeKb > maxKb) throw new RepoStoreError(`Repository is ${Math.round(req.sizeKb / 1024)} MB, above the ${maxKb / 1024} MB limit.`, "too_large");
    const started = Date.now();
    const owner = req.owner.toLowerCase();
    const repo = req.repo.toLowerCase();
    const dir = path.join(this.opts.root, owner, `${repo}.git`);
    const key = `${owner}/${repo}@${req.sha}`;

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.ensure(dir, owner, repo, req).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const origin = await pending;
    void this.touch(dir);
    void this.maybeEvict();

    let source = this.sources.get(key);
    if (!source) {
      source = new GitSource(dir, req.sha, `${req.owner}/${req.repo} @ ${req.sha.slice(0, 7)}`);
      this.sources.set(key, source);
      if (this.sources.size > 50) this.sources.delete(this.sources.keys().next().value!);
    }
    return { source, origin, ms: Date.now() - started };
  }

  private async ensure(dir: string, owner: string, repo: string, req: OpenRequest): Promise<OpenResult["origin"]> {
    if (await this.hasCommit(dir, req.sha)) return "disk";
    return withLock(`${dir}.lock`, async () => {
      if (await this.hasCommit(dir, req.sha)) return "disk";
      const archiveKey = `${owner}/${repo}.tar`;
      if (!(await exists(dir))) {
        if (this.opts.archive && (await this.restore(dir, archiveKey).catch(() => false)) && (await this.hasCommit(dir, req.sha))) return "archive";
        if (!(await exists(dir))) {
          await mkdir(dir, { recursive: true });
          await git(["init", "--bare", "-q", dir]);
        }
      }
      const url = this.opts.remoteUrl?.(req.owner, req.repo) ?? `https://github.com/${req.owner}/${req.repo}.git`;
      try {
        await git(["fetch", "--depth", "1", "--no-tags", "--quiet", url, req.sha], {
          cwd: dir,
          timeoutMs: 180_000,
          config: { ...githubAuthConfig(req.token), "gc.auto": "0" },
          allowProtocols: this.opts.allowProtocols,
        });
        // A ref keeps the commit's objects from ever being pruned.
        await git(["update-ref", `refs/gitfill/${req.sha}`, req.sha], { cwd: dir });
      } catch (err) {
        if (err instanceof GitError) throw new RepoStoreError(err.timedOut ? "Fetching the repository timed out." : `Could not fetch the commit: ${err.message}`, err.timedOut ? "timeout" : "fetch_failed");
        throw err;
      }
      if (!(await this.hasCommit(dir, req.sha))) throw new RepoStoreError("The fetched repository does not contain the commit.", "fetch_failed");
      if (this.opts.archive) void this.save(dir, archiveKey).catch((e) => console.warn("repo archive upload failed:", e instanceof Error ? e.message : e));
      return "github";
    });
  }

  private async hasCommit(dir: string, sha: string): Promise<boolean> {
    if (!(await exists(dir))) return false;
    return git(["cat-file", "-e", `${sha}^{commit}`], { cwd: dir }).then(
      () => true,
      () => false,
    );
  }

  private async restore(dir: string, key: string): Promise<boolean> {
    const tmp = `${dir}.restore.tar`;
    try {
      if (!(await this.opts.archive!.get(key, tmp))) return false;
      await mkdir(path.dirname(dir), { recursive: true });
      await run("tar", ["-xf", tmp, "-C", path.dirname(dir), "--no-same-owner", "--no-same-permissions"], { timeout: 120_000 });
      return exists(dir);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  /** Archives the repo under its lock (no fetch can change it mid-tar), then uploads outside the lock. */
  private async save(dir: string, key: string): Promise<void> {
    const tmp = `${dir}.save.${process.pid}.${Date.now()}.tar`;
    try {
      await withLock(`${dir}.lock`, () => run("tar", ["-cf", tmp, "-C", path.dirname(dir), path.basename(dir)], { timeout: 120_000 }));
      await this.opts.archive!.put(key, tmp);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }

  private async touch(dir: string) {
    const file = lastUsedFile(dir);
    const now = new Date();
    await utimes(file, now, now).catch(() => writeFile(file, "").catch(() => undefined));
  }

  /** Deletes least-recently-used repositories once the store passes its size budget. */
  private async maybeEvict() {
    if (Date.now() - this.lastEviction < EVICT_EVERY_MS) return;
    this.lastEviction = Date.now();
    const budgetKb = (this.opts.maxTotalGb ?? 5) * 1024 * 1024;
    const repos: Array<{ dir: string; kb: number; used: number }> = [];
    for (const owner of await readdir(this.opts.root).catch(() => [] as string[])) {
      for (const name of await readdir(path.join(this.opts.root, owner)).catch(() => [] as string[])) {
        if (!name.endsWith(".git")) continue;
        const dir = path.join(this.opts.root, owner, name);
        const kb = Number((await run("du", ["-sk", dir]).catch(() => ({ stdout: "0" }))).stdout.split(/\s/)[0]) || 0;
        const used = (await stat(lastUsedFile(dir)).catch(() => null))?.mtimeMs ?? 0;
        repos.push({ dir, kb, used });
      }
    }
    let total = repos.reduce((n, r) => n + r.kb, 0);
    for (const r of repos.sort((a, b) => a.used - b.used)) {
      if (total <= budgetKb) break;
      if (Date.now() - r.used < EVICT_EVERY_MS) continue; // in use recently
      await rm(r.dir, { recursive: true, force: true });
      await rm(lastUsedFile(r.dir), { force: true });
      this.sources.clear();
      total -= r.kb;
    }
  }
}

async function exists(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null)) !== null;
}

/** Cross-process lock (web, worker and repo service may share a disk): exclusive lock file, stale after 3 minutes. */
async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_STALE_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const age = Date.now() - ((await stat(lockPath).catch(() => null))?.mtimeMs ?? Date.now());
      if (age > LOCK_STALE_MS) await unlink(lockPath).catch(() => undefined);
      else if (Date.now() > deadline) throw new RepoStoreError("Timed out waiting for another fetch of this repository.", "timeout");
      else await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}
