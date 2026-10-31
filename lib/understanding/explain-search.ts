import type { ChatCompletionMessageParam, MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { EXPLAIN_SEARCH_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createSearchTools } from "@/lib/agent/search-tools";
import { runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceFile } from "@/lib/connectors/types";
import { parseAnswer } from "@/lib/evidence/citations";
import { normalizePath } from "@/lib/evidence/evidence";
import { buildRepoMap, type RepoMeta } from "@/lib/repo-store/repo-map";
import type { CodeSource } from "@/lib/repo-store/types";
import { diagramMermaid } from "./render";
import { finishAnswer, type AnswerMeta, type ExplanationResult } from "./explain";
import type { AskRequest } from "./schemas";

/** Same shape as the snapshot path's citations: `path:12` or `path:12-30` in backticks. */
const CITED_PATH = /`([\w@$.+()[\]-]+(?:\/[\w@$.+()[\]-]+)*):\d+(?:-\d+)?`/g;

/**
 * Code Q&A by on-demand search: the model starts from a code-built repo map (a few thousand
 * tokens) and pulls in only the code it needs through grep/read tools, instead of receiving
 * hundreds of files up front. Citations are verified against the same commit afterwards.
 */
export async function explainWithSearch(opts: {
  client: MuseClient;
  source: CodeSource;
  meta: AnswerMeta & RepoMeta;
  request: AskRequest;
  recorder: RunRecorder;
  history?: ChatCompletionMessageParam[];
}): Promise<ExplanationResult> {
  const mapStep = await opts.recorder.start("step", "repo_map", { repository: opts.meta.displayName });
  const map = await buildRepoMap(opts.source, opts.meta);
  await mapStep.succeed({ files: map.files, routes: map.routes, chars: map.text.length });

  const diagramLine =
    opts.request.diagram === "none"
      ? "Do not include a diagram."
      : opts.request.diagram === "auto"
        ? "Include a diagram only if the question is about flow, interactions, structure or relationships."
        : `Include a ${opts.request.diagram} diagram.`;
  const user = [`Question: ${opts.request.question}`, opts.request.focus ? `Focus: ${opts.request.focus}` : "", diagramLine, "", map.text].filter(Boolean).join("\n");

  const loopStep = await opts.recorder.start("step", "agent_loop", { promptChars: user.length, mode: "search" });
  const { result: answer, turns, toolCalls } = await runToolLoop<string>({
    client: opts.client,
    model: modelFor("explainer"),
    purpose: "explain_code",
    system: EXPLAIN_SEARCH_PROMPT,
    messages: [...(opts.history ?? []), { role: "user", content: user }],
    tools: createSearchTools(opts.source),
    recorder: opts.recorder,
    maxTurns: 10,
    maxToolCalls: 30,
    maxTokens: 8_000,
    reasoningEffort: "low",
    finishOnText: true,
    streamText: true,
    trimHistory: { keepTurns: 2, maxChars: 60_000 },
  });
  await loopStep.succeed({ turns, toolCalls });

  // Load exactly the files the answer cites, at the same commit, to verify every citation.
  const cited = [...new Set([...parseAnswer(answer).body.matchAll(CITED_PATH)].map((m) => normalizePath(m[1]!)))].slice(0, 40);
  const files = new Map<string, SourceFile>();
  await Promise.all(
    cited.map(async (path) => {
      const file = await opts.source.read(path);
      if (file) files.set(file.path, { path: file.path, category: "source", sizeBytes: 0, content: file.lines.join("\n"), lineCount: file.total });
    }),
  );
  const { spec, markdown, claims } = await finishAnswer({ answer, files, meta: opts.meta, request: opts.request, recorder: opts.recorder, refPrefix: "C", firstIndex: 1 });
  return { spec, markdown, mermaid: diagramMermaid(spec.diagram), claims, agent: { turns, toolCalls }, retrieval: "search" };
}
