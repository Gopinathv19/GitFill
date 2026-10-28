import type { Bullet, DeckSpec, Slide } from "./spec";
import { estimateHeightIn, fitFontSize, type Paragraph } from "./text-metrics";
import type { Theme } from "./themes";

/** 16:9 widescreen, inches. */
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
const M = 0.6;
const CONTENT_W = SLIDE_W - 2 * M;
const TITLE_Y = 0.45;
const TITLE_H = 0.85;
const CONTENT_Y = 1.55;
const CONTENT_BOTTOM = 6.75;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_Y;
const GAP = 0.3;

export type TextRole = "title" | "subtitle" | "body" | "label" | "caption" | "footer" | "value";

export interface TextElement {
  kind: "text";
  id: string;
  role: TextRole;
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs: Paragraph[];
  fontPt: number;
  /** False when even the minimum font size is estimated to overflow the box. */
  fits: boolean;
  color: string;
  fontFace: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  bold?: boolean;
  /** Inner padding in inches (defaults to TEXT_INSET_IN). */
  inset?: number;
}

export interface ShapeElement {
  kind: "shape";
  id: string;
  role: "decor" | "card" | "node";
  shape: "rect" | "roundRect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  line?: string;
}

export interface LineElement {
  kind: "line";
  id: string;
  role: "edge" | "decor";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  widthPt: number;
  arrow: boolean;
}

export interface ImageElement {
  kind: "image";
  id: string;
  role: "illustration";
  x: number;
  y: number;
  w: number;
  h: number;
  path: string;
}

export type Element = TextElement | ShapeElement | LineElement | ImageElement;

export interface LaidOutSlide {
  slideId: string;
  layout: Slide["layout"];
  background: string;
  elements: Element[];
  notes: string;
}

export interface LayoutContext {
  theme: Theme;
  footer: string;
  slideNumber: number;
  totalSlides: number;
  /** Local image paths keyed by slide id (generated illustrations). */
  illustrations: ReadonlyMap<string, string>;
}

export function layoutDeck(spec: DeckSpec, theme: Theme, footer: string, illustrations: ReadonlyMap<string, string> = new Map()): LaidOutSlide[] {
  return spec.slides.map((slide, i) =>
    layoutSlide(slide, { theme, footer, slideNumber: i + 1, totalSlides: spec.slides.length, illustrations }),
  );
}

export function layoutSlide(slide: Slide, ctx: LayoutContext): LaidOutSlide {
  const b = new Builder(slide.id, ctx.theme);
  switch (slide.layout) {
    case "title":
      layoutTitle(b, slide, ctx);
      break;
    case "section":
      layoutSection(b, slide, ctx);
      break;
    case "bullets":
      b.title(slide.title);
      layoutBullets(b, slide.bullets, slide.keyMessage);
      break;
    case "two_column":
      b.title(slide.title);
      layoutTwoColumn(b, slide);
      break;
    case "architecture":
      b.title(slide.title);
      layoutArchitecture(b, slide);
      break;
    case "flow":
      b.title(slide.title);
      layoutFlow(b, slide);
      break;
    case "stack":
      b.title(slide.title);
      layoutStack(b, slide);
      break;
    case "timeline":
      b.title(slide.title);
      layoutTimeline(b, slide);
      break;
    case "metrics":
      b.title(slide.title);
      layoutMetrics(b, slide);
      break;
    case "closing":
      layoutClosing(b, slide);
      break;
  }
  if (slide.layout !== "title") b.footer(ctx);
  return { slideId: slide.id, layout: slide.layout, background: ctx.theme.colors.background, elements: b.elements, notes: slide.notes };
}

class Builder {
  readonly elements: Element[] = [];
  private n = 0;
  constructor(
    readonly slideId: string,
    readonly theme: Theme,
  ) {}

  private nextId(tag: string) {
    return `${this.slideId}.${tag}${this.n++}`;
  }

  text(
    role: TextRole,
    box: { x: number; y: number; w: number; h: number },
    paragraphs: Paragraph[],
    opts: { maxPt: number; minPt: number; color?: string; align?: TextElement["align"]; valign?: TextElement["valign"]; bold?: boolean; mono?: boolean; inset?: number },
  ): TextElement {
    const { fontPt, fits } = fitFontSize(paragraphs, box.w, box.h, opts.maxPt, opts.minPt, opts.inset);
    const el: TextElement = {
      kind: "text",
      id: this.nextId(role),
      role,
      ...box,
      paragraphs,
      fontPt,
      fits,
      color: opts.color ?? this.theme.colors.text,
      fontFace: opts.mono ? this.theme.fonts.mono : role === "title" ? this.theme.fonts.heading : this.theme.fonts.body,
      align: opts.align ?? "left",
      valign: opts.valign ?? "top",
      bold: opts.bold,
      ...(opts.inset !== undefined ? { inset: opts.inset } : {}),
    };
    this.elements.push(el);
    return el;
  }

  shape(role: ShapeElement["role"], shape: ShapeElement["shape"], box: { x: number; y: number; w: number; h: number }, fill: string, line?: string) {
    this.elements.push({ kind: "shape", id: this.nextId(role), role, shape, ...box, fill, line });
  }

  line(role: LineElement["role"], x1: number, y1: number, x2: number, y2: number, color: string, widthPt: number, arrow: boolean) {
    this.elements.push({ kind: "line", id: this.nextId(role), role, x1, y1, x2, y2, color, widthPt, arrow });
  }

  image(box: { x: number; y: number; w: number; h: number }, path: string) {
    this.elements.push({ kind: "image", id: this.nextId("img"), role: "illustration", ...box, path });
  }

  title(text: string) {
    const s = this.theme.sizes;
    this.shape("decor", "rect", { x: M, y: TITLE_Y + 0.08, w: 0.08, h: TITLE_H - 0.16 }, this.theme.colors.accent);
    this.text("title", { x: M + 0.2, y: TITLE_Y, w: CONTENT_W - 0.2, h: TITLE_H }, [{ text, bold: true }], {
      maxPt: s.title,
      minPt: 22,
      valign: "middle",
      bold: true,
    });
  }

  footer(ctx: LayoutContext) {
    const c = this.theme.colors;
    this.text("footer", { x: M, y: 6.95, w: 9, h: 0.35 }, [{ text: ctx.footer }], { maxPt: 10, minPt: 8, color: c.textMuted, valign: "middle" });
    this.text("footer", { x: SLIDE_W - M - 2, y: 6.95, w: 2, h: 0.35 }, [{ text: `${ctx.slideNumber} / ${ctx.totalSlides}` }], {
      maxPt: 10,
      minPt: 8,
      color: c.textMuted,
      align: "right",
      valign: "middle",
    });
  }
}

const bulletParas = (bullets: Bullet[]): Paragraph[] => bullets.map((b) => ({ text: b.text, bullet: true }));

/** Height a text block needs at a given size (inches). */
const need = (paras: Paragraph[], w: number, pt: number) => estimateHeightIn(paras, pt, w);

/** Top offset that vertically centers a block of height h in the content area. */
const centerY = (h: number) => CONTENT_Y + Math.max(0, (CONTENT_H - h) / 2);

function layoutTitle(b: Builder, slide: Extract<Slide, { layout: "title" }>, ctx: LayoutContext) {
  const c = b.theme.colors;
  const s = b.theme.sizes;
  const art = ctx.illustrations.get(slide.id);
  const textW = art ? 6.9 : SLIDE_W - 1.6;
  if (art) b.image({ x: SLIDE_W - 5.6, y: 0, w: 5.6, h: SLIDE_H }, art);
  const titleParas = [{ text: slide.title, bold: true }];
  const titleFit = fitFontSize(titleParas, textW, 2.4, s.display, 30);
  const titleH = Math.min(2.4, need(titleParas, textW, titleFit.fontPt));
  const subParas = [{ text: slide.subtitle }];
  const subH = Math.min(1.2, need(subParas, textW, 20));
  const top = (SLIDE_H - (0.3 + titleH + 0.15 + subH)) / 2 - 0.2;
  b.shape("decor", "rect", { x: 0.9, y: top, w: 1.2, h: 0.08 }, c.accent);
  b.text("title", { x: 0.8, y: top + 0.3, w: textW, h: titleH }, titleParas, { maxPt: s.display, minPt: 30, bold: true });
  b.text("subtitle", { x: 0.8, y: top + 0.3 + titleH + 0.15, w: textW, h: subH }, subParas, { maxPt: 20, minPt: 14, color: c.textMuted });
  if (slide.meta) b.text("caption", { x: 0.8, y: 6.2, w: textW, h: 0.4 }, [{ text: slide.meta }], { maxPt: 12, minPt: 9, color: c.textMuted, mono: true });
}

function layoutSection(b: Builder, slide: Extract<Slide, { layout: "section" }>, ctx: LayoutContext) {
  const c = b.theme.colors;
  const art = ctx.illustrations.get(slide.id);
  if (art) b.image({ x: SLIDE_W - 4.6, y: 0, w: 4.6, h: SLIDE_H }, art);
  const w = art ? 7.4 : CONTENT_W - 0.4;
  b.text("label", { x: 0.8, y: 2.0, w: 3, h: 0.6 }, [{ text: String(ctx.slideNumber).padStart(2, "0") }], { maxPt: 24, minPt: 18, color: c.accent, bold: true });
  b.text("title", { x: 0.8, y: 2.6, w, h: 1.4 }, [{ text: slide.title, bold: true }], { maxPt: 40, minPt: 26, bold: true, valign: "middle" });
  if (slide.subtitle) b.text("subtitle", { x: 0.8, y: 4.1, w, h: 1.0 }, [{ text: slide.subtitle }], { maxPt: 20, minPt: 14, color: c.textMuted });
}

function layoutBullets(b: Builder, bullets: Bullet[], keyMessage?: string) {
  const c = b.theme.colors;
  const s = b.theme.sizes;
  let y = CONTENT_Y;
  if (keyMessage) {
    const h = 0.95;
    b.shape("card", "rect", { x: M, y, w: CONTENT_W, h }, c.surfaceAlt);
    b.shape("decor", "rect", { x: M, y, w: 0.07, h }, c.accentAlt);
    b.text("subtitle", { x: M + 0.25, y, w: CONTENT_W - 0.4, h }, [{ text: keyMessage }], { maxPt: 20, minPt: 14, valign: "middle", bold: true });
    y += h + GAP;
  }
  b.text("body", { x: M + 0.1, y, w: CONTENT_W - 0.2, h: CONTENT_BOTTOM - y }, bulletParas(bullets), { maxPt: s.body + 2, minPt: s.bodyMin });
}

function layoutTwoColumn(b: Builder, slide: Extract<Slide, { layout: "two_column" }>) {
  const c = b.theme.colors;
  const s = b.theme.sizes;
  const colW = (CONTENT_W - GAP) / 2;
  const bodyW = colW - 0.5;
  const bodyNeed = Math.max(...[slide.left, slide.right].map((col) => need(bulletParas(col.bullets), bodyW, s.body)));
  const cardH = Math.min(CONTENT_H, Math.max(2.6, 0.95 + bodyNeed + 0.3));
  const y = centerY(cardH);
  [slide.left, slide.right].forEach((col, i) => {
    const x = M + i * (colW + GAP);
    b.shape("card", "roundRect", { x, y, w: colW, h: cardH }, c.surface, c.border);
    b.text("label", { x: x + 0.25, y: y + 0.2, w: colW - 0.5, h: 0.6 }, [{ text: col.heading, bold: true }], {
      maxPt: 20,
      minPt: 14,
      color: i === 0 ? c.accent : c.accentAlt,
      bold: true,
      valign: "middle",
    });
    b.text("body", { x: x + 0.25, y: y + 0.95, w: bodyW, h: cardH - 1.15 }, bulletParas(col.bullets), { maxPt: s.body, minPt: s.bodyMin });
  });
}

function layoutArchitecture(b: Builder, slide: Extract<Slide, { layout: "architecture" }>) {
  const c = b.theme.colors;
  const tiers = [...new Set(slide.nodes.map((n) => n.tier))].sort((a, z) => a - z);
  const captionH = slide.caption ? 0.55 : 0;
  const areaTop = CONTENT_Y + 0.1;
  const areaH = CONTENT_H - captionH - 0.1;
  const colW = CONTENT_W / tiers.length;
  // Labelled connectors need a wider gutter between columns to stay readable.
  const gutter = slide.edges.some((e) => e.label) ? 1.25 : 0.7;
  const nodeW = Math.max(1.6, Math.min(2.7, colW - gutter));
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();

  tiers.forEach((tier, ci) => {
    const nodes = slide.nodes.filter((n) => n.tier === tier);
    const nodeH = Math.min(1.05, (areaH - (nodes.length - 1) * 0.35) / nodes.length);
    const total = nodes.length * nodeH + (nodes.length - 1) * 0.35;
    let y = areaTop + (areaH - total) / 2;
    const x = M + ci * colW + (colW - nodeW) / 2;
    for (const node of nodes) {
      pos.set(node.id, { x, y, w: nodeW, h: nodeH });
      y += nodeH + 0.35;
    }
  });

  for (const edge of slide.edges) {
    const a = pos.get(edge.from);
    const z = pos.get(edge.to);
    if (!a || !z) continue;
    if (Math.abs(a.x - z.x) < 0.01) {
      // Same column: straight vertical connector.
      const down = z.y > a.y;
      const x = a.x + a.w / 2;
      b.line("edge", x, down ? a.y + a.h : a.y, x, down ? z.y : z.y + z.h, c.connector, 1.5, true);
      if (edge.label) {
        const my = down ? (a.y + a.h + z.y) / 2 : (z.y + z.h + a.y) / 2;
        b.text("caption", { x: x + 0.08, y: my - 0.17, w: 1.4, h: 0.34 }, [{ text: edge.label }], { maxPt: 10, minPt: 8, color: c.textMuted, valign: "middle", inset: 0.02 });
      }
      continue;
    }
    // Different columns: right-angle connector (horizontal, vertical, horizontal) so labels never sit on a diagonal.
    const right = z.x > a.x;
    const x1 = right ? a.x + a.w : a.x;
    const x2 = right ? z.x : z.x + z.w;
    const y1 = a.y + a.h / 2;
    const y2 = z.y + z.h / 2;
    const mx = (x1 + x2) / 2;
    if (Math.abs(y1 - y2) < 0.01) {
      b.line("edge", x1, y1, x2, y2, c.connector, 1.5, true);
    } else {
      b.line("edge", x1, y1, mx, y1, c.connector, 1.5, false);
      b.line("edge", mx, y1, mx, y2, c.connector, 1.5, false);
      b.line("edge", mx, y2, x2, y2, c.connector, 1.5, true);
    }
    if (edge.label) {
      const segW = Math.abs(mx - x1) * (Math.abs(y1 - y2) < 0.01 ? 2 : 1);
      const lx = right ? x1 : x1 - segW;
      b.text("caption", { x: lx + 0.03, y: y1 - 0.4, w: Math.max(segW - 0.06, 0.5), h: 0.38 }, [{ text: edge.label }], {
        maxPt: 10,
        minPt: 7,
        inset: 0.02,
        color: c.textMuted,
        align: "center",
        valign: "bottom",
      });
    }
  }

  for (const node of slide.nodes) {
    const p = pos.get(node.id)!;
    b.shape("node", "roundRect", p, c.surfaceAlt, c.accent);
    const paras: Paragraph[] = [{ text: node.label, bold: true }];
    if (node.detail && p.h >= 0.7) paras.push({ text: node.detail, scale: 0.78, color: c.textMuted });
    b.text("label", p, paras, { maxPt: 15, minPt: 10, align: "center", valign: "middle" });
  }

  if (slide.caption) {
    b.text("caption", { x: M, y: CONTENT_BOTTOM - captionH, w: CONTENT_W, h: captionH }, [{ text: slide.caption }], {
      maxPt: 13,
      minPt: 10,
      color: c.textMuted,
      align: "center",
      valign: "middle",
    });
  }
}

function layoutFlow(b: Builder, slide: Extract<Slide, { layout: "flow" }>) {
  const c = b.theme.colors;
  const n = slide.steps.length;
  const arrowGap = 0.45;
  const cardW = (CONTENT_W - (n - 1) * arrowGap) / n;
  const innerW = cardW - 0.3;
  const labelH = Math.max(...slide.steps.map((st) => need([{ text: st.label, bold: true }], innerW, 17)));
  const detailH = Math.max(0, ...slide.steps.map((st) => (st.detail ? need([{ text: st.detail }], innerW, 14) : 0)));
  const cardH = Math.min(CONTENT_H - 0.2, Math.max(2.4, 0.95 + labelH + (detailH ? 0.05 + detailH : 0) + 0.25));
  const cardY = centerY(cardH);
  const detailTop = cardY + 0.95 + labelH + 0.05;
  slide.steps.forEach((step, i) => {
    const x = M + i * (cardW + arrowGap);
    b.shape("card", "roundRect", { x, y: cardY, w: cardW, h: cardH }, c.surface, c.border);
    b.shape("decor", "ellipse", { x: x + 0.25, y: cardY + 0.25, w: 0.55, h: 0.55 }, c.accent);
    b.text("label", { x: x + 0.25, y: cardY + 0.25, w: 0.55, h: 0.55 }, [{ text: String(i + 1), bold: true }], {
      maxPt: 14,
      minPt: 11,
      color: c.accentText,
      align: "center",
      valign: "middle",
      bold: true,
    });
    b.text("label", { x: x + 0.15, y: cardY + 0.95, w: innerW, h: labelH }, [{ text: step.label, bold: true }], { maxPt: 17, minPt: 12, bold: true });
    if (step.detail) {
      b.text("body", { x: x + 0.15, y: detailTop, w: innerW, h: cardY + cardH - 0.15 - detailTop }, [{ text: step.detail }], { maxPt: 14, minPt: 10, color: c.textMuted });
    }
    if (i < n - 1) b.line("edge", x + cardW + 0.06, cardY + cardH / 2, x + cardW + arrowGap - 0.06, cardY + cardH / 2, c.accent, 2, true);
  });
}

function layoutStack(b: Builder, slide: Extract<Slide, { layout: "stack" }>) {
  const c = b.theme.colors;
  const n = slide.groups.length;
  const colW = (CONTENT_W - (n - 1) * GAP) / n;
  const maxItems = Math.max(...slide.groups.map((g) => g.items.length));
  const itemH = Math.min(0.92, (CONTENT_H - 0.65 - (maxItems - 1) * 0.18) / maxItems);
  const top = centerY(0.65 + maxItems * itemH + (maxItems - 1) * 0.18);
  slide.groups.forEach((group, gi) => {
    const x = M + gi * (colW + GAP);
    b.text("label", { x, y: top, w: colW, h: 0.5 }, [{ text: group.category.toUpperCase(), bold: true }], {
      maxPt: 13,
      minPt: 10,
      color: gi % 2 === 0 ? c.accent : c.accentAlt,
      bold: true,
      valign: "middle",
    });
    group.items.forEach((item, ii) => {
      const y = top + 0.65 + ii * (itemH + 0.18);
      b.shape("card", "roundRect", { x, y, w: colW, h: itemH }, c.surface, c.border);
      const paras: Paragraph[] = [{ text: item.name, bold: true }];
      if (item.note) paras.push({ text: item.note, scale: 0.8, color: c.textMuted });
      b.text("body", { x: x + 0.15, y, w: colW - 0.3, h: itemH }, paras, { maxPt: 16, minPt: 10, valign: "middle" });
    });
  });
}

function layoutTimeline(b: Builder, slide: Extract<Slide, { layout: "timeline" }>) {
  const c = b.theme.colors;
  const n = slide.items.length;
  const slotW = CONTENT_W / n;
  const detailH = Math.min(2.6, Math.max(0, ...slide.items.map((it) => (it.detail ? need([{ text: it.detail }], slotW - 0.2, 14) : 0))));
  const lineY = centerY(1.15 + 0.4 + detailH) + 1.15;
  b.line("decor", M, lineY, M + CONTENT_W, lineY, c.border, 2, false);
  slide.items.forEach((item, i) => {
    const cx = M + slotW * i + slotW / 2;
    b.shape("decor", "ellipse", { x: cx - 0.16, y: lineY - 0.16, w: 0.32, h: 0.32 }, i % 2 === 0 ? c.accent : c.accentAlt);
    b.text("label", { x: cx - slotW / 2 + 0.1, y: lineY - 1.15, w: slotW - 0.2, h: 0.85 }, [{ text: item.label, bold: true }], {
      maxPt: 17,
      minPt: 12,
      align: "center",
      valign: "bottom",
      bold: true,
    });
    if (item.detail) {
      b.text("body", { x: cx - slotW / 2 + 0.1, y: lineY + 0.4, w: slotW - 0.2, h: Math.min(detailH + 0.1, CONTENT_BOTTOM - lineY - 0.4) }, [{ text: item.detail }], {
        maxPt: 14,
        minPt: 10,
        color: c.textMuted,
        align: "center",
      });
    }
  });
}

function layoutMetrics(b: Builder, slide: Extract<Slide, { layout: "metrics" }>) {
  const c = b.theme.colors;
  const n = slide.metrics.length;
  const cardW = (CONTENT_W - (n - 1) * GAP) / n;
  const cardH = slide.bullets.length ? 2.3 : 2.8;
  const bulletW = CONTENT_W - 0.2;
  const bulletH = slide.bullets.length ? Math.min(CONTENT_H - cardH - GAP, need(bulletParas(slide.bullets), bulletW, 17)) : 0;
  const top = centerY(cardH + (bulletH ? GAP + bulletH : 0));
  slide.metrics.forEach((m, i) => {
    const x = M + i * (cardW + GAP);
    b.shape("card", "roundRect", { x, y: top, w: cardW, h: cardH }, c.surface, c.border);
    b.text("value", { x: x + 0.2, y: top + 0.2, w: cardW - 0.4, h: cardH * 0.55 }, [{ text: m.value, bold: true }], {
      maxPt: 48,
      minPt: 24,
      color: i % 2 === 0 ? c.accent : c.accentAlt,
      align: "center",
      valign: "middle",
      bold: true,
    });
    b.text("label", { x: x + 0.2, y: top + 0.2 + cardH * 0.55, w: cardW - 0.4, h: cardH * 0.45 - 0.4 }, [{ text: m.label }], {
      maxPt: 15,
      minPt: 10,
      color: c.textMuted,
      align: "center",
    });
  });
  if (slide.bullets.length) {
    const y = top + cardH + GAP;
    b.text("body", { x: M + 0.1, y, w: bulletW, h: Math.max(bulletH, CONTENT_BOTTOM - y > 0 ? Math.min(bulletH + 0.1, CONTENT_BOTTOM - y) : 0.5) }, bulletParas(slide.bullets), { maxPt: 17, minPt: 12 });
  }
}

function layoutClosing(b: Builder, slide: Extract<Slide, { layout: "closing" }>) {
  const c = b.theme.colors;
  b.shape("decor", "rect", { x: SLIDE_W / 2 - 0.6, y: 1.55, w: 1.2, h: 0.08 }, c.accent);
  b.text("title", { x: M, y: 1.75, w: CONTENT_W, h: 1.3 }, [{ text: slide.title, bold: true }], { maxPt: 40, minPt: 26, align: "center", valign: "middle", bold: true });
  if (slide.bullets.length) {
    b.text("body", { x: 2.2, y: 3.3, w: SLIDE_W - 4.4, h: 3.3 }, bulletParas(slide.bullets), { maxPt: 18, minPt: 12 });
  }
}
