import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { PLANNER_SYSTEM_PROMPT, REVISION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { formatCitation, type Claim } from "@/lib/evidence/evidence";
import { deckSpecSchema, normalizeDeckSpec, slideSchema, THEMES, type DeckSpec, type SpecIssue } from "@/lib/presentation/spec";
import type { GenerateRequest } from "@/lib/validation/request";
import type { RepositoryAnalysis } from "./analysis-schema";
import type { RunRecorder } from "./recorder";

export function renderClaimsForPrompt(claims: Claim[]): string {
  return claims
    .map((c) => `${c.ref} [${c.status}] (${c.claimType}) ${c.claim}${formatCitation(c) ? ` — ${formatCitation(c)}` : ""}`)
    .join("\n");
}

function repoFacts(snapshot: SourceSnapshot): string {
  const langs = Object.entries(snapshot.stats.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, bytes]) => `${ext}: ${Math.round(bytes / 1024)} KB`)
    .join(", ");
  return [
    `Repository: ${snapshot.displayName}`,
    `Branch: ${snapshot.branch}; commit ${snapshot.version.slice(0, 7)}`,
    `Files in tree: ${snapshot.stats.totalEntries}; files analyzed: ${snapshot.stats.selectedFiles}`,
    `Source size by extension: ${langs}`,
    snapshot.metadata.license ? `License: ${String(snapshot.metadata.license)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Muse Wonder turns the analysis into a deck spec; Zod validation plus semantic normalization follow. */
export async function planDeck(opts: {
  client: MuseClient;
  snapshot: SourceSnapshot;
  analysis: RepositoryAnalysis;
  claims: Claim[];
  request: GenerateRequest;
  recorder: RunRecorder;
}): Promise<{ spec: DeckSpec; issues: SpecIssue[] }> {
  const { request } = opts;
  const schema = deckSpecSchema.refine((s) => s.slides.length === request.slideCount, {
    message: `The deck must have exactly ${request.slideCount} slides.`,
    path: ["slides"],
  });
  const event = await opts.recorder.start("step", "plan_presentation", { slideCount: request.slideCount, audience: request.audience }, modelFor("planner"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("planner"),
      purpose: "plan_presentation",
      schema,
      schemaName: "DeckSpec",
      correctionAttempts: 2,
      maxTokens: 16_000,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Request: ${request.purpose}`,
            `Audience: ${request.audience}`,
            `Slide count: exactly ${request.slideCount}`,
            `Theme: ${request.theme}`,
            request.instructions ? `Additional instructions from the user: ${request.instructions}` : "",
            `Title slide meta line: "${opts.snapshot.displayName} · ${opts.snapshot.branch} · ${opts.snapshot.version.slice(0, 7)}"`,
            `\nRepository facts (computed by GitFill, safe to cite as numbers):\n${repoFacts(opts.snapshot)}`,
            `\nRepository analysis:\n${JSON.stringify(opts.analysis)}`,
            `\nRecorded claims:\n${renderClaimsForPrompt(opts.claims)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const result = normalizeDeckSpec({ ...data, theme: request.theme }, new Set(opts.claims.map((c) => c.ref)));
    await event.succeed({ title: result.spec.title, slides: result.spec.slides.map((s) => `${s.id}:${s.layout}`), specIssues: result.issues.length });
    return result;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "planning failed");
    throw err;
  }
}

const anchor = z.string().describe('Slide id, or "start".');

export const revisionPlanSchema = z.object({
  summary: z.string().min(1).max(400),
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("replace"), slide: slideSchema }),
        z.object({ op: z.literal("insert"), after: anchor, slide: slideSchema }),
        z.object({ op: z.literal("delete"), id: z.string() }),
        z.object({ op: z.literal("move"), id: z.string(), after: anchor }),
        z.object({ op: z.literal("set_theme"), theme: z.enum(THEMES) }),
      ]),
    )
    .min(1)
    .max(20),
});

export type RevisionPlan = z.infer<typeof revisionPlanSchema>;

/**
 * Applies targeted operations to a spec. Slides not named in an operation are carried over
 * unchanged, so a revision provably preserves unrelated slides.
 */
export function applyRevision(spec: DeckSpec, plan: RevisionPlan): { spec: DeckSpec; changedIds: string[]; problems: string[] } {
  let slides = [...spec.slides];
  let theme = spec.theme;
  const changed = new Set<string>();
  const problems: string[] = [];
  const indexAfter = (after: string) => (after === "start" ? 0 : slides.findIndex((s) => s.id === after) + 1);

  for (const op of plan.operations) {
    switch (op.op) {
      case "replace": {
        const i = slides.findIndex((s) => s.id === op.slide.id);
        if (i < 0) problems.push(`replace: no slide ${op.slide.id}`);
        else {
          slides[i] = op.slide;
          changed.add(op.slide.id);
        }
        break;
      }
      case "insert": {
        const at = indexAfter(op.after);
        if (op.after !== "start" && at === 0) {
          problems.push(`insert: no slide ${op.after}`);
          break;
        }
        let id = op.slide.id;
        for (let n = slides.length + 1; slides.some((s) => s.id === id); n++) id = `s${n}`;
        slides.splice(at, 0, { ...op.slide, id });
        changed.add(id);
        break;
      }
      case "delete": {
        const before = slides.length;
        slides = slides.filter((s) => s.id !== op.id);
        if (slides.length === before) problems.push(`delete: no slide ${op.id}`);
        break;
      }
      case "move": {
        const i = slides.findIndex((s) => s.id === op.id);
        if (i < 0) {
          problems.push(`move: no slide ${op.id}`);
          break;
        }
        const [slide] = slides.splice(i, 1);
        const at = indexAfter(op.after);
        slides.splice(op.after !== "start" && at === 0 ? i : at, 0, slide!);
        changed.add(op.id);
        break;
      }
      case "set_theme":
        theme = op.theme;
        break;
    }
  }
  return { spec: { ...spec, theme, slides }, changedIds: [...changed], problems };
}

/** Muse Wonder interprets a natural-language revision as targeted spec operations. */
export async function planRevision(opts: {
  client: MuseClient;
  spec: DeckSpec;
  instruction: string;
  claims: Claim[];
  recorder: RunRecorder;
}): Promise<RevisionPlan> {
  const event = await opts.recorder.start("step", "plan_revision", { instruction: opts.instruction }, modelFor("planner"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("planner"),
      purpose: "plan_revision",
      schema: revisionPlanSchema,
      schemaName: "RevisionPlan",
      maxTokens: 12_000,
      messages: [
        { role: "system", content: REVISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Revision request: ${opts.instruction}\n\nCurrent deck specification:\n${JSON.stringify(opts.spec)}\n\nRecorded claims (cite these refs for new content):\n${renderClaimsForPrompt(opts.claims)}`,
        },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    await event.succeed({ summary: data.summary, operations: data.operations.map((o) => o.op) });
    return data;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "revision planning failed");
    throw err;
  }
}
