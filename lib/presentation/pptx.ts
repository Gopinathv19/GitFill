import PptxGenJS from "pptxgenjs";
import type { RenderedSlide } from "@/lib/render/browser";
import type { DeckSpec } from "./spec";
import { getTheme } from "./themes";

/**
 * Packs the rendered pages into a 16:9 PowerPoint file: one full-bleed image per slide,
 * with the speaker notes and the slide title as alt text. The images are the same renders
 * that were validated, so the deck looks identical in PowerPoint, Keynote and Google Slides.
 */
export async function writePptx(spec: DeckSpec, slides: RenderedSlide[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "GitFill";
  pptx.company = "GitFill";
  pptx.title = spec.title;
  pptx.subject = spec.purpose;
  const background = getTheme(spec.theme).background;

  for (const rendered of slides) {
    const source = spec.slides[rendered.index];
    const slide = pptx.addSlide();
    slide.background = { color: background };
    slide.addImage({ path: rendered.pngPath, x: 0, y: 0, w: 13.333, h: 7.5, altText: source?.title ?? `Slide ${rendered.index + 1}` });
    if (source?.notes) slide.addNotes(source.notes);
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
