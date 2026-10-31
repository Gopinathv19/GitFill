import path from "node:path";
import { env } from "@/lib/config/env";
import { archiveCacheFrom } from "./archive-cache";
import { LocalGitStore } from "./git-store";
import { RemoteRepoStore } from "./remote";
import type { RepoStore } from "./types";

export * from "./types";
export { SnapshotSource } from "./code-source";

const g = globalThis as unknown as { __gitfillRepoStore?: RepoStore };

/**
 * The repository store for this process: the remote repo service when REPO_SERVICE_URL is set
 * (cloud: storage and git work run on their own service), otherwise bare repositories on local disk.
 */
export function getRepoStore(): RepoStore {
  return (g.__gitfillRepoStore ??= env().REPO_SERVICE_URL ? new RemoteRepoStore(env().REPO_SERVICE_URL!, env().REPO_SERVICE_TOKEN) : localStore());
}

/** The on-disk store, configured from the environment (also used by the repo service itself). */
export function localStore(): LocalGitStore {
  const e = env();
  return new LocalGitStore({
    root: e.GIT_STORE_DIR ?? path.join(e.ARTIFACT_STORAGE_PATH, "repos"),
    archive: archiveCacheFrom(e.REPO_ARCHIVE_CACHE),
    maxRepoMb: e.GIT_STORE_MAX_REPO_MB,
    maxTotalGb: e.GIT_STORE_MAX_GB,
  });
}
