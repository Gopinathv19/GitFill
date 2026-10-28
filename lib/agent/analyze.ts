import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { ANALYST_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Claim } from "@/lib/evidence/evidence";
import { pruneAnalysisRefs, repositoryAnalysisSchema, type RepositoryAnalysis } from "./analysis-schema";
import type { RunRecorder } from "./recorder";
import { createRepositoryContext, createRepositoryTools, describeSnapshot, type RepositoryContext } from "./repo-tools";
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

/** Prompt budget for file contents sent up front; anything beyond is reachable through read_file. */
const INLINE_CONTEXT_CHARS = 420_000;

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
  const context = opts.context ?? createRepositoryContext(opts.snapshot, { refPrefix: "C", maxClaims: 90 });
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

  const described = describeSnapshot(context, { inlineBudgetChars: INLINE_CONTEXT_CHARS });
  const skipped = opts.snapshot.inventory
    .filter((i) => !i.selected)
    .slice(0, 300)
    .map((i) => `- ${i.path} [${i.skipReason}]`)
    .join("\n");
  const userContent = [`User's eventual goal (for emphasis only): ${opts.userRequest}`, `\nSkipped paths (not readable), for structural awareness:\n${skipped}`, "", described.text].join("\n");

  const { result, turns, toolCalls } = await runToolLoop<RepositoryAnalysis>({
    client: opts.client,
    model: modelFor("analyst"),
    purpose: "analyze_repository",
    system: ANALYST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools,
    recorder: opts.recorder,
    maxTurns: 10,
    maxToolCalls: 40,
    maxTokens: 16_000,
  });

  const known = new Set(context.claims.map((c) => c.ref));
  const { analysis, removed } = pruneAnalysisRefs(result, known);
  return { analysis, claims: context.claims, danglingRefs: removed, turns, toolCalls, context };
}
