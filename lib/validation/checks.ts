import { SLIDE_H, SLIDE_W, type Element, type LaidOutSlide, type TextElement } from "@/lib/presentation/layouts";
import type { RenderedSlide, WordBox } from "@/lib/render/renderer";

export type IssueSource = "layout" | "render" | "visual_review";
export type Severity = "low" | "medium" | "high";

export interface SlideIssue {
  slideId: string;
  slideIndex: number;
  source: IssueSource;
  code: string;
  severity: Severity;
  message: string;
  elementId?: string;
  /** Free-text suggestion (visual review only). */
  suggestion?: string;
}

const BOUNDS_TOLERANCE = 0.02;
/** Body text that only fits below this size signals an overcrowded slide. */
const DENSE_BODY_PT = 14;
const MIN_FONT: Record<TextElement["role"], number> = { title: 20, subtitle: 12, body: 11, label: 10, caption: 9, value: 18, footer: 8 };

/** Geometry checks on the computed layout, before anything is rendered. */
export function checkLayout(slides: LaidOutSlide[]): SlideIssue[] {
  const issues: SlideIssue[] = [];
  slides.forEach((slide, slideIndex) => {
    const at = { slideId: slide.slideId, slideIndex, source: "layout" as const };
    const texts = slide.elements.filter((e): e is TextElement => e.kind === "text");

    for (const el of slide.elements) {
      const b = bounds(el);
      if (b.x0 < -BOUNDS_TOLERANCE || b.y0 < -BOUNDS_TOLERANCE || b.x1 > SLIDE_W + BOUNDS_TOLERANCE || b.y1 > SLIDE_H + BOUNDS_TOLERANCE) {
        issues.push({ ...at, code: "out_of_bounds", severity: "high", elementId: el.id, message: `Element ${el.id} extends beyond the slide.` });
      }
    }
    for (const t of texts) {
      if (!t.fits) {
        issues.push({ ...at, code: "text_overflow_estimated", severity: "high", elementId: t.id, message: `Text in ${t.id} does not fit its box even at ${t.fontPt}pt.` });
      }
      if (t.fits && t.role === "body" && t.fontPt < DENSE_BODY_PT) {
        issues.push({ ...at, code: "text_dense", severity: "medium", elementId: t.id, message: `Body text in ${t.id} had to shrink to ${t.fontPt}pt to fit; the slide is too dense.` });
      }
      const smallest = Math.min(...t.paragraphs.map((p) => t.fontPt * (p.scale ?? 1)));
      if (smallest < MIN_FONT[t.role] - 0.01) {
        issues.push({ ...at, code: "text_too_small", severity: "medium", elementId: t.id, message: `Text in ${t.id} is ${Math.round(smallest)}pt (minimum ${MIN_FONT[t.role]}pt for ${t.role}).` });
      }
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const ratio = overlapRatio(bounds(texts[i]!), bounds(texts[j]!));
        if (ratio > 0.15) {
          issues.push({ ...at, code: "text_overlap", severity: "high", elementId: texts[i]!.id, message: `Text boxes ${texts[i]!.id} and ${texts[j]!.id} overlap (${Math.round(ratio * 100)}%).` });
        }
      }
    }
    const content = texts.filter((t) => t.role !== "footer" && t.role !== "title");
    if (content.length === 0 && slide.layout !== "section") {
      issues.push({ ...at, code: "empty_slide", severity: "high", message: "Slide has no content besides its title." });
    }
    if (!texts.some((t) => t.role === "title")) {
      issues.push({ ...at, code: "missing_title", severity: "medium", message: "Slide has no title." });
    }
  });
  return issues;
}

/**
 * Checks the rendered output: every rendered word must lie inside some text box.
 * A word outside all boxes means text overflowed in the real render, whatever the estimate said.
 */
export function checkRender(slides: LaidOutSlide[], rendered: RenderedSlide[]): SlideIssue[] {
  const issues: SlideIssue[] = [];
  if (rendered.length !== slides.length) {
    issues.push({ slideId: "deck", slideIndex: -1, source: "render", code: "page_count_mismatch", severity: "high", message: `Expected ${slides.length} slides, rendered ${rendered.length}.` });
  }
  slides.forEach((slide, slideIndex) => {
    const page = rendered[slideIndex];
    const at = { slideId: slide.slideId, slideIndex, source: "render" as const };
    if (!page) return;
    const texts = slide.elements.filter((e): e is TextElement => e.kind === "text");
    const expectsText = texts.some((t) => t.paragraphs.some((p) => p.text.trim()));
    if (expectsText && page.words.length === 0) {
      issues.push({ ...at, code: "render_missing_text", severity: "high", message: "No text was found in the rendered slide." });
      return;
    }
    const overflowByElement = new Map<string, number>();
    for (const word of page.words) {
      if (word.x < -0.02 || word.y < -0.02 || word.x + word.w > SLIDE_W + 0.02 || word.y + word.h > SLIDE_H + 0.02) {
        issues.push({ ...at, code: "render_off_slide", severity: "high", message: `Rendered text "${word.text}" falls outside the slide.` });
        continue;
      }
      if (texts.some((t) => contains(t, word))) continue;
      const nearest = nearestText(texts, word);
      if (nearest) overflowByElement.set(nearest.id, (overflowByElement.get(nearest.id) ?? 0) + 1);
    }
    for (const [elementId, count] of overflowByElement) {
      issues.push({ ...at, code: "text_overflow_rendered", severity: "high", elementId, message: `${count} rendered word(s) spill outside ${elementId}.` });
    }
  });
  return issues;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bounds(el: Element): Box {
  if (el.kind === "line") return { x0: Math.min(el.x1, el.x2), y0: Math.min(el.y1, el.y2), x1: Math.max(el.x1, el.x2), y1: Math.max(el.y1, el.y2) };
  return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
}

function overlapRatio(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return smaller > 0 ? (w * h) / smaller : 0;
}

/** Word center inside the text box, with a small tolerance for glyph metrics. */
function contains(t: TextElement, w: WordBox): boolean {
  const tol = 0.06;
  const cx = w.x + w.w / 2;
  const cy = w.y + w.h / 2;
  return cx >= t.x - tol && cx <= t.x + t.w + tol && cy >= t.y - tol && cy <= t.y + t.h + tol;
}

function nearestText(texts: TextElement[], w: WordBox): TextElement | undefined {
  let best: TextElement | undefined;
  let bestD = Infinity;
  const cx = w.x + w.w / 2;
  const cy = w.y + w.h / 2;
  for (const t of texts) {
    const dx = Math.max(t.x - cx, 0, cx - (t.x + t.w));
    const dy = Math.max(t.y - cy, 0, cy - (t.y + t.h));
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
