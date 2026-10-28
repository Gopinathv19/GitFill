import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { HANDBOOK_COMPOSER_PROMPT, HANDBOOK_EXPLORER_PROMPT } from "@/lib/ai/prompts";
import { directorySummary, moduleGraph } from "@/lib/analysis/graph";
import { dependencyDiagram } from "@/lib/analysis/mermaid";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createRepositoryContext, createRepositoryTools, describeSnapshot, pruneUnknownRefs, type RepositoryContext } from "@/lib/agent/repo-tools";
import { renderClaimsForPrompt } from "@/lib/agent/planner";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Claim } from "@/lib/evidence/evidence";
import { bulletList, cite, diagramBlock, footer, footnotes, location, makeRenderContext, table } from "./render";
import { explorationNotesSchema, handbookSpecSchema, type ExplorationNotes, type HandbookRequest, type HandbookSpec } from "./schemas";

export interface HandbookResult {
  spec: HandbookSpec;
  markdown: string;
  claims: Claim[];
  notes: ExplorationNotes;
  danglingRefs: string[];
  diagramIssues: string[];
  agent: { turns: number; toolCalls: number };
}

const INLINE_BUDGET = 380_000;

const AUDIENCE_LABEL: Record<HandbookRequest["audience"], string> = {
  technical_handbook: "complete technical handbook for engineers",
  hackathon_pitch: "five-minute hackathon presentation guide (narrative, demo path, judge Q&A)",
  new_developer: "onboarding guide for a developer joining the team",
  backend_deep_dive: "detailed explanation of the backend",
  frontend_deep_dive: "detailed explanation of the frontend",
};

/**
 * Handbook pipeline: Muse Spark explores the code through tools and records verified
 * claims; Muse Wonder composes the handbook from that evidence; code renders Markdown.
 */
export async function generateHandbook(opts: { client: MuseClient; snapshot: SourceSnapshot; request: HandbookRequest; recorder: RunRecorder }): Promise<HandbookResult> {
  const snapshot = prioritize(opts.snapshot, opts.request);
  const context = createRepositoryContext(snapshot, { refPrefix: "C", maxClaims: 110 });

  // 1. Explore.
  const { notes, turns, toolCalls } = await explore(opts.client, context, opts.request, opts.recorder);

  // 2. Compose.
  const event = await opts.recorder.start("step", "compose_handbook", { audience: opts.request.audience, scope: opts.request.scope, claims: context.claims.length }, modelFor("architect"));
  let spec: HandbookSpec;
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("architect"),
      purpose: "compose_handbook",
      schema: handbookSpecSchema,
      schemaName: "Handbook",
      correctionAttempts: 2,
      maxTokens: 20_000,
      messages: [
        { role: "system", content: HANDBOOK_COMPOSER_PROMPT },
        { role: "user", content: composerInput(context, opts.request, notes) },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    spec = data;
    await event.succeed({ title: spec.title, workflows: spec.workflows.length, endpoints: spec.api.endpoints.length });
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "composition failed");
    throw err;
  }

  // 3. Validate and render.
  const known = new Set(context.claims.map((c) => c.ref));
  const pruned = pruneUnknownRefs(spec, known);
  const { markdown, diagramIssues } = renderHandbook(pruned.value, snapshot, context);
  return { spec: pruned.value, markdown, claims: context.claims, notes, danglingRefs: pruned.removed, diagramIssues, agent: { turns, toolCalls } };
}

async function explore(client: MuseClient, context: RepositoryContext, request: HandbookRequest, recorder: RunRecorder) {
  const tools = [
    ...createRepositoryTools(context),
    defineTool({
      name: "finish_exploration",
      description: "Submit the traced workflows, design decisions and open points. Cite only refs returned by record_claims.",
      input: explorationNotesSchema,
      terminal: true,
      run: async () => ({ accepted: true }),
    }),
  ];
  const described = describeSnapshot(context, { inlineBudgetChars: INLINE_BUDGET });
  const scopeLine =
    request.scope === "repository"
      ? "Scope: the whole repository."
      : request.scope === "module"
        ? `Scope: the module at ${request.focus || "(unspecified path)"}. Cover how it fits into the rest of the system, but keep detail inside this module.`
        : `Scope: the feature "${request.focus}". Trace it end to end across every layer it touches.`;
  const user = [
    `Handbook to prepare: ${AUDIENCE_LABEL[request.audience]}.`,
    scopeLine,
    request.instructions ? `User instructions: ${request.instructions}` : "",
    "",
    described.text,
  ]
    .filter(Boolean)
    .join("\n");
  const { result, turns, toolCalls } = await runToolLoop<ExplorationNotes>({
    client,
    model: modelFor("analyst"),
    purpose: "explore_repository",
    system: HANDBOOK_EXPLORER_PROMPT,
    messages: [{ role: "user", content: user }],
    tools,
    recorder,
    maxTurns: 14,
    maxToolCalls: 60,
    maxTokens: 12_000,
  });
  const known = new Set(context.claims.map((c) => c.ref));
  return { notes: pruneUnknownRefs(result, known).value, turns, toolCalls };
}

function composerInput(context: RepositoryContext, request: HandbookRequest, notes: ExplorationNotes): string {
  const { snapshot } = context;
  const dirs = directorySummary(snapshot, 2)
    .slice(0, 60)
    .map((d) => `- ${d.dir}/: ${d.files} files${Object.keys(d.categories).length ? ` (${Object.entries(d.categories).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}`)
    .join("\n");
  const graph = moduleGraph(context.graph, { maxNodes: 16, focus: request.scope === "module" ? request.focus : undefined });
  const packages = [...context.graph.externalPackages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([p, n]) => `${p} (${n} imports)`)
    .join(", ");
  return [
    `Audience: ${AUDIENCE_LABEL[request.audience]} (enum value: ${request.audience}).`,
    `Scope: ${request.scope}${request.focus ? ` — ${request.focus}` : ""}.`,
    request.instructions ? `User instructions: ${request.instructions}` : "",
    `Repository: ${snapshot.displayName}, branch ${snapshot.branch}, commit ${snapshot.version.slice(0, 7)}.${snapshot.description ? ` GitHub description: ${snapshot.description}` : ""}`,
    `\nComputed facts (safe to state; cite no refs for them):`,
    `Directories:\n${dirs}`,
    `Detected routes:\n${context.routes.slice(0, 80).map((r) => `- ${r.method} ${r.path} — ${r.file}:${r.line}`).join("\n") || "- none detected"}`,
    `Module dependency graph (${graph.collapsed ? "collapsed to directories" : "files"}):\n${graph.edges.map((e) => `- ${e.from} → ${e.to} (${e.weight})`).join("\n") || "- no internal imports resolved"}`,
    `External packages: ${packages || "none detected"}`,
    `\nExploration notes from the analyst:\n${JSON.stringify(notes)}`,
    `\nRecorded claims (ref [status] (type) text — location):\n${renderClaimsForPrompt(context.claims)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Puts files under the requested module first so they are included inline. */
function prioritize(snapshot: SourceSnapshot, request: HandbookRequest): SourceSnapshot {
  if (request.scope !== "module" || !request.focus) return snapshot;
  const focus = request.focus.replace(/^\.?\//, "").replace(/\/$/, "");
  const inFocus = (p: string) => p === focus || p.startsWith(`${focus}/`);
  const files = [...snapshot.files].sort((a, b) => Number(inFocus(b.path)) - Number(inFocus(a.path)));
  return { ...snapshot, files };
}

export function renderHandbook(spec: HandbookSpec, snapshot: SourceSnapshot, context: RepositoryContext): { markdown: string; diagramIssues: string[] } {
  const ctx = makeRenderContext([{ snapshot, claims: context.claims }]);
  const out: string[] = [];
  out.push(`# ${spec.title}`, spec.subtitle ? `*${spec.subtitle}*` : "", `**Scope:** ${spec.scope} · **Audience:** ${spec.audience.replace(/_/g, " ")} · **Source:** \`${snapshot.displayName}\` @ \`${snapshot.version.slice(0, 7)}\``, "");

  out.push("## 1. Project overview", "", `${spec.overview.summary.text}${cite(spec.overview.summary.claimRefs, ctx)}`, "", `**Problem it solves.** ${spec.overview.problemSolved.text}${cite(spec.overview.problemSolved.claimRefs, ctx)}`, "");
  if (spec.overview.keyFacts.length) out.push(bulletList(spec.overview.keyFacts, ctx), "");

  out.push("## 2. Architecture", "", `${spec.architecture.narrative.text}${cite(spec.architecture.narrative.claimRefs, ctx)}`, "");
  if (spec.architecture.layers.length) {
    out.push(table(["Layer", "Responsibility", "Where", "Evidence"], spec.architecture.layers.map((l) => [l.name, l.responsibility, l.paths.map((p) => location(p, ctx)).join(", "), cite(l.claimRefs, ctx) || "—"])), "");
  }
  const archDiagram = diagramBlock(spec.architecture.diagram, ctx);
  if (archDiagram) out.push(archDiagram, "");
  const deps = moduleGraph(context.graph, { maxNodes: 16 });
  if (deps.edges.length >= 2) out.push(diagramBlock(dependencyDiagram(deps, "Module dependencies (computed from imports)"), ctx), "");

  if (spec.directoryGuide.length) {
    out.push("## 3. Directory guide", "", table(["Path", "Purpose", "Start here", "Evidence"], spec.directoryGuide.map((d) => [location(d.path, ctx), d.purpose, d.startHere.map((p) => location(p, ctx)).join(", ") || "—", cite(d.claimRefs, ctx) || "—"])), "");
  }

  if (spec.workflows.length) {
    out.push("## 4. Functional workflows", "");
    spec.workflows.forEach((w) => {
      out.push(`### ${w.name}`, "", `${w.description.text}${cite(w.description.claimRefs, ctx)}`, "");
      out.push(w.steps.map((s, i) => `${i + 1}. ${s.text}${s.location ? ` — ${location(s.location, ctx)}` : ""}${cite(s.claimRefs, ctx)}`).join("\n"), "");
      const d = diagramBlock(w.diagram, ctx);
      if (d) out.push(d, "");
    });
  }

  if (spec.api.endpoints.length || spec.api.narrative) {
    out.push("## 5. API", "");
    if (spec.api.narrative) out.push(spec.api.narrative, "");
    if (spec.api.endpoints.length) out.push(table(["Method", "Path", "Purpose", "Handler", "Evidence"], spec.api.endpoints.map((e) => [`\`${e.method}\``, `\`${e.path}\``, e.purpose, e.location ? location(e.location, ctx) : "—", cite(e.claimRefs, ctx) || "—"])), "");
    const detected = context.routes.filter((r) => !spec.api.endpoints.some((e) => e.path === r.path && (e.method === r.method || e.method === "ANY" || r.method === "ANY")));
    if (detected.length) out.push(`<details><summary>${detected.length} more route(s) detected by static analysis</summary>\n\n${detected.slice(0, 60).map((r) => `- \`${r.method} ${r.path}\` — ${location(`${r.file}:${r.line}`, ctx)}`).join("\n")}\n\n</details>`, "");
  }

  out.push("## 6. Data flow", "", `${spec.dataFlow.narrative.text}${cite(spec.dataFlow.narrative.claimRefs, ctx)}`, "");
  const flow = diagramBlock(spec.dataFlow.diagram, ctx);
  if (flow) out.push(flow, "");
  if (spec.dataModels.length) {
    out.push("### Data models", "", table(["Model", "Purpose", "Where", "Evidence"], spec.dataModels.map((m) => [m.name, m.purpose, m.location ? location(m.location, ctx) : "—", cite(m.claimRefs, ctx) || "—"])), "");
    const er = diagramBlock(spec.erDiagram, ctx);
    if (er) out.push(er, "");
  }

  if (spec.techStack.length) {
    out.push("## 7. Technology stack", "", table(["Technology", "Category", "Role", "Evidence"], spec.techStack.map((t) => [t.name, t.category, t.role, cite(t.claimRefs, ctx) || "—"])), "");
  }

  if (spec.designDecisions.length) {
    out.push("## 8. Design decisions", "");
    for (const d of spec.designDecisions) {
      out.push(`### ${d.inferred ? "(inferred) " : ""}${d.decision}`, "", `${d.rationale}${cite(d.claimRefs, ctx)}`, d.tradeoffs ? `\n**Trade-offs.** ${d.tradeoffs}` : "", "");
    }
  }

  if (spec.presentationGuide.narrative.length) {
    out.push("## 9. Presentation guide", "");
    out.push(spec.presentationGuide.narrative.map((n) => `### ${n.heading}${n.minutes ? ` (~${n.minutes} min)` : ""}\n\n${n.talkingPoints.map((t) => `- ${t}`).join("\n")}`).join("\n\n"), "");
    if (spec.presentationGuide.demoPath.length) out.push("### Demo path", "", spec.presentationGuide.demoPath.map((d, i) => `${i + 1}. ${d}`).join("\n"), "");
  }

  if (spec.qa.length) {
    out.push("## 10. Q&A preparation", "");
    for (const q of spec.qa) out.push(`**Q: ${q.question}**`, "", `${q.inferred ? "*(inferred)* " : ""}${q.answer}${cite(q.claimRefs, ctx)}`, "");
  }

  if (spec.gettingStarted.length) {
    out.push("## Getting started", "", spec.gettingStarted.map((s, i) => `${i + 1}. ${s.step}${s.command ? `\n   \`\`\`sh\n   ${s.command}\n   \`\`\`` : ""}${cite(s.claimRefs, ctx)}`).join("\n"), "");
  }

  if (spec.openQuestions.length) out.push("## Open questions", "", spec.openQuestions.map((q) => `- ${q}`).join("\n"), "");

  const notes = footnotes(ctx);
  if (notes) out.push("## Evidence", "", notes);
  out.push(footer("Handbook", [snapshot], context.claims));
  return { markdown: out.filter((s, i, a) => !(s === "" && a[i - 1] === "")).join("\n"), diagramIssues: ctx.diagramIssues };
}

export const handbookOptionsSchema = z.object({ repositoryId: z.string().uuid() });
