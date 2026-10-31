import { MuseClient } from "@/lib/ai/client";
import type { MemoryRecorder } from "@/lib/agent/recorder";
import { env } from "@/lib/config/env";
import { getSnapshot } from "@/lib/connectors/cache";
import type { GitHubClient } from "@/lib/connectors/github/client";
import { canonicalRepoUrl, parseGitHubUrl } from "@/lib/connectors/github/url";
import { getRepoStore, RepoStoreError } from "@/lib/repo-store";
import { explainCode, type ExplanationResult } from "./explain";
import { explainWithSearch } from "./explain-search";
import type { AskRequest } from "./schemas";

export interface AnswerSource {
  displayName: string;
  version: string;
  branch: string;
}

/**
 * Interactive code question over a GitHub repository. With GITFILL_SEARCH=agentic the agent searches
 * the repository on demand (repo store + search tools); otherwise, or if the store cannot serve the
 * repository, it uses the cached 200-file snapshot. Shared by the workspace ask/chat paths and
 * scripts/bench-ask.ts so both measure the same pipeline.
 */
export async function answerGitHubQuestion(opts: { url: string; branch?: string; client: GitHubClient; request: AskRequest; recorder: MemoryRecorder; mode?: "snapshot" | "agentic" }): Promise<{ source: AnswerSource; result: ExplanationResult }> {
  const muse = new MuseClient(opts.recorder.modelObserver());
  if ((opts.mode ?? env().GITFILL_SEARCH) === "agentic") {
    try {
      return await answerWithSearch(opts, muse);
    } catch (err) {
      if (!(err instanceof RepoStoreError)) throw err;
      const fallback = await opts.recorder.start("step", "fallback_to_snapshot", { reason: err.code });
      await fallback.fail(err.message);
    }
  }
  const snapshot = await getSnapshot(opts.url, opts.branch, { client: opts.client, recorder: opts.recorder });
  const result = await explainCode({ client: muse, snapshot, request: opts.request, recorder: opts.recorder });
  return { source: { displayName: snapshot.displayName, version: snapshot.version, branch: snapshot.branch }, result };
}

async function answerWithSearch(opts: { url: string; branch?: string; client: GitHubClient; request: AskRequest; recorder: MemoryRecorder }, muse: MuseClient) {
  const ref = parseGitHubUrl(opts.url);
  // Resolving the branch with the caller's own client is the access check: a repository the caller
  // cannot read fails here, before anything is served from the shared store.
  const headStep = await opts.recorder.start("step", "repo_head", { repository: `${ref.owner}/${ref.repo}` });
  const [repo, commit] = await Promise.all([opts.client.getRepo(ref.owner, ref.repo), opts.client.getCommit(ref.owner, ref.repo, opts.branch ?? ref.branch ?? "HEAD")]);
  const branch = opts.branch ?? ref.branch ?? repo.defaultBranch;
  await headStep.succeed({ branch, commit: commit.sha.slice(0, 7), sizeMb: Math.round(repo.sizeKb / 1024) });

  const store = getRepoStore();
  const openStep = await opts.recorder.start("step", "repo_open", { store: store.kind });
  let opened;
  try {
    opened = await store.open({ owner: ref.owner, repo: ref.repo, sha: commit.sha, token: opts.client.gitFetchToken(), sizeKb: repo.sizeKb });
  } catch (err) {
    await openStep.fail(err instanceof Error ? err.message : "open failed");
    throw err;
  }
  await openStep.succeed({ origin: opened.origin, ms: opened.ms, store: store.kind });

  const [owner, name] = repo.fullName.split("/");
  const meta = { connector: "github", sourceUrl: canonicalRepoUrl({ owner: owner!, repo: name! }), version: commit.sha, displayName: repo.fullName, branch, description: repo.description };
  const result = await explainWithSearch({ client: muse, source: opened.source, meta, request: opts.request, recorder: opts.recorder });
  return { source: { displayName: repo.fullName, version: commit.sha, branch }, result };
}
