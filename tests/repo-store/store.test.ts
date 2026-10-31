import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirArchiveCache } from "@/lib/repo-store/archive-cache";
import { globToRegExp, SnapshotSource } from "@/lib/repo-store/code-source";
import { LocalGitStore } from "@/lib/repo-store/git-store";
import { RemoteRepoStore } from "@/lib/repo-store/remote";
import { createRepoService } from "@/lib/repo-store/service";
import { InvalidPatternError, RepoStoreError, type CodeSource } from "@/lib/repo-store/types";

let tmp: string;
let origin: string;
let sha: string;

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

function write(file: string, content: string | Buffer) {
  const p = path.join(origin, file);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const store = (root: string, archive?: string) =>
  new LocalGitStore({ root, archive: archive ? new DirArchiveCache(archive) : undefined, remoteUrl: () => `file://${origin}`, allowProtocols: "file" });

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "gitfill-store-"));
  origin = path.join(tmp, "origin");
  mkdirSync(origin);
  run(origin, "init", "-q", "-b", "main");
  run(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  write("README.md", "# Demo\nA demo app.\n");
  write("src/app.ts", "export function verifyClaim(ref: string) {\n  return extractIdentifiers(ref);\n}\n\nexport class Router {}\n");
  write("src/[id]/route.ts", "export async function GET() {}\n");
  write(".env", "SECRET_KEY=hunter2\n");
  write("node_modules/x/index.js", "export function verifyClaim() {}\n");
  write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  run(origin, "add", "-A");
  run(origin, "commit", "-q", "-m", "init");
  sha = run(origin, "rev-parse", "HEAD");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The same behaviour is required from every CodeSource implementation. */
async function checkSource(source: CodeSource) {
  const { paths } = await source.listFiles();
  expect(paths).toContain("src/app.ts");
  expect(paths).not.toContain(".env");
  expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
  expect(paths).not.toContain("logo.png");

  const { hits } = await source.grep("verifyClaim");
  expect(hits).toEqual([{ path: "src/app.ts", line: 1, text: "export function verifyClaim(ref: string) {" }]);
  expect((await source.grep("hunter2")).hits).toEqual([]);
  expect((await source.grep("route", { glob: "*.ts", ignoreCase: true })).hits.map((h) => h.path)).toEqual(["src/app.ts"]);
  expect((await source.grep("GET", { path: "src/[id]" })).hits.map((h) => h.path)).toEqual(["src/[id]/route.ts"]);

  expect(await source.read("src/app.ts", { start: 2, end: 3 })).toEqual({ path: "src/app.ts", lines: ["  return extractIdentifiers(ref);", "}"], start: 2, total: 5 });
  expect(await source.read(".env")).toBeNull();
  expect(await source.read("../origin/.env")).toBeNull();
  expect(await source.read("/etc/passwd")).toBeNull();
  expect(await source.read("missing.ts")).toBeNull();
  await expect(source.grep("(unclosed")).rejects.toBeInstanceOf(InvalidPatternError);
}

describe("LocalGitStore", () => {
  it("fetches one commit into a bare repo and serves list/grep/read with secrets hidden", async () => {
    const s = store(path.join(tmp, "store-a"));
    const first = await s.open({ owner: "acme", repo: "demo", sha });
    expect(first.origin).toBe("github");
    await checkSource(first.source);
    expect((await s.open({ owner: "acme", repo: "demo", sha })).origin).toBe("disk");
  });

  it("restores from the archive cache on a fresh instance instead of fetching", async () => {
    const archive = path.join(tmp, "archive");
    await store(path.join(tmp, "store-b"), archive).open({ owner: "acme", repo: "demo", sha });
    await new Promise((r) => setTimeout(r, 500)); // archive upload runs in the background
    const fresh = await store(path.join(tmp, "store-c"), archive).open({ owner: "acme", repo: "demo", sha });
    expect(fresh.origin).toBe("archive");
    expect((await fresh.source.grep("Router")).hits).toHaveLength(1);
  });

  it("rejects bad requests and repositories over the size limit", async () => {
    const s = store(path.join(tmp, "store-d"));
    await expect(s.open({ owner: "acme", repo: "demo", sha: "abc" })).rejects.toBeInstanceOf(RepoStoreError);
    await expect(s.open({ owner: "../x", repo: "demo", sha })).rejects.toBeInstanceOf(RepoStoreError);
    await expect(s.open({ owner: "acme", repo: "demo", sha, sizeKb: 5_000_000 })).rejects.toMatchObject({ code: "too_large" });
    await expect(s.open({ owner: "acme", repo: "demo", sha: "0".repeat(40) })).rejects.toMatchObject({ code: "fetch_failed" });
  });
});

describe("repo service", () => {
  it("serves the same results over HTTP and requires the service token", async () => {
    const server = createRepoService(store(path.join(tmp, "store-svc")), { token: "test-token-0123456789" });
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const remote = await new RemoteRepoStore(url, "test-token-0123456789").open({ owner: "acme", repo: "demo", sha });
      expect(remote.origin).toBe("github");
      await checkSource(remote.source);
      await expect(new RemoteRepoStore(url, "wrong-token-0123456789").open({ owner: "acme", repo: "demo", sha })).rejects.toBeInstanceOf(RepoStoreError);
    } finally {
      server.close();
    }
  });
});

describe("SnapshotSource", () => {
  it("behaves like the git source for the files it holds", async () => {
    const file = (p: string, content: string) => ({ path: p, category: "source" as const, sizeBytes: content.length, content, lineCount: content.split("\n").length });
    const source = new SnapshotSource({
      displayName: "acme/demo",
      version: "local",
      files: [
        file("README.md", "# Demo\nA demo app.\n"),
        file("src/app.ts", "export function verifyClaim(ref: string) {\n  return extractIdentifiers(ref);\n}\n\nexport class Router {}\n"),
        file("src/[id]/route.ts", "export async function GET() {}\n"),
        file(".env", "SECRET_KEY=hunter2\n"),
        file("node_modules/x/index.js", "export function verifyClaim() {}\n"),
      ],
      inventory: [{ path: "logo.png", sizeBytes: 8, selected: false }],
    });
    await checkSource(source);
  });
});

describe("globToRegExp", () => {
  it("matches common globs", () => {
    expect(globToRegExp("*.ts").test("lib/a/b.ts")).toBe(true);
    expect(globToRegExp("lib/**/*.ts").test("lib/a/b.ts")).toBe(true);
    expect(globToRegExp("lib/**/*.ts").test("lib/b.ts")).toBe(true);
    expect(globToRegExp("lib/*.ts").test("lib/a/b.ts")).toBe(false);
    expect(globToRegExp("*.{ts,tsx}").test("x/y.tsx")).toBe(true);
  });
});
