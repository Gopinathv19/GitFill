import type { ChatCompletionMessageParam, MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { EXPLAIN_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createRepositoryContext, createRepositoryTools, describeSnapshot, pruneUnknownRefs, type RepositoryContext } from "@/lib/agent/repo-tools";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";
import { normalizePath, type Claim } from "@/lib/evidence/evidence";
import { diagramBlock, diagramMermaid, footer, footnotes, location, makeRenderContext } from "./render";
import { explanationSpecSchema, type AskRequest, type ExplanationSpec } from "./schemas";

export interface ExplanationResult {
  spec: ExplanationSpec;
  markdown: string;
  /** The diagram's Mermaid text alone, for clients that render it themselves. */
  mermaid: string | null;
  claims: Claim[];
  agent: { turns: number; toolCalls: number };
  /** Which retrieval ranked the context: Memora's RAG pipeline or the local keyword heuristic. */
  retrieval: "memora" | "heuristic";
}

/** Smaller inline budget than batch jobs: questions are interactive. */
const INLINE_BUDGET = 160_000;

/**
 * Code Q&A: Muse Spark locates the relevant code through the shared tools, records
 * claims, and answers with sources. Diagrams are structured and rendered by code.
 */
export async function explainCode(opts: {
  client: MuseClient;
  snapshot: SourceSnapshot;
  request: AskRequest;
  recorder: RunRecorder;
  /** Earlier turns of a conversation, for follow-up questions. */
  history?: ChatCompletionMessageParam[];
  /** Pre-built context to reuse across questions on the same snapshot. */
  context?: RepositoryContext;
}): Promise<ExplanationResult> {
  const base = opts.context ?? createRepositoryContext(opts.snapshot, { refPrefix: "C", maxClaims: 40 });
  const retrieved = await retrieveForQuestion(base, opts.request, opts.recorder);
  const snapshot = retrieved.ranked ? rankByRetrieval(opts.snapshot, retrieved.ranked, opts.request) : rankForQuestion(opts.snapshot, opts.request);
  // Same graph, claims and retriever; only the inline file order changes.
  const context: RepositoryContext = { ...base, snapshot };
  const claimsBefore = context.claims.length;
  const tools = [
    ...createRepositoryTools(context),
    defineTool({
      name: "finish_explanation",
      description: "Submit the final answer. Cite only refs returned by record_claims. Include a diagram only when it helps.",
      input: explanationSpecSchema,
      terminal: true,
      run: async () => ({ accepted: true }),
    }),
  ];
  const described = describeSnapshot(context, { inlineBudgetChars: INLINE_BUDGET });
  const diagramLine =
    opts.request.diagram === "none"
      ? "Do not include a diagram."
      : opts.request.diagram === "auto"
        ? "Include a diagram only if the question is about flow, interactions, structure or relationships."
        : `Include a ${opts.request.diagram} diagram.`;
  const user = [
    `Question: ${opts.request.question}`,
    opts.request.focus ? `Focus: ${opts.request.focus}` : "",
    diagramLine,
    retrieved.passages ? `\nMost relevant passages according to the retrieval index (verify with read_file before citing):\n${retrieved.passages}` : "",
    "",
    described.text,
  ]
    .filter(Boolean)
    .join("\n");

  const { result, turns, toolCalls } = await runToolLoop<ExplanationSpec>({
    client: opts.client,
    model: modelFor("explainer"),
    purpose: "explain_code",
    system: EXPLAIN_PROMPT,
    messages: [...(opts.history ?? []), { role: "user", content: user }],
    tools,
    recorder: opts.recorder,
    maxTurns: 8,
    maxToolCalls: 24,
    maxTokens: 8_000,
  });

  const known = new Set(context.claims.map((c) => c.ref));
  const spec = validateReferences(pruneUnknownRefs(result, known).value, context);
  const claims = context.claims.slice(claimsBefore);
  const markdown = renderExplanation(spec, snapshot, claims);
  return { spec, markdown, mermaid: diagramMermaid(spec.diagram), claims, agent: { turns, toolCalls }, retrieval: retrieved.ranked ? "memora" : "heuristic" };
}

/** Asks Memora for the passages most relevant to the question; falls back silently when it is not available. */
async function retrieveForQuestion(context: RepositoryContext, request: AskRequest, recorder: RunRecorder): Promise<{ ranked: string[] | null; passages: string | null }> {
  if (!context.retriever) return { ranked: null, passages: null };
  const event = await recorder.start("tool", "retrieve_context", { backend: context.retriever.backend, query: request.question.slice(0, 200) });
  const result = await context.retriever.retrieve(`${request.question}${request.focus ? ` (${request.focus})` : ""}`, { limit: 10 });
  if (result.status === "unavailable" || !result.passages.length) {
    await event.fail(result.detail ?? `index ${result.status}`);
    return { ranked: null, passages: null };
  }
  await event.succeed({ status: result.status, passages: result.passages.map((p) => `${p.path}${p.startLine ? `:${p.startLine}-${p.endLine}` : ""}`), latencyMs: result.latencyMs });
  const ranked = [...new Set(result.passages.map((p) => p.path))];
  const passages = result.passages
    .slice(0, 6)
    .map((p) => `<passage path="${p.path}"${p.startLine ? ` lines="${p.startLine}-${p.endLine}"` : ""} score="${p.score.toFixed(2)}">\n${p.content.slice(0, 1200)}\n</passage>`)
    .join("\n");
  return { ranked, passages };
}

/** Retrieved files first (in retrieval order), then the keyword heuristic for the rest. */
function rankByRetrieval(snapshot: SourceSnapshot, ranked: string[], request: AskRequest): SourceSnapshot {
  const order = new Map(ranked.map((p, i) => [p, i]));
  const rest = rankForQuestion(snapshot, request).files.filter((f) => !order.has(f.path));
  const first = ranked.map((p) => snapshot.files.find((f) => f.path === p)).filter((f): f is SourceFile => Boolean(f));
  return { ...snapshot, files: [...first, ...rest] };
}

/** Files mentioned in the question (by path or identifier) go first so they are inline. */
function rankForQuestion(snapshot: SourceSnapshot, request: AskRequest): SourceSnapshot {
  const text = `${request.question} ${request.focus ?? ""}`;
  const tokens = new Set((text.match(/[A-Za-z_$][\w$]{2,}/g) ?? []).map((t) => t.toLowerCase()));
  const paths = new Set((text.match(/[\w./-]+\.[a-z]{1,5}/g) ?? []).map((p) => normalizePath(p).toLowerCase()));
  const score = (f: SourceFile) => {
    let s = 0;
    const lower = f.path.toLowerCase();
    if ([...paths].some((p) => lower.endsWith(p))) s += 100;
    const name = lower.slice(lower.lastIndexOf("/") + 1).replace(/\.\w+$/, "");
    if (tokens.has(name)) s += 40;
    let hits = 0;
    const content = f.content.toLowerCase();
    for (const t of tokens) if (t.length > 3 && content.includes(t)) hits++;
    return s + Math.min(hits, 20);
  };
  const files = [...snapshot.files].sort((a, b) => score(b) - score(a));
  return { ...snapshot, files };
}

function validateReferences(spec: ExplanationSpec, context: RepositoryContext): ExplanationSpec {
  const references = spec.references
    .map((r) => {
      const file = context.files.get(normalizePath(r.path));
      if (!file) return null;
      const start = Math.min(r.startLine, file.lineCount);
      const end = Math.min(Math.max(r.endLine, start), file.lineCount);
      return { ...r, path: file.path, startLine: start, endLine: end };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return { ...spec, references };
}

export function renderExplanation(spec: ExplanationSpec, snapshot: SourceSnapshot, claims: Claim[]): string {
  const ctx = makeRenderContext([{ snapshot, claims }]);
  for (const r of spec.claimRefs) if (ctx.claims.has(r)) ctx.used.add(r);
  const out: string[] = [`### ${spec.title}`, "", spec.answer.trim(), ""];
  const diagram = diagramBlock(spec.diagram, ctx);
  if (diagram) out.push(diagram, "");
  if (spec.references.length) {
    out.push("**Sources**", "", spec.references.map((r) => `- ${location(r.startLine === r.endLine ? `${r.path}:${r.startLine}` : `${r.path}:${r.startLine}-${r.endLine}`, ctx)} — ${r.why}`).join("\n"), "");
  }
  if (spec.unverified.length) out.push("**Not verified in code**", "", spec.unverified.map((u) => `- ${u}`).join("\n"), "");
  if (spec.followUps.length) out.push("**You could ask next**", "", spec.followUps.map((f) => `- ${f}`).join("\n"), "");
  const notes = footnotes(ctx);
  if (notes) out.push(notes, "");
  out.push(footer("Explanation", [snapshot], claims));
  return out.join("\n");
}
