import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { ANALYST_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Claim } from "@/lib/evidence/evidence";
import { pruneAnalysisRefs, repositoryAnalysisSchema, type RepositoryAnalysis } from "./analysis-schema";
import type { RunRecorder } from "./recorder";
import { createRepositoryContext, createRepositoryTools, describeCompressed, type RepositoryContext } from "./repo-tools";
import { defineTool, runToolLoop } from "./tool-loop";

export interface AnalysisResult {
  analysis: RepositoryAnalysis;
  claims: Claim[];
  /** Refs the model cited that were never recorded (removed from the analysis). */
  danglingRefs: string[];
  turns: number;
  toolCalls: number;
  context: RepositoryContext;
}

/**
 * Full text sent up front for small and key files; large files go in as digests written once by
 * the light reader. Every turn re-sends this prefix, so it is the main cost of the loop.
 */
const INLINE_CONTEXT_CHARS = 110_000;

/**
 * Repository analysis agent: reads the snapshot through real tools, records claims that
 * application code verifies against the source lines, and returns a structured summary.
 */
export async function analyzeRepository(opts: {
  client: MuseClient;
  snapshot: SourceSnapshot;
  userRequest: string;
  recorder: RunRecorder;
  /** Reuse a context (and its claims) built by an earlier step. */
  context?: RepositoryContext;
}): Promise<AnalysisResult> {
  const context = opts.context ?? createRepositoryContext(opts.snapshot, { refPrefix: "C", maxClaims: 110 });
  const tools = [
    ...createRepositoryTools(context),
    defineTool({
      name: "finish_analysis",
      description: "Submit the final structured repository analysis. Cite only refs returned by record_claims.",
      input: repositoryAnalysisSchema,
      terminal: true,
      run: async () => ({ accepted: true }),
    }),
  ];

  const described = await describeCompressed(context, { client: opts.client, recorder: opts.recorder, inlineBudgetChars: INLINE_CONTEXT_CHARS });
  const skipped = opts.snapshot.inventory
    .filter((i) => !i.selected)
    .slice(0, 300)
    .map((i) => `- ${i.path} [${i.skipReason}]`)
    .join("\n");
  const userContent = [`What the user wants from this analysis (decides what to investigate first and most deeply): ${opts.userRequest}`, `\nSkipped paths (not readable), for structural awareness:\n${skipped}`, "", described.text].join("\n");

  const { result, turns, toolCalls } = await runToolLoop<RepositoryAnalysis>({
    client: opts.client,
    model: modelFor("analyst"),
    purpose: "analyze_repository",
    system: ANALYST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools,
    recorder: opts.recorder,
    // Tracing workflows hop by hop needs more calls than a summary.
    maxTurns: 14,
    maxToolCalls: 64,
    maxTokens: 16_000,
    // Old read results are trimmed once the conversation grows; their claims are already recorded.
    trimHistory: { keepTurns: 2, maxChars: 200_000 },
  });

  const known = new Set(context.claims.map((c) => c.ref));
  const { analysis, removed } = pruneAnalysisRefs(result, known);
  return { analysis, claims: context.claims, danglingRefs: removed, turns, toolCalls, context };
}
