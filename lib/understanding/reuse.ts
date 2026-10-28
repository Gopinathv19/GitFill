import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { REUSE_COMPOSER_PROMPT, REUSE_EXPLORER_PROMPT } from "@/lib/ai/prompts";
import { directorySummary, moduleGraph } from "@/lib/analysis/graph";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createMultiRepositoryTools, createRepositoryContext, describeSnapshot, pruneUnknownRefs, type RepositoryContext } from "@/lib/agent/repo-tools";
import { renderClaimsForPrompt } from "@/lib/agent/planner";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Claim } from "@/lib/evidence/evidence";
import { bulletList, cite, diagramBlock, footer, footnotes, location, makeRenderContext, table } from "./render";
import { implementationBriefSchema, reuseNotesSchema, type ImplementationBrief, type ReuseKind, type ReuseNotes } from "./schemas";

export interface ReuseResult {
  spec: ImplementationBrief;
  markdown: string;
  notes: ReuseNotes;
  referenceClaims: Claim[];
  targetClaims: Claim[];
  danglingRefs: string[];
  agent: { turns: number; toolCalls: number };
}

const INLINE_BUDGET_EACH = 190_000;

const KIND_LABEL: Record<ReuseKind, string> = {
  architectural: "architectural reuse (reproduce structural conventions and layering, not code)",
  component: "component reuse (adapt a specific module or component)",
  implementation: "implementation reuse (copy or adapt actual code where appropriate)",
  design: "design reuse (UI patterns, layouts, component conventions)",
  dependency: "dependency reuse (libraries, configuration and infrastructure the design needs)",
};

/**
 * Architecture reuse: Muse Spark studies both repositories through the same tools
 * (claims prefixed R for reference, T for target), then Muse Wonder writes a file-by-file
 * implementation brief a developer or coding agent can execute in the target.
 */
export async function generateImplementationBrief(opts: {
  client: MuseClient;
  reference: SourceSnapshot;
  target: SourceSnapshot;
  request: string;
  reuseKinds: ReuseKind[];
  recorder: RunRecorder;
}): Promise<ReuseResult> {
  const ref = createRepositoryContext(opts.reference, { refPrefix: "R", maxClaims: 70 });
  const tgt = createRepositoryContext(opts.target, { refPrefix: "T", maxClaims: 50 });

  const { notes, turns, toolCalls } = await explore(opts, ref, tgt);

  const event = await opts.recorder.start("step", "compose_brief", { reuseKinds: opts.reuseKinds, referenceClaims: ref.claims.length, targetClaims: tgt.claims.length }, modelFor("architect"));
  let spec: ImplementationBrief;
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("architect"),
      purpose: "compose_brief",
      schema: implementationBriefSchema,
      schemaName: "ImplementationBrief",
      correctionAttempts: 2,
      maxTokens: 18_000,
      messages: [
        { role: "system", content: REUSE_COMPOSER_PROMPT },
        { role: "user", content: composerInput(opts, ref, tgt, notes) },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    spec = data;
    await event.succeed({ title: spec.title, planSteps: spec.plan.length, patterns: spec.referencePatterns.length });
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "composition failed");
    throw err;
  }

  const known = new Set([...ref.claims, ...tgt.claims].map((c) => c.ref));
  const pruned = pruneUnknownRefs(spec, known);
  const sorted = { ...pruned.value, plan: [...pruned.value.plan].sort((a, b) => a.order - b.order) };
  const markdown = renderBrief(sorted, opts.reference, opts.target, ref.claims, tgt.claims);
  return { spec: sorted, markdown, notes, referenceClaims: ref.claims, targetClaims: tgt.claims, danglingRefs: pruned.removed, agent: { turns, toolCalls } };
}

async function explore(opts: { client: MuseClient; request: string; reuseKinds: ReuseKind[]; recorder: RunRecorder }, ref: RepositoryContext, tgt: RepositoryContext) {
  const tools = [
    ...createMultiRepositoryTools({ reference: ref, target: tgt }, ["reference", "target"] as const),
    defineTool({
      name: "finish_exploration",
      description: "Submit extracted patterns, target touchpoints and conflicts. Cite only refs returned by record_claims (R… and T…).",
      input: reuseNotesSchema,
      terminal: true,
      run: async () => ({ accepted: true }),
    }),
  ];
  const refText = describeSnapshot(ref, { inlineBudgetChars: INLINE_BUDGET_EACH, heading: "REFERENCE repository" }).text;
  const tgtText = describeSnapshot(tgt, { inlineBudgetChars: INLINE_BUDGET_EACH, heading: "TARGET repository" }).text;
  const user = [
    `User request: ${opts.request}`,
    `Requested reuse kinds: ${opts.reuseKinds.map((k) => KIND_LABEL[k]).join("; ")}.`,
    "",
    "=== REFERENCE ===",
    refText,
    "",
    "=== TARGET ===",
    tgtText,
  ].join("\n");
  const { result, turns, toolCalls } = await runToolLoop<ReuseNotes>({
    client: opts.client,
    model: modelFor("analyst"),
    purpose: "explore_reuse",
    system: REUSE_EXPLORER_PROMPT,
    messages: [{ role: "user", content: user }],
    tools,
    recorder: opts.recorder,
    maxTurns: 14,
    maxToolCalls: 60,
    maxTokens: 12_000,
  });
  const known = new Set([...ref.claims, ...tgt.claims].map((c) => c.ref));
  return { notes: pruneUnknownRefs(result, known).value, turns, toolCalls };
}

function composerInput(opts: { request: string; reuseKinds: ReuseKind[] }, ref: RepositoryContext, tgt: RepositoryContext, notes: ReuseNotes): string {
  const dirs = (c: RepositoryContext) => directorySummary(c.snapshot, 2).slice(0, 50).map((d) => `- ${d.dir}/ (${d.files} files)`).join("\n");
  const graph = (c: RepositoryContext) => moduleGraph(c.graph, { maxNodes: 14 }).edges.map((e) => `- ${e.from} → ${e.to}`).join("\n") || "- none resolved";
  return [
    `User request: ${opts.request}`,
    `Reuse kinds: ${opts.reuseKinds.join(", ")}.`,
    `\nREFERENCE: ${ref.snapshot.displayName} @ ${ref.snapshot.version.slice(0, 7)}\nDirectories:\n${dirs(ref)}\nModule graph:\n${graph(ref)}\nRoutes: ${ref.routes.slice(0, 40).map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`,
    `\nTARGET: ${tgt.snapshot.displayName} @ ${tgt.snapshot.version.slice(0, 7)}\nDirectories:\n${dirs(tgt)}\nModule graph:\n${graph(tgt)}\nRoutes: ${tgt.routes.slice(0, 40).map((r) => `${r.method} ${r.path}`).join(", ") || "none"}\nTarget packages: ${[...tgt.graph.externalPackages.keys()].slice(0, 40).join(", ") || "none"}`,
    `\nExploration notes:\n${JSON.stringify(notes)}`,
    `\nReference claims:\n${renderClaimsForPrompt(ref.claims)}`,
    `\nTarget claims:\n${renderClaimsForPrompt(tgt.claims)}`,
  ].join("\n");
}

export function renderBrief(spec: ImplementationBrief, reference: SourceSnapshot, target: SourceSnapshot, refClaims: Claim[], tgtClaims: Claim[]): string {
  const ctx = makeRenderContext([
    { snapshot: reference, claims: refClaims },
    { snapshot: target, claims: tgtClaims },
  ]);
  const refLink = (p: string) => location(p, makeRenderContext([{ snapshot: reference, claims: [] }]));
  const tgtLink = (p: string) => location(p, makeRenderContext([{ snapshot: target, claims: [] }]));
  const out: string[] = [
    `# ${spec.title}`,
    "",
    `**Reference:** \`${reference.displayName}\` @ \`${reference.version.slice(0, 7)}\` · **Target:** \`${target.displayName}\` @ \`${target.version.slice(0, 7)}\` · **Reuse:** ${spec.reuseKinds.join(", ")}`,
    "",
    "> This brief is written for a developer or coding agent working in the target repository. Claims prefixed R cite the reference, T the target.",
    "",
    "## 1. Objective",
    "",
    `${spec.objective.text}${cite(spec.objective.claimRefs, ctx)}`,
    "",
    "## 2. Patterns to reuse from the reference",
    "",
  ];
  for (const p of spec.referencePatterns) {
    out.push(`### ${p.name}`, "", `${p.whatItIs}${cite(p.claimRefs, ctx)}`, "", `**Why it matters.** ${p.whyItMatters}`, "", `**Reference files:** ${p.referenceFiles.map(refLink).join(", ")}`, "");
  }
  out.push("## 3. Target: current state", "", `${spec.targetState.currentStructure.text}${cite(spec.targetState.currentStructure.claimRefs, ctx)}`, "");
  if (spec.targetState.preserve.length) out.push("**Preserve:**", "", bulletList(spec.targetState.preserve, ctx), "");
  if (spec.targetState.gaps.length) out.push("**Gaps versus the reference:**", "", bulletList(spec.targetState.gaps, ctx), "");
  if (spec.comparison.length) {
    out.push("## 4. Comparison", "", table(["Aspect", "Reference", "Target", "Action", "Evidence"], spec.comparison.map((c) => [c.aspect, c.reference, c.target, c.action.replace(/_/g, " "), cite(c.claimRefs, ctx) || "—"])), "");
  }
  const tgtDiagram = diagramBlock(spec.targetDiagram, ctx, { heading: "Target architecture after the change" });
  if (tgtDiagram) out.push(tgtDiagram, "");
  out.push("## 5. Implementation plan (target repository)", "");
  for (const step of spec.plan) {
    out.push(`### ${step.order}. ${step.action.toUpperCase()} ${tgtLink(step.path)}`, "", `${step.description}${cite(step.claimRefs, ctx)}`, step.consultReference.length ? `\n*Consult in reference:* ${step.consultReference.map(refLink).join(", ")}` : "", "");
  }
  if (spec.dependencies.length) out.push("## 6. Dependencies and configuration", "", table(["Dependency", "Purpose", "Configuration"], spec.dependencies.map((d) => [d.name, d.purpose, d.configuration ?? "—"])), "");
  if (spec.constraints.length) out.push("## 7. Constraints", "", bulletList(spec.constraints, ctx), "");
  if (spec.doNotModify.length) out.push("**Do not modify:**", "", spec.doNotModify.map((p) => `- ${tgtLink(p)}`).join("\n"), "");
  out.push("## 8. Acceptance criteria", "", spec.acceptanceCriteria.map((a) => `- [ ] ${a}`).join("\n"), "");
  if (spec.tests.length) out.push("## 9. Tests", "", spec.tests.map((t) => `- ${t.existing ? "Run existing: " : "Add: "}${t.description}${t.command ? ` — \`${t.command}\`` : ""}`).join("\n"), "");
  if (spec.openQuestions.length) out.push("## Open questions", "", spec.openQuestions.map((q) => `- ${q}`).join("\n"), "");
  const notes = footnotes(ctx);
  if (notes) out.push("## Evidence", "", notes);
  out.push(footer("Implementation brief", [reference, target], [...refClaims, ...tgtClaims]));
  return out.join("\n");
}
