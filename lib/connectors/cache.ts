import { GitHubClient } from "./github/client";
import { ingestGitHubRepository } from "./github/ingest";
import { canonicalRepoUrl, parseGitHubUrl } from "./github/url";
import type { RunRecorder } from "@/lib/agent/recorder";
import { retrieverFor } from "@/lib/memora/retriever";
import type { SourceSnapshot } from "./types";

/**
 * In-memory snapshot cache for interactive features (chat questions, diagrams). Keyed by
 * repository and branch. Before a cached snapshot is served, the caller's own GitHub client
 * must resolve the branch head: that both detects new commits and proves the caller can
 * read the repository, so one user's private snapshot is never served to another.
 * Repository content never touches the database.
 */
interface Entry {
  snapshot: SourceSnapshot;
  storedAt: number;
}

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 12;
const g = globalThis as unknown as { __gitfillSnapshots?: Map<string, Entry> };
const cache = (g.__gitfillSnapshots ??= new Map<string, Entry>());

export async function getSnapshot(url: string, branch: string | undefined, opts: { client: GitHubClient; recorder?: RunRecorder }): Promise<SourceSnapshot> {
  const ref = parseGitHubUrl(url);
  const client = opts.client;
  const key = `${canonicalRepoUrl(ref)}@${branch ?? ref.branch ?? ""}`;
  const step = await opts.recorder?.start("step", "snapshot", { key });
  const hit = cache.get(key);
  let cacheState = hit ? "expired" : "miss";
  if (hit && Date.now() - hit.storedAt < TTL_MS) {
    // Throws (404/401) when this caller cannot read the repository, so the hit is never served.
    const head = await client.getCommit(ref.owner, ref.repo, hit.snapshot.branch);
    if (head.sha === hit.snapshot.version) {
      await step?.succeed({ cache: "hit", files: hit.snapshot.files.length, commit: hit.snapshot.version.slice(0, 7) });
      return hit.snapshot;
    }
    cacheState = "stale";
  }
  const snapshot = await ingestGitHubRepository({ url, branch, client, recorder: opts.recorder });
  await step?.succeed({ cache: cacheState, files: snapshot.files.length, commit: snapshot.version.slice(0, 7) });
  remember(key, snapshot);
  // Warm the retrieval index without delaying the caller; questions fall back until it is ready.
  void retrieverFor(snapshot)?.ensureIndexed({ waitMs: 0 });
  return snapshot;
}

/** Stores a snapshot produced elsewhere (e.g. by a job) for later interactive use. */
export function remember(key: string, snapshot: SourceSnapshot): void {
  cache.set(key, { snapshot, storedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** Empties the snapshot cache, so benchmarks can measure cold questions. */
export function forgetSnapshots(): void {
  cache.clear();
}

export function snapshotCacheKey(url: string, branch?: string): string {
  const ref = parseGitHubUrl(url);
  return `${canonicalRepoUrl(ref)}@${branch ?? ref.branch ?? ""}`;
}
