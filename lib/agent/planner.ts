import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { COMPOSE_SYSTEM_PROMPT, OUTLINE_SYSTEM_PROMPT, REVISION_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { formatCitation, type Claim } from "@/lib/evidence/evidence";
import {
  ARRANGEMENTS,
  BLOCK_TYPES,
  contentsSlide,
  coverSlide,
  deckSpecSchema,
  normalizeDeckSpec,
  pageSlide,
  slideSchema,
  THEMES,
  type DeckSpec,
  type Slide,
  type SpecIssue,
} from "@/lib/presentation/spec";
import type { GenerateRequest } from "@/lib/validation/request";
import type { RepositoryAnalysis } from "./analysis-schema";
import type { RunRecorder } from "./recorder";

export function renderClaimsForPrompt(claims: Claim[]): string {
  return claims
    .map((c) => `${c.ref} [${c.status}] (${c.claimType}) ${c.claim}${formatCitation(c) ? ` — ${formatCitation(c)}` : ""}`)
    .join("\n");
}

function repoFacts(snapshot: Pick<SourceSnapshot, "displayName" | "branch" | "version" | "stats" | "metadata">): string {
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

/** The evidence every deck prompt carries: computed facts, the analysis and the recorded claims. */
export function deckEvidence(opts: {
  snapshot: Pick<SourceSnapshot, "displayName" | "branch" | "version" | "stats" | "metadata">;
  analysis: RepositoryAnalysis;
  claims: Claim[];
}): string {
  return [
    `Repository facts (computed by GitFill, safe to cite as numbers):\n${repoFacts(opts.snapshot)}`,
    `Repository analysis:\n${JSON.stringify(opts.analysis)}`,
    `Recorded claims:\n${renderClaimsForPrompt(opts.claims)}`,
  ].join("\n\n");
}

const outlineSchema = z.object({
  project: z.string().trim().min(1).max(60).describe("The project's name."),
  title: z.string().trim().min(1).max(90),
  subtitle: z.string().max(160).default(""),
  slides: z
    .array(
      z.object({
        id: z.string().regex(/^s\d+$/),
        layout: z.enum(["cover", "contents", "page"]),
        section: z.string().trim().max(36).default("").describe("Section name for pages; empty for cover and contents."),
        title: z.string().trim().min(1).max(80),
        intent: z.string().trim().min(1).max(600).describe("What the page must show: the analysis items and claim refs to use."),
        arrangement: z.enum(ARRANGEMENTS).optional(),
        blocks: z.array(z.enum(BLOCK_TYPES as [string, ...string[]])).max(5).default([]).describe("Block types in order, main column first."),
      }),
    )
    .min(2)
    .max(24),
});

export type DeckOutline = z.infer<typeof outlineSchema>;

/**
 * Plans a deck in two stages: Muse Wonder writes the outline (sections, one brief per page),
 * then every page is composed in parallel from its brief and the full evidence. A page that
 * fails to compose falls back to a minimal page the repair loop can grow.
 */
export async function planDeck(opts: {
  client: MuseClient;
  snapshot: SourceSnapshot;
  analysis: RepositoryAnalysis;
  claims: Claim[];
  request: GenerateRequest;
  recorder: RunRecorder;
}): Promise<{ spec: DeckSpec; issues: SpecIssue[] }> {
  const { request } = opts;
  const evidence = deckEvidence(opts);
  const known = new Set(opts.claims.map((c) => c.ref));
  const brief = [
    `Request: ${request.purpose}`,
    `Audience: ${request.audience}`,
    `Slide count: exactly ${request.slideCount}`,
    request.instructions ? `Additional instructions from the user: ${request.instructions}` : "",
    request.brief ? `Reader brief agreed with the user (it outranks the default story order; follow its framing, emphasis, names to feature and things to skip):\n${request.brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const outline = await planOutline({ ...opts, brief, evidence });
  const metaLine = `${opts.snapshot.displayName} · ${opts.snapshot.branch} · ${opts.snapshot.version.slice(0, 7)}`;
  const slides = await composeSlides({ client: opts.client, recorder: opts.recorder, outline, brief, evidence, metaLine, audience: request.audience });

  const spec = deckSpecSchema.parse({
    project: outline.project,
    title: outline.title,
    subtitle: outline.subtitle,
    audience: request.audience,
    purpose: request.purpose.slice(0, 240) || "Explain the repository.",
    theme: request.theme,
    slides,
  });
  return normalizeDeckSpec(spec, known);
}

async function planOutline(opts: { client: MuseClient; recorder: RunRecorder; request: GenerateRequest; brief: string; evidence: string }): Promise<DeckOutline> {
  const n = opts.request.slideCount;
  const schema = outlineSchema
    .refine((o) => o.slides.length === n, { message: `The outline must have exactly ${n} slides.`, path: ["slides"] })
    .refine((o) => o.slides[0]?.layout === "cover", { message: "Slide 1 must be the cover.", path: ["slides", 0, "layout"] });
  const event = await opts.recorder.start("step", "plan_outline", { slideCount: n, audience: opts.request.audience }, modelFor("planner"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("planner"),
      purpose: "plan_outline",
      schema,
      schemaName: "DeckOutline",
      correctionAttempts: 2,
      // Hidden reasoning counts against max_tokens; the outline reasons over the whole analysis.
      maxTokens: 24_000,
      messages: [
        { role: "system", content: OUTLINE_SYSTEM_PROMPT },
        { role: "user", content: `${opts.brief}\n\n${opts.evidence}` },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const slides = data.slides.map((s, i) => ({ ...s, id: `s${i + 1}`, section: s.section || (s.layout === "page" ? "Overview" : "") }));
    await event.succeed({ title: data.title, slides: slides.map((s) => `${s.id}:${s.layout}${s.section ? `:${s.section}` : ""}`) });
    return { ...data, slides };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "outline failed");
    throw err;
  }
}

const COMPOSE_CONCURRENCY = 6;

async function composeSlides(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  outline: DeckOutline;
  brief: string;
  evidence: string;
  metaLine: string;
  audience: string;
}): Promise<Slide[]> {
  const { outline } = opts;
  const map = outline.slides.map((s) => `${s.id} [${s.layout}${s.section ? ` · ${s.section}` : ""}] ${s.title}: ${s.intent}`).join("\n");
  const out: Slide[] = new Array(outline.slides.length);
  let next = 0;
  const worker = async () => {
    while (next < outline.slides.length) {
      const i = next++;
      out[i] = await composeSlide({ ...opts, item: outline.slides[i]!, map });
    }
  };
  await Promise.all(Array.from({ length: Math.min(COMPOSE_CONCURRENCY, outline.slides.length) }, worker));
  return out;
}

async function composeSlide(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  item: DeckOutline["slides"][number];
  map: string;
  brief: string;
  evidence: string;
  metaLine: string;
  audience: string;
}): Promise<Slide> {
  const { item } = opts;
  if (item.layout === "contents") return contentsSlide.parse({ id: item.id, layout: "contents", title: item.title || "Contents", lede: item.intent.slice(0, 160) });

  const schema =
    item.layout === "cover"
      ? coverSlide.refine((s) => s.id === item.id, { message: `id must be "${item.id}"`, path: ["id"] })
      : pageSlide.refine((s) => s.id === item.id, { message: `id must be "${item.id}"`, path: ["id"] });
  const page = [
    `Compose slide ${item.id} (layout "${item.layout}").`,
    item.layout === "page" ? `Section: ${item.section}` : `Title slide meta: "${opts.metaLine}". Audience: ${opts.audience}.`,
    `Working title: ${item.title}`,
    `Brief: ${item.intent}`,
    item.blocks.length ? `Suggested blocks: ${item.blocks.join(", ")}${item.arrangement ? `; arrangement: ${item.arrangement}` : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const event = await opts.recorder.start("step", "compose_slide", { slide: item.id, layout: item.layout, title: item.title }, modelFor("composer"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("composer"),
      purpose: `compose_slide:${item.id}`,
      schema,
      schemaName: item.layout === "cover" ? "CoverSlide" : "PageSlide",
      correctionAttempts: 2,
      maxTokens: 16_000,
      messages: [
        { role: "system", content: COMPOSE_SYSTEM_PROMPT },
        { role: "user", content: `${opts.brief}\n\nDeck outline (for context; compose only ${item.id}):\n${opts.map}\n\n${page}\n\n${opts.evidence}` },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const slide = (item.layout === "page" ? { ...data, section: item.section || (data as { section: string }).section } : data) as Slide;
    await event.succeed({ title: slide.title, blocks: slide.layout === "page" ? [...slide.main, ...slide.side].map((b) => b.type) : [] });
    return slide;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "compose failed");
    return fallbackSlide(item);
  }
}

/** A minimal valid page built from the brief; validation flags it as thin and the repair loop grows it. */
function fallbackSlide(item: DeckOutline["slides"][number]): Slide {
  if (item.layout === "cover") {
    return coverSlide.parse({ id: item.id, layout: "cover", title: item.title, subtitle: item.intent.slice(0, 220), visual: { type: "art" } });
  }
  return pageSlide.parse({
    id: item.id,
    layout: "page",
    section: item.section || "Overview",
    title: item.title,
    arrangement: "stack",
    main: [{ type: "callout", tone: "note", label: "In this section", text: item.intent.slice(0, 260) }],
  });
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
        z.object({ op: z.literal("set_labels"), labels: deckSpecSchema.shape.labels.unwrap() }),
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
  let labels = spec.labels;
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
      case "set_labels":
        labels = op.labels;
        break;
    }
  }
  return { spec: { ...spec, theme, labels, slides }, changedIds: [...changed], problems };
}

/**
 * The revision plan as the model writes it: operations name slides and describe changes but carry
 * no slide bodies. A full slide inside operations[] nests past the model API's 10-level schema
 * limit, so changed slides are composed one by one afterwards, like pages in planDeck.
 */
/** Fields each revision operation needs; the model fills one flat object per operation. */
const REQUIRED_FIELDS = { replace: ["id", "change"], insert: ["after", "layout", "title", "change"], delete: ["id"], move: ["id", "after"], set_theme: ["theme"], set_labels: ["labels"] } as const;

// One flat object per operation with every key present (null when unused): Muse Wonder neither
// follows anyOf branches nor optional keys reliably, but fills required keys as written.
const revisionStepSchema = z
  .object({
    op: z.enum(["replace", "insert", "delete", "move", "set_theme", "set_labels"]),
    id: z.string().nullable().describe("replace, delete, move: the slide id. Otherwise null."),
    after: z.string().nullable().describe('insert, move: the slide id to place it after, or "start". Otherwise null.'),
    layout: z.enum(["cover", "page"]).nullable().describe("insert: the new slide's layout. Otherwise null."),
    section: z.string().max(36).nullable().describe("insert: the section name for a page. Otherwise null."),
    title: z.string().max(80).nullable().describe("insert: working title. replace: the new title when the request renames the slide, else null. Otherwise null."),
    change: z.string().max(800).nullable().describe("replace: exactly what to change and what to keep. insert: what the new slide must show, with the analysis items and claim refs to use. Otherwise null."),
    theme: z.enum(THEMES).nullable().describe("set_theme: the new theme. Otherwise null."),
    labels: deckSpecSchema.shape.labels.unwrap().nullable().describe("set_labels: the complete new labels (header, footer, cover), starting from the current ones. Otherwise null."),
  })
  .superRefine((step, ctx) => {
    for (const field of REQUIRED_FIELDS[step.op]) {
      if (!step[field]) ctx.addIssue({ code: "custom", path: [field], message: `"${field}" is required for op "${step.op}".` });
    }
  });

export const revisionStepsSchema = z.object({
  summary: z.string().min(1).max(400),
  operations: z.array(revisionStepSchema).max(20).describe("Empty when nothing in the deck can carry out the request."),
});

type RevisionSteps = z.infer<typeof revisionStepsSchema>;

/** Muse Wonder interprets a natural-language revision as targeted operations; changed slides are then composed in parallel. */
export async function planRevision(opts: {
  client: MuseClient;
  spec: DeckSpec;
  instruction: string;
  claims: Claim[];
  /** Full evidence (deckEvidence) when the snapshot analysis is available; claims alone otherwise. */
  evidence?: string;
  recorder: RunRecorder;
}): Promise<RevisionPlan> {
  const evidence = opts.evidence ?? `Recorded claims (cite these refs for new content):\n${renderClaimsForPrompt(opts.claims)}`;
  const event = await opts.recorder.start("step", "plan_revision", { instruction: opts.instruction }, modelFor("planner"));
  let steps: RevisionSteps;
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("planner"),
      purpose: "plan_revision",
      schema: revisionStepsSchema,
      schemaName: "RevisionSteps",
      correctionAttempts: 2,
      maxTokens: 16_000,
      messages: [
        { role: "system", content: REVISION_SYSTEM_PROMPT },
        { role: "user", content: `Revision request: ${opts.instruction}\n\nCurrent deck specification:\n${JSON.stringify(opts.spec)}\n\n${evidence}` },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    // Targets let a live view mark the slides being rewritten before anything renders.
    await event.succeed({ summary: data.summary, operations: data.operations.map((o) => o.op), targets: data.operations.flatMap((o) => (o.op === "replace" || o.op === "delete" || o.op === "move" ? [o.id!] : [])) });
    steps = data;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "revision planning failed");
    throw err;
  }

  const byId = new Map(opts.spec.slides.map((s) => [s.id, s]));
  const used = new Set(byId.keys());
  const operations = await Promise.all(
    steps.operations.map(async (op): Promise<RevisionPlan["operations"][number] | null> => {
      if (op.op === "replace") {
        const current = byId.get(op.id!);
        // Unknown ids are reported by applyRevision; nothing to compose.
        if (!current) return { op: "replace", slide: fallbackSlide({ id: op.id!, layout: "page", section: "Overview", title: op.id!, intent: op.change!, blocks: [] }) };
        if (current.layout === "contents") return null;
        const slide = await reviseSlide({ ...opts, evidence, id: op.id!, layout: current.layout, task: `Current slide:\n${JSON.stringify(current)}\n\nChange to make: ${op.change}\nReturn the current slide with only this change applied; keep the title, blocks and wording the change does not mention exactly as they are.` });
        // A requested rename is applied exactly; the composer tends to keep the current title.
        const next = slide ?? current;
        return { op: "replace", slide: op.title ? { ...next, title: op.title } : next };
      }
      if (op.op === "insert") {
        let n = opts.spec.slides.length + 1;
        while (used.has(`s${n}`)) n++;
        const id = `s${n}`;
        used.add(id);
        const item = { id, layout: op.layout!, section: op.section || "Overview", title: op.title!, intent: op.change!, blocks: [] };
        const slide = await reviseSlide({ ...opts, evidence, id, layout: item.layout, task: `New slide${item.layout === "page" ? ` in section "${item.section}"` : ""}. Working title: ${item.title}\nBrief: ${item.intent}` });
        return { op: "insert", after: op.after!, slide: slide ?? fallbackSlide(item) };
      }
      if (op.op === "delete") return { op: "delete", id: op.id! };
      if (op.op === "move") return { op: "move", id: op.id!, after: op.after! };
      if (op.op === "set_theme") return { op: "set_theme", theme: op.theme! };
      return { op: "set_labels", labels: op.labels! };
    }),
  );
  return { summary: steps.summary, operations: operations.filter((o) => o !== null) };
}

async function reviseSlide(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  spec: DeckSpec;
  evidence: string;
  id: string;
  layout: "cover" | "page";
  task: string;
}): Promise<Slide | null> {
  const schema =
    opts.layout === "cover"
      ? coverSlide.refine((s) => s.id === opts.id, { message: `id must be "${opts.id}"`, path: ["id"] })
      : pageSlide.refine((s) => s.id === opts.id, { message: `id must be "${opts.id}"`, path: ["id"] });
  const map = opts.spec.slides.map((s) => `${s.id} [${s.layout}${s.layout === "page" ? ` · ${s.section}` : ""}] ${s.title}`).join("\n");
  const event = await opts.recorder.start("step", "compose_slide", { slide: opts.id, layout: opts.layout }, modelFor("composer"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("composer"),
      purpose: `revise_slide:${opts.id}`,
      schema,
      schemaName: opts.layout === "cover" ? "CoverSlide" : "PageSlide",
      correctionAttempts: 2,
      maxTokens: 16_000,
      messages: [
        { role: "system", content: COMPOSE_SYSTEM_PROMPT },
        { role: "user", content: `Deck pages (for context; compose only ${opts.id}, and only the change below; other operations of this revision are handled separately):\n${map}\n\nCompose slide ${opts.id} (layout "${opts.layout}").\n${opts.task}\n\n${opts.evidence}` },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    await event.succeed({ title: (data as Slide).title });
    return data as Slide;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "compose failed");
    return null;
  }
}
