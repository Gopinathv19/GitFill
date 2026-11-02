import path from "node:path";
import { renderDeckHtml as toHtml } from "@/lib/presentation/html/render";
import { closeBrowser, renderDeckHtml } from "@/lib/render/browser";
import { checkRender } from "@/lib/validation/checks";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

/**
 * Dev utility: renders the fixture deck and prints the validation checks.
 * Usage: npx tsx scripts/render-sample.ts [midnight|daylight] [outDir]
 */
async function main() {
  const theme = (process.argv[2] as "midnight" | "daylight") ?? "midnight";
  const out = path.resolve(process.argv[3] ?? path.join("storage/sample", theme));
  const spec = { ...sampleDeck, theme };
  const t = Date.now();
  const html = toHtml(spec, { repoLabel: "Gopinathv19/memora · main", evidence: "Gopinathv19/memora @ b6357f6" });
  const r = await renderDeckHtml(html, out);
  console.log(`rendered ${r.slides.length} slides in ${Date.now() - t}ms → ${out}`);
  for (const s of r.slides) {
    const m = s.measure;
    console.log(`${s.slideId}: fill ${Math.round(m.fill * 100)}%${m.diagramFontPx ? `, diagram text ${m.diagramFontPx.toFixed(1)}px` : ""}${m.overflow.length ? `, overflow ${JSON.stringify(m.overflow)}` : ""}${m.clipped.length ? `, clipped ${JSON.stringify(m.clipped)}` : ""}`);
  }
  for (const i of checkRender(spec, r.slides)) console.log(`  [${i.severity}] ${i.slideId} ${i.code}: ${i.message}`);
  await closeBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
