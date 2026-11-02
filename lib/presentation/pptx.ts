import PptxGenJS from "pptxgenjs";
import type { NativeItem, NativePage, RenderedSlide, TextRun } from "@/lib/render/browser";
import { PAGE_W } from "./html/render";
import type { DeckSpec } from "./spec";
import { getTheme, type TemplateFonts } from "./themes";

/** Slide size in inches (16:9) and the CSS px → inch / pt factors for a 1280 px page. */
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const IN = SLIDE_W / PAGE_W;
const PT = IN * 72;

export type PptxMode = "native" | "image";

/**
 * Writes the deck as a 16:9 PowerPoint file.
 *
 * native (default): every page is rebuilt from what the browser laid out, as real PowerPoint
 * objects: text boxes with styled runs (editable, searchable, translatable), rectangles and rounded
 * boxes, lines and arrows, diagram shapes, and images. The page background (gradients, dot grids)
 * is a background image, so the slide still matches the validated render.
 *
 * image: one full-bleed picture per slide, identical everywhere but not editable.
 *
 * Speaker notes and the slide title (as alt text / slide name) are kept in both modes.
 */
export async function writePptx(spec: DeckSpec, slides: RenderedSlide[], mode: PptxMode = "native"): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "GitFill";
  pptx.company = "GitFill";
  pptx.title = spec.title;
  pptx.subject = spec.purpose;
  const theme = getTheme(spec.theme, spec.brand);
  pptx.theme = { headFontFace: theme.fonts.pptx.heading, bodyFontFace: theme.fonts.pptx.body };

  for (const rendered of slides) {
    const source = spec.slides[rendered.index];
    const slide = pptx.addSlide();
    slide.background = { color: theme.background };
    if (mode === "native" && rendered.native) {
      if (rendered.backgroundPath) slide.background = { path: rendered.backgroundPath };
      drawPage(pptx, slide, rendered.native, theme.fonts);
    } else {
      slide.addImage({ path: rendered.pngPath, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, altText: source?.title ?? `Slide ${rendered.index + 1}` });
    }
    if (source?.notes) slide.addNotes(source.notes);
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

type Slide = ReturnType<PptxGenJS["addSlide"]>;

const inch = (px: number) => Math.round(px * IN * 1000) / 1000;
const pt = (px: number) => Math.round(px * PT * 100) / 100;
const transparency = (alpha: number) => Math.round((1 - Math.max(0, Math.min(1, alpha))) * 100);

export function drawPage(pptx: PptxGenJS, slide: Slide, page: NativePage, fonts: TemplateFonts): void {
  for (const item of page.items) drawItem(pptx, slide, item, fonts);
}

function drawItem(pptx: PptxGenJS, slide: Slide, item: NativeItem, fonts: TemplateFonts): void {
  switch (item.t) {
    case "rect":
    case "ellipse":
    case "diamond": {
      if (!item.fill && !item.line) return;
      const shape = item.t === "ellipse" ? pptx.ShapeType.ellipse : item.t === "diamond" ? pptx.ShapeType.diamond : (item.radius ?? 0) > 0.5 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
      slide.addShape(shape, {
        x: inch(item.x),
        y: inch(item.y),
        w: inch(Math.max(item.w, 0.5)),
        h: inch(Math.max(item.h, 0.5)),
        fill: item.fill ? { color: item.fill, transparency: transparency(item.fillAlpha) } : { type: "none" },
        line: item.line ? { color: item.line.color, width: Math.max(0.25, pt(item.line.width)), dashType: item.line.dash ? "dash" : "solid" } : { type: "none" },
        ...(shape === pptx.ShapeType.roundRect ? { rectRadius: inch(Math.min(item.radius ?? 0, Math.min(item.w, item.h) / 2)) } : {}),
      });
      return;
    }
    case "line": {
      const { x1, y1, x2, y2 } = item;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      if (w < 0.1 && h < 0.1) return;
      slide.addShape(pptx.ShapeType.line, {
        x: inch(Math.min(x1, x2)),
        y: inch(Math.min(y1, y2)),
        w: inch(w),
        h: inch(h),
        flipH: x2 < x1,
        flipV: y2 < y1,
        line: { color: item.color, width: Math.max(0.25, pt(item.width)), dashType: item.dash ? "dash" : "solid", ...(item.arrow ? { endArrowType: "triangle" as const } : {}) },
      });
      return;
    }
    case "image": {
      const data = item.src.startsWith("data:") ? item.src.slice(5) : null;
      if (!data) return;
      slide.addImage({ data, ...imageBox(item) });
      return;
    }
    case "text":
      drawText(slide, item, fonts);
  }
}

/** The rectangle an image actually occupies: object-fit contain keeps its aspect ratio inside the box. */
export function imageBox(item: Extract<NativeItem, { t: "image" }>) {
  const box = { x: inch(item.x), y: inch(item.y), w: inch(item.w), h: inch(item.h) };
  if (!item.nw || !item.nh) return box;
  if (item.fit === "cover") return { ...box, sizing: { type: "cover" as const, w: box.w, h: box.h } };
  const scale = Math.min(item.w / item.nw, item.h / item.nh);
  const w = item.nw * scale;
  const h = item.nh * scale;
  return { x: inch(item.x + (item.w - w) / 2), y: inch(item.y + (item.h - h) / 2), w: inch(w), h: inch(h) };
}

function fontFace(run: TextRun, fonts: TemplateFonts): string {
  return run.font === "mono" ? fonts.pptx.mono : run.font === "heading" ? fonts.pptx.heading : fonts.pptx.body;
}

/**
 * A text box at the position the browser laid the text out. Office fonts are a little wider or
 * narrower than the preview's, so boxes get some slack in the direction the text grows, and a
 * single line never wraps.
 */
function drawText(slide: Slide, item: Extract<NativeItem, { t: "text" }>, fonts: TemplateFonts): void {
  const runs = toTextProps(item.runs, fonts, item.pre);
  if (!runs.length) return;
  const single = item.lines <= 1 && !item.pre;
  const slack = Math.max(6, item.w * (single ? 0.12 : 0.04));
  const x = item.align === "center" ? item.x - slack / 2 : item.align === "right" ? item.x - slack : item.x;
  slide.addText(runs, {
    x: inch(x),
    y: inch(item.y),
    w: inch(item.w + slack),
    h: inch(Math.max(item.h, item.lineHeight) + 2),
    margin: 0,
    align: item.align,
    valign: "top",
    wrap: !single,
    fit: "none",
    lineSpacing: pt(item.lineHeight),
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
  });
}

/** Styled runs as pptxgenjs text props; preformatted newlines become line breaks. */
export function toTextProps(runs: TextRun[], fonts: TemplateFonts, pre: boolean): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  for (const run of runs) {
    const options: PptxGenJS.TextPropsOptions = {
      fontSize: pt(run.size),
      color: run.color,
      bold: run.bold,
      italic: run.italic,
      fontFace: fontFace(run, fonts),
      ...(run.spacing ? { charSpacing: pt(run.spacing) } : {}),
      ...(run.outline ? { outline: { color: run.color, size: Math.max(0.25, pt(run.outline)) }, transparency: 100 } : {}),
    };
    const parts = pre ? run.text.split("\n") : [run.text];
    parts.forEach((text, i) => {
      if (i < parts.length - 1) out.push({ text, options: { ...options, breakLine: true } });
      else if (text) out.push({ text, options });
    });
  }
  return out;
}
