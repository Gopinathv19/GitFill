import { z } from "zod";

/**
 * The deck specification: the editable source of truth. The model fills it in; layout
 * code alone decides geometry. Limits here are the content-density rules.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const claimRefs = z.array(z.string().regex(/^C\d+$/)).max(6).default([]);

export const bulletSchema = z.object({
  text: text(160),
  claimRefs,
});

const slideBase = {
  id: z.string().regex(/^s\d+$/).describe("Stable slide id, e.g. s1, s2. Keep ids unchanged when revising."),
  title: text(70),
  notes: z.string().max(1200).default("").describe("Speaker notes: what to say, plus context that does not fit on the slide."),
  claimRefs,
};

export const titleSlide = z.object({
  ...slideBase,
  layout: z.literal("title"),
  subtitle: text(120),
  meta: z.string().max(100).optional().describe("e.g. 'owner/repo · commit abc1234'"),
  illustrationPrompt: z.string().max(400).optional().describe("Optional abstract background art prompt (no text, no logos)."),
});

export const sectionSlide = z.object({
  ...slideBase,
  layout: z.literal("section"),
  subtitle: z.string().max(140).optional(),
});

export const bulletsSlide = z.object({
  ...slideBase,
  layout: z.literal("bullets"),
  keyMessage: z.string().max(140).optional().describe("One-sentence takeaway shown prominently."),
  bullets: z.array(bulletSchema).min(1).max(6),
});

export const twoColumnSlide = z.object({
  ...slideBase,
  layout: z.literal("two_column"),
  left: z.object({ heading: text(40), bullets: z.array(bulletSchema).min(1).max(5) }),
  right: z.object({ heading: text(40), bullets: z.array(bulletSchema).min(1).max(5) }),
});

export const architectureSlide = z.object({
  ...slideBase,
  layout: z.literal("architecture"),
  nodes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{1,24}$/),
        label: text(28),
        detail: z.string().max(60).optional(),
        tier: z.number().int().min(0).max(3).describe("Column from left to right: 0 = clients/entry, 3 = storage/external."),
      }),
    )
    .min(2)
    .max(10),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(24).optional() })).max(14),
  caption: z.string().max(160).optional(),
});

export const flowSlide = z.object({
  ...slideBase,
  layout: z.literal("flow"),
  steps: z.array(z.object({ label: text(28), detail: z.string().max(110).optional(), claimRefs })).min(2).max(6),
});

export const stackSlide = z.object({
  ...slideBase,
  layout: z.literal("stack"),
  groups: z
    .array(z.object({ category: text(24), items: z.array(z.object({ name: text(28), note: z.string().max(50).optional(), claimRefs })).min(1).max(5) }))
    .min(1)
    .max(4),
});

export const timelineSlide = z.object({
  ...slideBase,
  layout: z.literal("timeline"),
  items: z.array(z.object({ label: text(24), detail: z.string().max(110).optional() })).min(2).max(5),
});

export const metricsSlide = z.object({
  ...slideBase,
  layout: z.literal("metrics"),
  metrics: z.array(z.object({ value: text(12), label: text(40), claimRefs })).min(1).max(4),
  bullets: z.array(bulletSchema).max(3).default([]),
});

export const closingSlide = z.object({
  ...slideBase,
  layout: z.literal("closing"),
  bullets: z.array(bulletSchema).max(4).default([]),
});

export const slideSchema = z.discriminatedUnion("layout", [
  titleSlide,
  sectionSlide,
  bulletsSlide,
  twoColumnSlide,
  architectureSlide,
  flowSlide,
  stackSlide,
  timelineSlide,
  metricsSlide,
  closingSlide,
]);

export const THEMES = ["midnight", "daylight"] as const;
export type ThemeName = (typeof THEMES)[number];

export const deckSpecSchema = z.object({
  title: text(90),
  subtitle: z.string().max(160).default(""),
  audience: text(120),
  purpose: text(240),
  theme: z.enum(THEMES).default("midnight"),
  slides: z.array(slideSchema).min(2).max(20),
});

export type DeckSpec = z.infer<typeof deckSpecSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type SlideLayout = Slide["layout"];
export type Bullet = z.infer<typeof bulletSchema>;

/** All claim refs used by a slide, at any depth. */
export function slideClaimRefs(slide: Slide): string[] {
  const out = [...slide.claimRefs];
  const add = (items: { claimRefs?: string[] }[] | undefined) => items?.forEach((i) => out.push(...(i.claimRefs ?? [])));
  switch (slide.layout) {
    case "bullets":
    case "closing":
      add(slide.bullets);
      break;
    case "metrics":
      add(slide.metrics);
      add(slide.bullets);
      break;
    case "two_column":
      add(slide.left.bullets);
      add(slide.right.bullets);
      break;
    case "flow":
      add(slide.steps);
      break;
    case "stack":
      slide.groups.forEach((g) => add(g.items));
      break;
    default:
      break;
  }
  return [...new Set(out)];
}

export interface SpecIssue {
  slideId?: string;
  message: string;
}

/**
 * Semantic checks Zod cannot express: unique ids, edges between known nodes, cited claims exist.
 * Returns a repaired spec (bad edges and refs removed) and the issues found.
 */
export function normalizeDeckSpec(spec: DeckSpec, knownRefs: ReadonlySet<string>): { spec: DeckSpec; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const seen = new Set<string>();
  const slides = spec.slides.map((slide, index) => {
    let id = slide.id;
    if (seen.has(id)) {
      id = `s${index + 1}`;
      while (seen.has(id)) id = `${id}x`;
      issues.push({ slideId: slide.id, message: `Duplicate slide id renamed to ${id}.` });
    }
    seen.add(id);
    const s = structuredClone({ ...slide, id }) as Slide;

    const strip = (refs: string[]) =>
      refs.filter((r) => {
        if (knownRefs.has(r)) return true;
        issues.push({ slideId: id, message: `Removed unknown claim ref ${r}.` });
        return false;
      });
    stripRefsDeep(s, strip);

    if (s.layout === "architecture") {
      const ids = new Set(s.nodes.map((n) => n.id));
      const before = s.edges.length;
      s.edges = s.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
      if (s.edges.length !== before) issues.push({ slideId: id, message: `Removed ${before - s.edges.length} edge(s) referencing unknown nodes.` });
    }
    return s;
  });
  return { spec: { ...spec, slides }, issues };
}

function stripRefsDeep(node: unknown, strip: (refs: string[]) => string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => stripRefsDeep(n, strip));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "claimRefs" && Array.isArray(v)) obj[k] = strip(v as string[]);
    else stripRefsDeep(v, strip);
  }
}
