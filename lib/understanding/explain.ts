import type { ChatCompletionMessageParam, MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { EXPLAIN_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createRepositoryContext, createRepositoryTools, describeSnapshot, splitForContext, type RepositoryContext } from "@/lib/agent/repo-tools";
import { runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";
import { parseAnswer, replaceCitations, verifyCitations, type ParsedAnswer } from "@/lib/evidence/citations";
import { normalizePath, type Claim } from "@/lib/evidence/evidence";
import { cite, diagramBlock, diagramMermaid, footer, footnotes, location, makeRenderContext } from "./render";
import type { AskRequest, ExplanationSpec } from "./schemas";

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
const MAX_CITATIONS = 40;
const MAX_SOURCES = 10;

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
  const contextStep = await opts.recorder.start("step", "build_context", { files: opts.snapshot.files.length, reused: Boolean(opts.context) });
  const base = opts.context ?? createRepositoryContext(opts.snapshot, { refPrefix: "C", maxClaims: 40 });
  await contextStep.succeed({ declarations: base.graph.symbols.length, imports: base.graph.imports.length, routes: base.routes.length });
  // When every file is already inline, ranking cannot change what the model sees.
  const fitsInline = splitForContext(opts.snapshot.files, INLINE_BUDGET).deferred.length === 0;
  const retrieved = fitsInline ? { ranked: null, passages: null } : await retrieveForQuestion(base, opts.request, opts.recorder);
  const snapshot = retrieved.ranked ? rankByRetrieval(opts.snapshot, retrieved.ranked, opts.request) : rankForQuestion(opts.snapshot, opts.request);
  // Same graph, claims and retriever; only the inline file order changes.
  const context: RepositoryContext = { ...base, snapshot };
  // No claim-recording tool: the answer cites `path:lines` inline and code verifies them afterwards.
  const tools = createRepositoryTools(context, { claims: false });
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

  const loopStep = await opts.recorder.start("step", "agent_loop", {
    promptChars: user.length,
    inlineFiles: described.inlineCount,
    deferredFiles: described.deferredCount,
    historyMessages: opts.history?.length ?? 0,
  });
  const { result: answer, turns, toolCalls } = await runToolLoop<string>({
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
    // Default effort spends ~2-3k hidden tokens per answer; low keeps quality with roughly half the latency.
    reasoningEffort: "low",
    finishOnText: true,
    streamText: true,
  });

  await loopStep.succeed({ turns, toolCalls });

  const renderStep = await opts.recorder.start("step", "verify_and_render");
  const parsed = parseAnswer(answer);
  const { claims, refs } = verifyCitations(parsed.body, context.files, { refPrefix: context.refPrefix, firstIndex: context.claims.length + 1, max: MAX_CITATIONS });
  context.claims.push(...claims);
  const spec = validateReferences(toSpec(parsed, claims, opts.request), context);
  const markdown = renderExplanation(spec, snapshot, claims, refs);
  await renderStep.succeed({
    citations: refs.length,
    claims: claims.length,
    verified: claims.filter((c) => c.status === "verified").length,
    inferred: claims.filter((c) => c.status === "inferred").length,
    diagram: parsed.diagram ? "ok" : parsed.diagramError ? `dropped: ${parsed.diagramError}` : "none",
    markdownChars: markdown.length,
  });
  return { spec, markdown, mermaid: diagramMermaid(spec.diagram), claims, agent: { turns, toolCalls }, retrieval: retrieved.ranked ? "memora" : "heuristic" };
}

/** Builds the stored spec from the parsed Markdown answer and its verified citations. */
function toSpec(parsed: ParsedAnswer, claims: Claim[], request: AskRequest): ExplanationSpec {
  // Sources list: first cited range per file, in order of appearance.
  const byFile = new Map<string, Claim>();
  for (const c of claims) if (c.filePath && c.startLine !== null && !byFile.has(c.filePath)) byFile.set(c.filePath, c);
  return {
    title: (parsed.title ?? request.question).replace(/\s+/g, " ").slice(0, 120),
    answer: parsed.body,
    claimRefs: claims.map((c) => c.ref),
    references: [...byFile.values()].slice(0, MAX_SOURCES).map((c) => ({ path: c.filePath!, startLine: c.startLine!, endLine: c.endLine ?? c.startLine!, why: c.claim.slice(0, 200) })),
    diagram: parsed.diagram,
    unverified: parsed.unverified.slice(0, 8),
    followUps: parsed.followUps.slice(0, 4),
  };
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

/** `citationRefs` maps each inline `path:lines` citation in the answer to its claim (see verifyCitations). */
export function renderExplanation(spec: ExplanationSpec, snapshot: SourceSnapshot, claims: Claim[], citationRefs: Array<string | null>): string {
  const ctx = makeRenderContext([{ snapshot, claims }]);
  const answer = replaceCitations(spec.answer.trim(), citationRefs, (ref, citation) => `${location(citation, ctx)}${cite([ref], ctx)}`);
  const out: string[] = [`### ${spec.title}`, "", answer, ""];
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
