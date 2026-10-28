import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { layoutDeck } from "@/lib/presentation/layouts";
import { writePptx } from "@/lib/presentation/generator";
import { getTheme } from "@/lib/presentation/themes";
import { renderPptx } from "@/lib/render/renderer";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

/** Dev utility: renders the fixture deck to storage/sample for visual inspection. */
async function main() {
  const theme = (process.argv[2] as "midnight" | "daylight") ?? "midnight";
  const out = path.resolve("storage/sample", theme);
  await mkdir(out, { recursive: true });
  const slides = layoutDeck({ ...sampleDeck, theme }, getTheme(theme), "GitFill · honojs/hono @ bac5c4a");
  const pptxPath = path.join(out, "sample.pptx");
  await writeFile(pptxPath, await writePptx(slides, { title: sampleDeck.title, subject: "sample" }));
  const t = Date.now();
  const r = await renderPptx(pptxPath, out);
  console.log(`rendered ${r.slides.length} slides in ${Date.now() - t}ms, page ${r.pageWidthIn.toFixed(2)}x${r.pageHeightIn.toFixed(2)}in`);
  for (const s of r.slides) console.log(s.pngPath, s.words.length, "words");
}
main().catch((e) => { console.error(e); process.exit(1); });
