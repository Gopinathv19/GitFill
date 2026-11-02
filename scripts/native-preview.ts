import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorage } from "@/lib/storage";
import { renderDeckHtml } from "@/lib/presentation/html/render";
import { writePptx } from "@/lib/presentation/pptx";
import { deckSpecSchema, type DeckSpec } from "@/lib/presentation/spec";
import { TEMPLATE_IDS, getTheme, type TemplateFonts } from "@/lib/presentation/themes";
import { browser, closeBrowser, renderDeckHtml as renderPages, type NativePage } from "@/lib/render/browser";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

/**
 * Renders a deck as an editable .pptx and, next to it, a picture of what PowerPoint will draw:
 * the same native items, placed and sized exactly as in the .pptx, set in the .pptx fonts
 * (Liberation Sans is metric-compatible with Arial). Use it to check the native export.
 *
 *   npx tsx scripts/native-preview.ts [outDir] [template ...]
 */
async function main() {
  const outDir = path.resolve(process.argv[2] ?? getStorage().localPath("work/native-preview"));
  const templates = process.argv.slice(3).length ? process.argv.slice(3) : [...TEMPLATE_IDS];
  await mkdir(outDir, { recursive: true });
  for (const t of templates) {
    const spec: DeckSpec = deckSpecSchema.parse({ ...sampleDeck, theme: t });
    const html = renderDeckHtml(spec, { repoLabel: "acme/memora · main", evidence: "evidence: acme/memora @ b6357f6", coverMeta: [["Repository", "acme/memora"], ["Commit", "main · b6357f6"]] });
    const dir = path.join(outDir, t);
    const render = await renderPages(html, dir, { native: true, pdf: false });
    await writeFile(path.join(dir, "deck.pptx"), await writePptx(spec, render.slides, "native"));
    const fonts = getTheme(t).fonts;
    for (const s of render.slides) {
      const bg = s.backgroundPath ? `data:image/png;base64,${(await readFile(s.backgroundPath)).toString("base64")}` : "";
      await screenshot(previewHtml(s.native!, fonts, bg), path.join(dir, `pptx-${String(s.index + 1).padStart(2, "0")}.png`));
    }
    console.log(`${t}: ${render.slides.length} slides, ${render.slides.reduce((n, s) => n + (s.native?.items.length ?? 0), 0)} native items → ${dir}`);
  }
  await closeBrowser();
}

const IN = 13.333 / 1280;
const PX_PER_PT = 1 / (IN * 72);

/** What PowerPoint draws for one page, as HTML in CSS px. Mirrors lib/presentation/pptx.ts. */
function previewHtml(page: NativePage, fonts: TemplateFonts, bg: string): string {
  const face = (f: string) => (f === "mono" ? fonts.pptx.mono : f === "heading" ? fonts.pptx.heading : fonts.pptx.body);
  const css = (f: string) => `'${f}', ${f === "Arial" ? "'Liberation Sans'" : f === "Georgia" ? "'Liberation Serif'" : "'Liberation Mono'"}`;
  const parts: string[] = [];
  for (const it of page.items) {
    if (it.t === "rect" || it.t === "ellipse" || it.t === "diamond") {
      const border = it.line ? `${it.line.width}px ${it.line.dash ? "dashed" : "solid"} #${it.line.color}` : "none";
      const radius = it.t === "ellipse" ? "50%" : `${it.radius ?? 0}px`;
      const clip = it.t === "diamond" ? "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);" : "";
      parts.push(`<div style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;box-sizing:border-box;background:${it.fill ? `#${it.fill}` : "none"};opacity:${it.fill ? Math.max(it.fillAlpha, 0.001) : 1};border:${border};border-radius:${radius};${clip}"></div>`);
    } else if (it.t === "line") {
      parts.push(`<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1"><line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="#${it.color}" stroke-width="${it.width}" ${it.dash ? 'stroke-dasharray="4 3"' : ""}/></svg>`);
    } else if (it.t === "image") {
      parts.push(`<img src="${it.src}" style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;object-fit:${it.fit}"/>`);
    } else if (it.t === "text") {
      const single = it.lines <= 1 && !it.pre;
      const slack = Math.max(6, it.w * (single ? 0.12 : 0.04));
      const x = it.align === "center" ? it.x - slack / 2 : it.align === "right" ? it.x - slack : it.x;
      const runs = it.runs
        .map((r) => `<span style="font-family:${css(face(r.font))};font-size:${Math.round(r.size * IN * 72 * 100) / 100 * PX_PER_PT}px;color:${r.outline ? "transparent" : `#${r.color}`};${r.outline ? `-webkit-text-stroke:${r.outline}px #${r.color};` : ""}font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? "italic" : "normal"};letter-spacing:${r.spacing}px">${r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`)
        .join("");
      parts.push(`<div style="position:absolute;left:${x}px;top:${it.y}px;width:${it.w + slack}px;font-size:${it.runs[0]?.size ?? 12}px;font-family:${css(face(it.runs[0]?.font ?? "sans"))};line-height:${it.lineHeight}px;text-align:${it.align};white-space:${it.pre ? "pre" : single ? "nowrap" : "normal"}">${runs}</div>`);
    }
  }
  return `<!doctype html><html><body style="margin:0"><div style="position:relative;width:${page.width}px;height:${page.height}px;overflow:hidden;background:url(${bg}) 0 0/100% 100%">${parts.join("")}</div></body></html>`;
}

async function screenshot(html: string, out: string) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out });
  await ctx.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
