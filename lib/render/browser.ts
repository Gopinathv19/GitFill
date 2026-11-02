import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { env } from "@/lib/config/env";
import { PAGE_H, PAGE_W } from "@/lib/presentation/html/render";

/** What the browser measured on one page. All lengths in CSS px. */
export interface PageMeasure {
  /** Elements that extend past the page body, at most one per block. */
  overflow: Array<{ block: string | null; type: string | null; over: number; text: string }>;
  /** Share of the body height used by the tallest column, 0..1. */
  fill: number;
  /** Rendered size of the smallest diagram label text, if the page has a diagram. */
  diagramFontPx: number | null;
  /** Diagram text that spills out of its box. */
  clipped: Array<{ block: string | null; text: string }>;
  hasDiagram: boolean;
}

export interface RenderedSlide {
  index: number;
  slideId: string;
  pngPath: string;
  measure: PageMeasure;
}

export interface RenderResult {
  pdfPath: string;
  slides: RenderedSlide[];
}

export class RenderError extends Error {
  override name = "RenderError";
}

let shared: Promise<Browser> | null = null;

/** One Chromium per process, launched on first use and relaunched if it dies. */
async function browser(): Promise<Browser> {
  if (shared) {
    const b = await shared.catch(() => null);
    if (b?.isConnected()) return b;
  }
  shared = chromium.launch({ executablePath: env().CHROMIUM_PATH || undefined, args: ["--font-render-hinting=none"] });
  return shared.catch((err) => {
    shared = null;
    throw new RenderError(`Could not start Chromium: ${(err as Error).message.slice(0, 300)}. Install it with \`npx playwright-core install chromium\` or set CHROMIUM_PATH.`);
  });
}

/**
 * Renders a deck document exactly as it will be delivered: one PNG per page, a PDF, and
 * DOM measurements for validation. The HTML is self-contained, so nothing is fetched.
 */
export async function renderDeckHtml(html: string, outDir: string, opts: { scale?: number; pdf?: boolean } = {}): Promise<RenderResult> {
  await mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, "deck.html");
  await writeFile(htmlPath, html);

  const b = await browser();
  const context = await b.newContext({ viewport: { width: PAGE_W + 80, height: PAGE_H + 80 }, deviceScaleFactor: opts.scale ?? 1.5, javaScriptEnabled: true });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") || route.request().url().startsWith("file:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);

    const measures = await page.evaluate(measureScript);
    const sheets = await page.$$(".page");
    if (sheets.length !== measures.length) throw new RenderError(`Rendered ${sheets.length} pages but measured ${measures.length}.`);

    const slides: RenderedSlide[] = [];
    for (const [i, el] of sheets.entries()) {
      const pngPath = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await el.screenshot({ path: pngPath, animations: "disabled" });
      slides.push({ index: i, slideId: measures[i]!.slideId, pngPath, measure: measures[i]!.measure });
    }

    const pdfPath = path.join(outDir, "deck.pdf");
    if (opts.pdf !== false) {
      await page.emulateMedia({ media: "print" });
      await page.pdf({ path: pdfPath, width: `${PAGE_W}px`, height: `${PAGE_H}px`, printBackground: true, preferCSSPageSize: true });
    }
    return { pdfPath, slides };
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError(`Slide rendering failed: ${(err as Error).message.slice(0, 300)}`);
  } finally {
    await context.close();
  }
}

/** Closes the shared browser (scripts and tests). */
export async function closeBrowser(): Promise<void> {
  const b = await shared?.catch(() => null);
  shared = null;
  await b?.close();
}

/** Runs in the page. Kept free of closures over Node values. */
function measureScript() {
  const out: Array<{ slideId: string; measure: PageMeasure }> = [];
  for (const sheet of Array.from(document.querySelectorAll<HTMLElement>(".page"))) {
    const body = sheet.querySelector<HTMLElement>("[data-body]") ?? sheet;
    const isCover = sheet.classList.contains("cover");
    // The cover has no body box of its own: its content must stay inside the sheet's padding.
    const limit = isCover ? sheet.getBoundingClientRect() : body.getBoundingClientRect();
    const overflow: PageMeasure["overflow"] = [];
    const seen = new Set<string>();
    for (const el of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const over = Math.max(r.bottom - limit.bottom, r.right - limit.right);
      if (over <= 1.5) continue;
      const blk = el.closest<HTMLElement>("[data-block]");
      const key = blk?.dataset.block ?? "page";
      if (seen.has(key)) continue;
      seen.add(key);
      overflow.push({ block: blk?.dataset.block ?? null, type: blk?.dataset.type ?? null, over: Math.round(over), text: (el.textContent ?? "").trim().slice(0, 60) });
    }

    const bodyRect = body.getBoundingClientRect();
    let used = 0;
    const cols = Array.from(body.querySelectorAll<HTMLElement>(":scope > .col, :scope > .toc"));
    for (const c of cols.length ? cols : [body]) {
      for (const child of Array.from(c.children) as HTMLElement[]) {
        const r = child.getBoundingClientRect();
        if (r.height) used = Math.max(used, r.bottom - bodyRect.top);
      }
    }
    const fill = bodyRect.height ? Math.min(1, used / bodyRect.height) : 1;

    let diagramFontPx: number | null = null;
    const clipped: PageMeasure["clipped"] = [];
    const svgs = Array.from(body.querySelectorAll<SVGSVGElement>(".canvas svg"));
    for (const s of svgs) {
      const vb = s.viewBox.baseVal;
      const r = s.getBoundingClientRect();
      if (!vb?.width || !r.width) continue;
      const scale = Math.min(r.width / vb.width, r.height / vb.height);
      const px = 10.5 * scale;
      diagramFontPx = diagramFontPx === null ? px : Math.min(diagramFontPx, px);
      const blk = s.closest<HTMLElement>("[data-block]")?.dataset.block ?? null;
      for (const g of Array.from(s.querySelectorAll<SVGGElement>("g.n"))) {
        const shape = g.querySelector<SVGGraphicsElement>("rect, polygon");
        if (!shape) continue;
        const sb = shape.getBBox();
        const diamond = g.classList.contains("dia");
        for (const t of Array.from(g.querySelectorAll<SVGTextElement>("text"))) {
          const tb = t.getBBox();
          const bad = diamond ? tb.width > sb.width * 0.74 : tb.x < sb.x - 1 || tb.x + tb.width > sb.x + sb.width + 1 || tb.y < sb.y - 1 || tb.y + tb.height > sb.y + sb.height + 1;
          if (bad) clipped.push({ block: blk, text: (t.textContent ?? "").slice(0, 60) });
        }
      }
    }
    out.push({ slideId: sheet.dataset.slide ?? "", measure: { overflow, fill, diagramFontPx, clipped, hasDiagram: svgs.length > 0 } });
  }
  return out;
}
