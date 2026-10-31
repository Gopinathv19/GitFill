import { MuseClient } from "@/lib/ai/client";
import type { MemoryRecorder } from "@/lib/agent/recorder";
import { getSnapshot } from "@/lib/connectors/cache";
import type { GitHubClient } from "@/lib/connectors/github/client";
import { explainCode } from "./explain";
import type { AskRequest } from "./schemas";

/**
 * Interactive code question over a GitHub repository: cached snapshot, then the explainer.
 * Shared by the workspace ask/chat paths and scripts/bench-ask.ts so both measure the same pipeline.
 */
export async function answerGitHubQuestion(opts: { url: string; branch?: string; client: GitHubClient; request: AskRequest; recorder: MemoryRecorder }) {
  const snapshot = await getSnapshot(opts.url, opts.branch, { client: opts.client, recorder: opts.recorder });
  const result = await explainCode({ client: new MuseClient(opts.recorder.modelObserver()), snapshot, request: opts.request, recorder: opts.recorder });
  return { snapshot, result };
}
