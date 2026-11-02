import type { RenderedSlide } from "@/lib/render/browser";
import { pageBlocks, type DeckSpec } from "@/lib/presentation/spec";

export type IssueSource = "layout" | "render" | "visual_review";
export type Severity = "low" | "medium" | "high";

export interface SlideIssue {
  slideId: string;
  slideIndex: number;
  source: IssueSource;
  code: string;
  severity: Severity;
  message: string;
  /** Block path on the page, e.g. "main.1". */
  elementId?: string;
  /** Free-text suggestion (visual review only). */
  suggestion?: string;
}

/** Below this share of the body height a page looks unfinished. */
export const UNDERFILL = 0.6;
/** Diagram labels rendered smaller than this are hard to read. */
const MIN_DIAGRAM_PX = 8.6;
const UNREADABLE_DIAGRAM_PX = 7.2;

/** Structural checks on the spec, before anything is rendered. */
export function checkSpec(spec: DeckSpec): SlideIssue[] {
  const issues: SlideIssue[] = [];
  spec.slides.forEach((slide, slideIndex) => {
    const at = { slideId: slide.id, slideIndex, source: "layout" as const };
    if (slideIndex === 0 && slide.layout !== "cover") issues.push({ ...at, code: "cover_missing", severity: "medium", message: "The first slide should be the cover." });
    if (slide.layout !== "page") return;
    const blocks = pageBlocks(slide);
    const diagrams = blocks.filter((b) => b.type === "diagram").length;
    if (diagrams > 2) issues.push({ ...at, code: "too_many_diagrams", severity: "medium", message: `${diagrams} diagrams on one page; at most two fit legibly.` });
    if (blocks.length === 1 && blocks[0]!.type !== "diagram" && blocks[0]!.type !== "glossary" && blocks[0]!.type !== "flashcards") {
      issues.push({ ...at, code: "thin_page", severity: "medium", message: "The page has a single block; add a supporting block (takeaway, stats, list or table)." });
    }
  });
  return issues;
}

/** Checks on the real render: overflow, empty space and diagram legibility, measured in the browser. */
export function checkRender(spec: DeckSpec, rendered: RenderedSlide[]): SlideIssue[] {
  const issues: SlideIssue[] = [];
  if (rendered.length !== spec.slides.length) {
    issues.push({ slideId: "deck", slideIndex: -1, source: "render", code: "page_count_mismatch", severity: "high", message: `Expected ${spec.slides.length} slides, rendered ${rendered.length}.` });
  }
  spec.slides.forEach((slide, slideIndex) => {
    const page = rendered[slideIndex];
    if (!page) return;
    const at = { slideId: slide.id, slideIndex, source: "render" as const };
    const m = page.measure;
    for (const o of m.overflow) {
      issues.push({
        ...at,
        code: "overflow",
        severity: "high",
        elementId: o.block ?? undefined,
        message: `Content overflows the page by ${o.over}px${o.block ? ` in block ${o.block} (${o.type})` : ""}${o.text ? `, near "${o.text}"` : ""}.`,
      });
    }
    if (slide.layout === "page" && !m.overflow.length && m.fill < UNDERFILL) {
      issues.push({ ...at, code: "underfilled", severity: "medium", message: `The page uses only ${Math.round(m.fill * 100)}% of its height; the rest is empty.` });
    }
    if (m.diagramFontPx !== null && m.diagramFontPx < MIN_DIAGRAM_PX) {
      issues.push({
        ...at,
        code: "diagram_small",
        severity: m.diagramFontPx < UNREADABLE_DIAGRAM_PX ? "high" : "medium",
        message: `Diagram labels render at ${m.diagramFontPx.toFixed(1)}px; the diagram needs more room or fewer, shorter nodes.`,
      });
    }
    const clippedByBlock = new Map<string, string[]>();
    for (const c of m.clipped) clippedByBlock.set(c.block ?? "page", [...(clippedByBlock.get(c.block ?? "page") ?? []), c.text]);
    for (const [block, texts] of clippedByBlock) {
      issues.push({ ...at, code: "diagram_text_clipped", severity: "high", elementId: block, message: `Diagram text does not fit its box: ${texts.slice(0, 3).map((t) => `"${t}"`).join(", ")}.` });
    }
  });
  return issues;
}
