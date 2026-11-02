import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { BRAINSTORM_SPEC_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createRepositoryContext, createRepositoryTools, describeCompressed, pruneUnknownRefs } from "@/lib/agent/repo-tools";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Claim } from "@/lib/evidence/evidence";

const refs = z.array(z.string().regex(/^C\d+$/)).max(6).default([]).describe("Refs from record_claims that show this in the code.");

export const brainstormSpecSchema = z.object({
  title: z.string().trim().min(3).max(100),
  summary: z.string().trim().min(20).max(1500).describe("The problem and the goal, in the conversation's terms."),
  decisions: z.array(z.object({ decision: z.string().trim().min(3).max(300), why: z.string().trim().max(400).default("") })).max(15),
  openQuestions: z.array(z.string().trim().min(3).max(300)).max(10).describe("What the conversation left undecided. Never decide these yourself."),
  codeContext: z
    .array(z.object({ path: z.string().trim().min(1).max(300), today: z.string().trim().min(3).max(400).describe("What this code does now."), change: z.string().trim().min(3).max(400).describe("How the idea touches it."), claimRefs: refs }))
    .min(1)
    .max(15),
  approach: z.string().trim().min(20).max(2500).describe("The design, following the repository's existing patterns."),
  tasks: z
    .array(z.object({ title: z.string().trim().min(3).max(120), detail: z.string().trim().min(3).max(800), files: z.array(z.string().trim().max(300)).max(10).default([]) }))
    .min(1)
    .max(15),
  acceptance: z.array(z.string().trim().min(3).max(300)).min(1).max(12).describe("Checkable criteria: behaviour, tests to add, commands that must pass."),
  outOfScope: z.array(z.string().trim().max(300)).max(8).default([]),
  risks: z.array(z.string().trim().max(300)).max(8).default([]),
});

export type BrainstormSpec = z.infer<typeof brainstormSpecSchema>;

/**
 * Turns a brainstorming conversation into an implementation spec for a coding agent: Muse Spark
 * explores the repository through the shared tools (claims are checked against the real lines),
 * then submits the spec; code renders it as Markdown with the evidence for each code reference.
 */
export async function writeBrainstormSpec(opts: { client: MuseClient; snapshot: SourceSnapshot; conversation: string; title: string; recorder: RunRecorder }): Promise<{ spec: BrainstormSpec; markdown: string; claims: Claim[] }> {
  const context = createRepositoryContext(opts.snapshot, { refPrefix: "C", maxClaims: 60 });
  const tools = [
    ...createRepositoryTools(context),
    defineTool({
      name: "finish_spec",
      description: "Submit the implementation spec. Cite only refs returned by record_claims.",
      input: brainstormSpecSchema,
      terminal: true,
      run: async () => ({ accepted: true }),
    }),
  ];
  const described = await describeCompressed(context, { client: opts.client, recorder: opts.recorder, inlineBudgetChars: 70_000 });
  const { result } = await runToolLoop<BrainstormSpec>({
    client: opts.client,
    model: modelFor("analyst"),
    purpose: "write_brainstorm_spec",
    system: BRAINSTORM_SPEC_PROMPT,
    messages: [{ role: "user", content: [`Working title: ${opts.title}`, `<conversation>\n${opts.conversation}\n</conversation>`, described.text].join("\n\n") }],
    tools,
    recorder: opts.recorder,
    maxTurns: 12,
    maxToolCalls: 40,
    maxTokens: 12_000,
    reasoningEffort: "low",
  });
  const spec = pruneUnknownRefs(result, new Set(context.claims.map((c) => c.ref))).value;
  return { spec, markdown: renderSpec(spec, context.claims, opts.snapshot), claims: context.claims };
}

export function renderSpec(spec: BrainstormSpec, claims: Claim[], snapshot: Pick<SourceSnapshot, "displayName" | "version">): string {
  const byRef = new Map(claims.map((c) => [c.ref, c]));
  const evidence = (refs: string[]) =>
    refs
      .map((r) => byRef.get(r))
      .filter((c): c is Claim => Boolean(c?.filePath && c.status !== "unverified"))
      .map((c) => `\`${c.filePath}:${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ""}\``)
      .join(", ");
  const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
  return [
    `# ${spec.title}`,
    `> Implementation spec from a GitFill brainstorm, grounded in \`${snapshot.displayName}\` at \`${snapshot.version.slice(0, 7)}\`. For coding agents: read it all, follow the tasks in order, and check every acceptance criterion before you finish.`,
    `## Goal\n\n${spec.summary}`,
    spec.decisions.length ? `## Decisions\n\n${list(spec.decisions.map((d) => `**${d.decision}**${d.why ? ` — ${d.why}` : ""}`))}` : "",
    spec.openQuestions.length ? `## Open questions\n\nResolve these with the team before or while implementing; do not guess.\n\n${list(spec.openQuestions)}` : "",
    `## Code involved\n\n| Path | Today | Change | Evidence |\n|---|---|---|---|\n${spec.codeContext.map((c) => `| \`${c.path}\` | ${cell(c.today)} | ${cell(c.change)} | ${evidence(c.claimRefs) || "—"} |`).join("\n")}`,
    `## Approach\n\n${spec.approach}`,
    `## Tasks\n\n${spec.tasks.map((t, i) => `${i + 1}. **${t.title}** — ${t.detail}${t.files.length ? `\n   Files: ${t.files.map((f) => `\`${f}\``).join(", ")}` : ""}`).join("\n")}`,
    `## Acceptance criteria\n\n${spec.acceptance.map((a) => `- [ ] ${a}`).join("\n")}`,
    spec.outOfScope.length ? `## Out of scope\n\n${list(spec.outOfScope)}` : "",
    spec.risks.length ? `## Risks\n\n${list(spec.risks)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
