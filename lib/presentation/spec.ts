import { z } from "zod";
import { DECK_TYPES } from "./deck-types";
import { ICON_NAMES } from "./icons";
import { TEMPLATE_IDS } from "./themes";

/**
 * The deck specification: the editable source of truth. A slide is a fixed 16:9 page
 * composed from typed content blocks (cards, stats, tables, diagrams…). The model chooses
 * and fills blocks; the renderer alone decides geometry. Limits here are density rules.
 *
 * Text fields accept two inline marks: **bold** and `code`. The cover title also accepts
 * *accent* for the highlighted phrase.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();
/** C refs cite recorded code claims; U refs cite material the user uploaded. */
export const REF_RE = /^[CU]\d+$/;
const claimRefs = z.array(z.string().regex(REF_RE)).max(6).default([]);
const assetId = z.string().uuid().describe("Id of an uploaded image from the provided asset list.");

export const icon = z.enum(ICON_NAMES).describe("Icon from the fixed set.");
export const STATUSES = ["implemented", "partial", "planned", "unverified"] as const;
export const status = z.enum(STATUSES).describe("Evidence status: implemented = verified in code, partial, planned = designed but not built, unverified = no evidence.");
const tone = z.enum(["default", "accent", "ok", "warn", "danger", "external"]);

/* ---------------------------------------------------------------- Diagrams */

const nodeId = z.string().regex(/^[a-z0-9_]{1,24}$/);

export const architectureFigure = z.object({
  kind: z.literal("architecture"),
  lanes: z
    .array(
      z.object({
        id: nodeId,
        label: optText(32).describe("Shown above the lane, e.g. 'People', 'Backend · FastAPI', 'External'."),
        zone: z.boolean().default(false).describe("Draw a dashed boundary around the lane (a deployable unit or trust boundary)."),
      }),
    )
    .min(2)
    .max(5)
    .describe("Columns from left (callers) to right (storage/external services)."),
  nodes: z
    .array(
      z.object({
        id: nodeId,
        lane: nodeId,
        title: text(28),
        sub: optText(44).describe("What it does, a few words."),
        mono: optText(40).describe("Optional technical line: path, port, protocol or library."),
        path: optText(200).describe("Repository file or directory this node stands for, from the evidence. Checked against the repository."),
        tone: tone.default("default"),
      }),
    )
    .min(2)
    .max(14),
  edges: z
    .array(
      z.object({
        from: nodeId,
        to: nodeId,
        label: optText(22).describe("1-3 words: what moves along the edge."),
        style: z.enum(["solid", "dashed", "accent"]).default("solid"),
      }),
    )
    .max(18),
});

export const flowFigure = z.object({
  kind: z.literal("flow"),
  steps: z
    .array(
      z.object({
        title: text(32),
        sub: optText(52),
        branch: z
          .object({
            when: text(24).describe("Condition on the arrow, e.g. 'nothing left', 'cache hit'."),
            title: text(32),
            sub: optText(52),
            tone: tone.default("warn"),
          })
          .optional()
          .describe("Early exit or side path taken from this step."),
      }),
    )
    .min(2)
    .max(8),
  outcomes: z
    .array(z.object({ title: text(24), sub: optText(52), tone: tone.default("ok") }))
    .max(3)
    .default([])
    .describe("Possible end results after the last step."),
});

export const decisionFigure = z.object({
  kind: z.literal("decision"),
  checks: z
    .array(
      z.object({
        question: text(26),
        sub: optText(26),
        yes: z.object({ title: text(28), sub: optText(46), tone: tone.default("default") }),
      }),
    )
    .min(2)
    .max(6),
  otherwise: z.object({ title: text(28), sub: optText(46) }),
});

const seqMessage = z.object({
  from: nodeId,
  to: nodeId,
  label: text(48),
  reply: z.boolean().default(false).describe("Response or async return (dashed)."),
});

export const sequenceFigure = z.object({
  kind: z.literal("sequence"),
  actors: z.array(z.object({ id: nodeId, label: text(20), sub: optText(22), path: optText(200).describe("Repository file or directory of this participant."), accent: z.boolean().default(false) })).min(2).max(7),
  steps: z
    .array(z.union([seqMessage, z.object({ group: text(40), steps: z.array(seqMessage).min(1).max(8) })]))
    .min(2)
    .max(14),
});

export const statesFigure = z.object({
  kind: z.literal("states"),
  states: z.array(z.object({ id: nodeId, title: text(20), sub: optText(36), tone: tone.default("default") })).min(2).max(6),
  transitions: z.array(z.object({ from: nodeId, to: nodeId, label: text(36) })).min(1).max(10),
});

export const figureSchema = z.discriminatedUnion("kind", [architectureFigure, flowFigure, decisionFigure, sequenceFigure, statesFigure]);
export type Figure = z.infer<typeof figureSchema>;

/* ------------------------------------------------------------------ Blocks */

export const cardsBlock = z.object({
  type: z.literal("cards"),
  columns: z.number().int().min(2).max(4),
  items: z
    .array(
      z.object({
        icon,
        title: text(48),
        text: text(220).describe("One or two full sentences."),
        status: status.optional(),
        emphasis: z.boolean().default(false).describe("Highlight this card (at most one per block)."),
        claimRefs,
      }),
    )
    .min(2)
    .max(8),
});

export const statsBlock = z.object({
  type: z.literal("stats"),
  items: z
    .array(z.object({ value: text(14), unit: optText(10), label: text(40), note: optText(60), claimRefs }))
    .min(2)
    .max(6),
});

export const stepsBlock = z.object({
  type: z.literal("steps"),
  title: optText(48),
  direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
  items: z.array(z.object({ title: text(40), text: text(160), claimRefs })).min(2).max(6),
});

export const tableBlock = z.object({
  type: z.literal("table"),
  title: optText(48),
  columns: z.array(text(30)).min(1).max(4).describe("Headers of the value columns (the row head column has none)."),
  rows: z
    .array(z.object({ head: text(60), cells: z.array(z.string().trim().max(120)).min(1).max(4).describe('One per column. "yes"/"no" render as a check or a dash.'), claimRefs }))
    .min(2)
    .max(8),
  highlightColumn: z.number().int().min(0).max(3).optional(),
});

export const listBlock = z.object({
  type: z.literal("list"),
  title: text(48),
  hint: optText(40),
  items: z.array(z.object({ text: text(200), status: status.optional(), claimRefs })).min(2).max(7),
});

export const calloutBlock = z.object({
  type: z.literal("callout"),
  tone: z.enum(["takeaway", "note", "limit"]).default("takeaway"),
  label: optText(30),
  text: text(260),
  claimRefs,
});

export const explainBlock = z.object({
  type: z.literal("explain"),
  purpose: text(200),
  behavior: text(200),
  value: text(200),
  limits: optText(200),
  claimRefs,
});

export const componentsBlock = z.object({
  type: z.literal("components"),
  columns: z.number().int().min(2).max(4),
  items: z
    .array(
      z.object({
        icon,
        name: text(40),
        role: optText(30).describe("Short kind label, e.g. 'API · Python', 'External · storage'."),
        text: text(200),
        tech: optText(60).describe("Technologies, e.g. 'FastAPI · SQLAlchemy 2'."),
        claimRefs,
      }),
    )
    .min(2)
    .max(8),
});

export const codeBlock = z.object({
  type: z.literal("code"),
  title: text(48),
  lines: z.array(z.string().max(100)).min(1).max(14).describe("Only commands or code that appear in the evidence."),
  caption: optText(120),
  claimRefs,
});

export const flashcardsBlock = z.object({
  type: z.literal("flashcards"),
  items: z.array(z.object({ q: text(100), a: text(140) })).min(4).max(12),
});

export const glossaryBlock = z.object({
  type: z.literal("glossary"),
  items: z.array(z.object({ term: text(40), code: optText(30), def: text(140) })).min(6).max(24),
});

export const diagramBlock = z.object({
  type: z.literal("diagram"),
  title: text(60),
  hint: optText(60).describe("Small right-aligned note, e.g. the source folder or 'left: callers · right: storage'."),
  figure: figureSchema,
  claimRefs,
});

export const imageBlock = z.object({
  type: z.literal("image"),
  assetId,
  title: optText(60),
  caption: optText(160).describe("What the image shows and why it matters."),
  frame: z.enum(["browser", "device", "plain"]).default("plain").describe("browser = web app screenshot, device = phone screenshot, plain = anything else."),
  fit: z.enum(["contain", "cover"]).default("contain"),
  claimRefs,
});

export const blockSchema = z.discriminatedUnion("type", [
  cardsBlock,
  statsBlock,
  stepsBlock,
  tableBlock,
  listBlock,
  calloutBlock,
  explainBlock,
  componentsBlock,
  codeBlock,
  flashcardsBlock,
  glossaryBlock,
  diagramBlock,
  imageBlock,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export const BLOCK_TYPES = blockSchema.options.map((o) => o.shape.type.value) as BlockType[];

/* ------------------------------------------------------------------ Slides */

const slideBase = {
  id: z.string().regex(/^s\d+x*$/).describe("Stable slide id, e.g. s1, s2. Keep ids unchanged when revising."),
  notes: z.string().max(1500).default("").describe("Speaker notes: what to say, plus context that does not fit on the slide."),
  claimRefs,
};

export const coverVisual = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal"),
    title: text(40),
    lines: z.array(z.object({ text: z.string().max(80), kind: z.enum(["command", "output", "comment"]).default("command") })).min(3).max(12),
  }),
  z.object({ type: z.literal("tree"), title: text(40), items: z.array(z.object({ path: text(60), note: optText(40) })).min(3).max(10) }),
  z.object({ type: z.literal("stats"), items: z.array(z.object({ value: text(14), unit: optText(10), label: text(40) })).min(2).max(4) }),
  z.object({ type: z.literal("art") }),
  z.object({ type: z.literal("image"), assetId, caption: optText(80) }),
]);

export const coverSlide = z.object({
  ...slideBase,
  layout: z.literal("cover"),
  kicker: optText(40).describe("Small label above the title, e.g. 'Architecture overview'."),
  title: text(110).describe("A claim about the project, not just its name. Wrap the key phrase in *asterisks* to highlight it."),
  subtitle: text(220),
  tag: optText(30).describe("Short tag top-right, e.g. the branch or the month."),
  visual: coverVisual,
  meta: z.array(z.object({ label: text(20), value: text(60) })).max(4).default([]),
  illustrationPrompt: optText(400).describe("Only for visual 'art': abstract background art prompt (no text, no logos)."),
});

export const contentsSlide = z.object({
  ...slideBase,
  layout: z.literal("contents"),
  title: text(40).default("Contents"),
  lede: optText(160),
});

export const ARRANGEMENTS = ["stack", "split", "split_even", "rail"] as const;

export const pageSlide = z.object({
  ...slideBase,
  layout: z.literal("page"),
  section: text(36).describe("Section name; consecutive pages share it, e.g. 'Architecture'."),
  title: text(80),
  lede: optText(260).describe("One or two sentences under the title that state the page's point."),
  style: z.enum(["atlas", "editorial", "cards"]).default("atlas").describe("Background: atlas = soft glow, editorial = flat, cards = dot grid."),
  arrangement: z
    .enum(ARRANGEMENTS)
    .default("split")
    .describe("stack = blocks full width; split = wide main + narrower side; split_even = two equal columns; rail = narrow left rail + wide main."),
  density: z.enum(["normal", "compact", "tight"]).default("normal").describe("Set by validation; keep as is."),
  main: z.array(blockSchema).min(1).max(3),
  side: z.array(blockSchema).max(3).default([]),
});

export const slideSchema = z.discriminatedUnion("layout", [coverSlide, contentsSlide, pageSlide]);

export const THEMES = TEMPLATE_IDS;
export type ThemeName = (typeof THEMES)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const fontName = z.string().regex(/^[A-Za-z0-9 \-]{2,40}$/);

export const brandSchema = z.object({
  name: z.string().trim().max(60).optional(),
  accent: hexColor.optional(),
  accent2: hexColor.optional(),
  background: hexColor.optional(),
  text: hexColor.optional(),
  mode: z.enum(["dark", "light"]).optional(),
  headingFont: fontName.optional(),
  bodyFont: fontName.optional(),
  logoAssetId: z.string().uuid().optional(),
});

/** Uploaded material a deck was made with: images it may show, documents it drew from (U refs). */
export const materialSchema = z.object({
  id: z.string().uuid(),
  ref: z.string().regex(/^U\d+$/),
  kind: z.enum(["image", "document", "template"]),
  name: z.string().max(200),
  description: z.string().max(600).default(""),
});
export type Material = z.infer<typeof materialSchema>;

export const deckSpecSchema = z.object({
  format: z.literal(2).default(2),
  project: z.string().trim().max(60).optional().describe("The project's name, shown in every page header."),
  title: text(90),
  subtitle: z.string().max(160).default(""),
  audience: text(120),
  purpose: text(240),
  theme: z.enum(THEMES).default("midnight").describe("Template id."),
  brand: brandSchema.optional(),
  /** True when the brand was read from the analyzed repository alone (not set by the user or a .pptx template). */
  brandFromRepo: z.boolean().optional(),
  deckType: z.enum(DECK_TYPES).default("engineering_walkthrough"),
  materials: z.array(materialSchema).max(40).default([]),
  /** Legacy switch from before `labels`; only used to fill in default labels for older decks. */
  showCommit: z.boolean().default(true),
  /**
   * The words around the slides: page header, page footer and the cover's fact row. Filled from the
   * repository facts when a deck is built, then edited like any other content.
   */
  labels: z
    .object({
      header: z.string().max(120).describe("Right side of every page header, e.g. 'owner/repo · main'. Empty hides it."),
      footer: z.string().max(160).describe("Page footer text after the GitFill mark. Empty hides it."),
      cover: z.array(z.object({ label: z.string().min(1).max(30), value: z.string().min(1).max(80) })).max(5).describe("The cover's fact row, in order."),
    })
    .optional(),
  slides: z.array(slideSchema).min(2).max(24),
});

export type Brand = z.infer<typeof brandSchema>;

export type DeckSpec = z.infer<typeof deckSpecSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type SlideLayout = Slide["layout"];
export type PageSlide = z.infer<typeof pageSlide>;
export type CoverSlide = z.infer<typeof coverSlide>;

/** Display title of any slide. */
export function slideTitle(slide: Slide): string {
  return slide.title;
}

/** Every block on a page, main column first. */
export function pageBlocks(slide: Slide): Block[] {
  return slide.layout === "page" ? [...slide.main, ...slide.side] : [];
}

/** All claim refs used by a slide, at any depth. */
export function slideClaimRefs(slide: Slide): string[] {
  const out: string[] = [];
  walkRefs(slide, (refs) => {
    out.push(...refs);
    return refs;
  });
  return [...new Set(out)];
}

export interface SpecIssue {
  slideId?: string;
  message: string;
}

/**
 * Semantic checks Zod cannot express: unique ids, diagram references to known nodes,
 * cited claims exist. Returns a repaired spec (bad edges and refs removed) and the issues found.
 */
export function normalizeDeckSpec(spec: DeckSpec, knownRefs: ReadonlySet<string>, opts: { paths?: ReadonlySet<string> } = {}): { spec: DeckSpec; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const images = new Set(spec.materials.filter((m) => m.kind === "image").map((m) => m.id));
  const known = new Set([...knownRefs, ...spec.materials.map((m) => m.ref)]);
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
    // The renderer numbers sections itself; "02 · Architecture" would read "02 · 02 · Architecture".
    if (s.layout === "page") s.section = s.section.replace(/^\s*\d+\s*[·.:)\-–—]\s*/, "").trim() || s.section;

    walkRefs(s, (refs) =>
      refs.filter((r) => {
        if (known.has(r)) return true;
        issues.push({ slideId: id, message: `Removed unknown claim ref ${r}.` });
        return false;
      }),
    );
    if (s.layout === "page") {
      // An image the deck has no upload for cannot be shown; drop it rather than render a hole.
      const keep = (b: Block) => {
        if (b.type !== "image" || images.has(b.assetId)) return true;
        issues.push({ slideId: id, message: `Removed an image block with unknown asset ${b.assetId}.` });
        return false;
      };
      s.main = s.main.filter(keep);
      s.side = s.side.filter(keep);
      if (!s.main.length && s.side.length) s.main = [s.side.shift()!];
      if (!s.main.length) s.main = [{ type: "callout", tone: "note", text: s.lede || s.title, claimRefs: [] }];
    }
    if (s.layout === "cover" && s.visual.type === "image" && !images.has(s.visual.assetId)) {
      issues.push({ slideId: id, message: "Cover image has an unknown asset; using the cover art slot instead." });
      s.visual = { type: "art" };
    }
    for (const block of pageBlocks(s)) {
      if (block.type === "diagram") {
        normalizeFigure(block.figure, (m) => issues.push({ slideId: id, message: m }));
        if (opts.paths) checkFigurePaths(block.figure, opts.paths, (m) => issues.push({ slideId: id, message: m }));
      }
      if (block.type === "table") {
        const n = block.columns.length;
        for (const row of block.rows) {
          if (row.cells.length > n) row.cells = row.cells.slice(0, n);
          while (row.cells.length < n) row.cells.push("");
        }
        if (block.highlightColumn !== undefined && block.highlightColumn >= n) delete block.highlightColumn;
      }
    }
    return s;
  });
  return { spec: { ...spec, slides }, issues };
}

/** True when `p` names a file in the repository or a directory that contains one. */
export function pathExists(p: string, paths: ReadonlySet<string>): boolean {
  const clean = p.trim().replace(/^\.?\//, "").replace(/:\d+(-\d+)?$/, "").replace(/\/+$/, "");
  if (!clean) return false;
  if (paths.has(clean)) return true;
  for (const x of paths) if (x.startsWith(`${clean}/`)) return true;
  return false;
}

/**
 * Diagram nodes may name the repository path they stand for. A path that does not exist is
 * removed and the node is drawn as inferred (dashed), so the picture never claims code that is
 * not there.
 */
export function checkFigurePaths(f: Figure, paths: ReadonlySet<string>, report: (message: string) => void): void {
  if (f.kind === "architecture") {
    for (const n of f.nodes) {
      if (n.path && !pathExists(n.path, paths)) {
        report(`Diagram node "${n.title}" named ${n.path}, which is not in the repository; marked as inferred.`);
        delete n.path;
        if (n.tone === "default") n.tone = "external";
      }
    }
  } else if (f.kind === "sequence") {
    for (const a of f.actors) {
      if (a.path && !pathExists(a.path, paths)) {
        report(`Sequence actor "${a.label}" named ${a.path}, which is not in the repository.`);
        delete a.path;
      }
    }
  }
}

/** Drops edges, transitions and messages that point at unknown ids; reports what was dropped. */
export function normalizeFigure(f: Figure, report: (message: string) => void): void {
  switch (f.kind) {
    case "architecture": {
      const lanes = new Set(f.lanes.map((l) => l.id));
      const firstLane = f.lanes[0]!.id;
      for (const n of f.nodes) {
        if (!lanes.has(n.lane)) {
          report(`Node ${n.id} named unknown lane ${n.lane}; moved to ${firstLane}.`);
          n.lane = firstLane;
        }
      }
      const ids = new Set(f.nodes.map((n) => n.id));
      const before = f.edges.length;
      f.edges = f.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
      if (f.edges.length !== before) report(`Removed ${before - f.edges.length} edge(s) referencing unknown nodes.`);
      // Empty lanes waste a column.
      const used = new Set(f.nodes.map((n) => n.lane));
      f.lanes = f.lanes.filter((l) => used.has(l.id));
      break;
    }
    case "states": {
      const ids = new Set(f.states.map((s) => s.id));
      const before = f.transitions.length;
      f.transitions = f.transitions.filter((t) => ids.has(t.from) && ids.has(t.to) && t.from !== t.to);
      if (f.transitions.length !== before) report(`Removed ${before - f.transitions.length} transition(s) referencing unknown states.`);
      break;
    }
    case "sequence": {
      const ids = new Set(f.actors.map((a) => a.id));
      const ok = (m: { from: string; to: string }) => ids.has(m.from) && ids.has(m.to);
      const before = JSON.stringify(f.steps).length;
      f.steps = f.steps
        .map((s) => ("group" in s ? { ...s, steps: s.steps.filter(ok) } : s))
        .filter((s) => ("group" in s ? s.steps.length > 0 : ok(s)));
      if (JSON.stringify(f.steps).length !== before) report("Removed sequence messages referencing unknown actors.");
      break;
    }
    default:
      break;
  }
}

function walkRefs(node: unknown, fn: (refs: string[]) => string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walkRefs(n, fn));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "claimRefs" && Array.isArray(v)) obj[k] = fn(v as string[]);
    else walkRefs(v, fn);
  }
}
