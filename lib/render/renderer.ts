import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/config/env";

const run = promisify(execFile);

export interface WordBox {
  text: string;
  /** Inches from the slide's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderedSlide {
  index: number;
  pngPath: string;
  words: WordBox[];
}

export interface RenderResult {
  pdfPath: string;
  slides: RenderedSlide[];
  pageWidthIn: number;
  pageHeightIn: number;
}

export class RenderError extends Error {
  override name = "RenderError";
}

/**
 * Renders a .pptx exactly as a viewer would see it: LibreOffice → PDF → PNG per slide,
 * plus word bounding boxes from the PDF for measurable layout checks.
 * Binaries are invoked with fixed argument arrays (no shell, no model-provided input).
 */
export async function renderPptx(pptxPath: string, outDir: string, opts: { dpi?: number; timeoutMs?: number } = {}): Promise<RenderResult> {
  await mkdir(outDir, { recursive: true });
  const timeout = opts.timeoutMs ?? 120_000;
  // A private profile per render lets several conversions run concurrently.
  const profile = await mkdtemp(path.join(tmpdir(), "gitfill-lo-"));
  try {
    await run(
      env().SOFFICE_PATH,
      [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", outDir, pptxPath],
      { timeout, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err) {
    throw new RenderError(`LibreOffice conversion failed: ${(err as Error).message.slice(0, 300)}`);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }

  const pdfPath = path.join(outDir, `${path.basename(pptxPath, path.extname(pptxPath))}.pdf`);
  try {
    await readFile(pdfPath);
  } catch {
    throw new RenderError("LibreOffice did not produce a PDF.");
  }

  const prefix = path.join(outDir, "slide");
  await run("pdftoppm", ["-png", "-r", String(opts.dpi ?? 110), pdfPath, prefix], { timeout });
  const pngs = (await readdir(outDir)).filter((f) => /^slide-\d+\.png$/.test(f)).sort((a, b) => pageNum(a) - pageNum(b));

  const bboxPath = path.join(outDir, "words.html");
  await run("pdftotext", ["-bbox", pdfPath, bboxPath], { timeout });
  const { pages, widthPt, heightPt } = parseBbox(await readFile(bboxPath, "utf8"));
  await writeFile(path.join(outDir, "words.json"), JSON.stringify(pages));

  if (pngs.length !== pages.length) throw new RenderError(`Rendered ${pngs.length} images but PDF has ${pages.length} pages.`);
  return {
    pdfPath,
    pageWidthIn: widthPt / 72,
    pageHeightIn: heightPt / 72,
    slides: pngs.map((f, i) => ({ index: i, pngPath: path.join(outDir, f), words: pages[i] ?? [] })),
  };
}

function pageNum(file: string): number {
  return Number(/(\d+)\.png$/.exec(file)?.[1] ?? 0);
}

/** Parses `pdftotext -bbox` XHTML output into per-page word boxes in inches. */
export function parseBbox(html: string): { pages: WordBox[][]; widthPt: number; heightPt: number } {
  const pages: WordBox[][] = [];
  let widthPt = 0;
  let heightPt = 0;
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([\s\S]*?)<\/word>/g;
  for (const page of html.matchAll(pageRe)) {
    widthPt = Number(page[1]);
    heightPt = Number(page[2]);
    const words: WordBox[] = [];
    for (const w of page[3]!.matchAll(wordRe)) {
      const [x0, y0, x1, y1] = [Number(w[1]), Number(w[2]), Number(w[3]), Number(w[4])];
      words.push({ text: decodeEntities(w[5]!), x: x0 / 72, y: y0 / 72, w: (x1 - x0) / 72, h: (y1 - y0) / 72 });
    }
    pages.push(words);
  }
  return { pages, widthPt, heightPt };
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
