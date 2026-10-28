import PptxGenJS from "pptxgenjs";
import type { LaidOutSlide, LineElement, TextElement } from "./layouts";
import { PARA_SPACING_PT, TEXT_INSET_IN } from "./text-metrics";

export interface PptxMeta {
  title: string;
  subject: string;
}

/**
 * Writes laid-out slides as native, editable PowerPoint objects. Every object is named
 * with its layout element id so rendered defects can be traced back to the element.
 */
export async function writePptx(slides: LaidOutSlide[], meta: PptxMeta): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "GitFill";
  pptx.company = "GitFill";
  pptx.title = meta.title;
  pptx.subject = meta.subject;

  for (const laid of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: laid.background };
    for (const el of laid.elements) {
      switch (el.kind) {
        case "text":
          addText(slide, el);
          break;
        case "shape":
          slide.addShape(el.shape === "ellipse" ? pptx.ShapeType.ellipse : el.shape === "roundRect" ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            fill: { color: el.fill },
            line: el.line ? { color: el.line, width: 1 } : { type: "none" },
            ...(el.shape === "roundRect" ? { rectRadius: 0.12 } : {}),
            objectName: el.id,
          });
          break;
        case "line":
          addLine(pptx, slide, el);
          break;
        case "image":
          slide.addImage({ path: el.path, x: el.x, y: el.y, w: el.w, h: el.h, sizing: { type: "cover", w: el.w, h: el.h }, objectName: el.id });
          break;
      }
    }
    if (laid.notes) slide.addNotes(laid.notes);
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}

function addText(slide: PptxGenJS.Slide, el: TextElement) {
  const runs: PptxGenJS.TextProps[] = el.paragraphs.map((p, i) => ({
    text: p.text,
    options: {
      bold: p.bold ?? el.bold,
      color: p.color ?? el.color,
      fontSize: Math.round(el.fontPt * (p.scale ?? 1)),
      bullet: p.bullet ? { indent: 18 } : false,
      breakLine: i < el.paragraphs.length - 1,
      paraSpaceAfter: i < el.paragraphs.length - 1 ? PARA_SPACING_PT(el.fontPt) : 0,
    },
  }));
  const inset = (el.inset ?? TEXT_INSET_IN) * 72;
  slide.addText(runs, {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    fontFace: el.fontFace,
    fontSize: el.fontPt,
    color: el.color,
    align: el.align,
    valign: el.valign,
    margin: [inset, inset, inset, inset],
    fit: "none",
    wrap: true,
    objectName: el.id,
  });
}

function addLine(pptx: PptxGenJS, slide: PptxGenJS.Slide, el: LineElement) {
  slide.addShape(pptx.ShapeType.line, {
    x: Math.min(el.x1, el.x2),
    y: Math.min(el.y1, el.y2),
    w: Math.max(Math.abs(el.x2 - el.x1), 0.001),
    h: Math.max(Math.abs(el.y2 - el.y1), 0.001),
    flipH: el.x2 < el.x1,
    flipV: el.y2 < el.y1,
    line: { color: el.color, width: el.widthPt, ...(el.arrow ? { endArrowType: "triangle" as const } : {}) },
    objectName: el.id,
  });
}
