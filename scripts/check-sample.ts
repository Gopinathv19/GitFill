import path from "node:path";
import { readFile } from "node:fs/promises";
import { layoutDeck } from "@/lib/presentation/layouts";
import { getTheme } from "@/lib/presentation/themes";
import { checkLayout, checkRender } from "@/lib/validation/checks";
import type { WordBox } from "@/lib/render/renderer";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

/** Dev utility: runs deterministic checks against the last sample render. */
async function main() {
  const slides = layoutDeck(sampleDeck, getTheme("midnight"), "GitFill · honojs/hono @ bac5c4a");
  const pages = JSON.parse(await readFile(path.resolve("storage/sample/midnight/words.json"), "utf8")) as WordBox[][];
  const issues = [...checkLayout(slides), ...checkRender(slides, pages.map((words, index) => ({ index, pngPath: "", words })))];
  for (const i of issues) console.log(`[${i.source}] ${i.slideId} ${i.code}: ${i.message}`);
  console.log(`${issues.length} issue(s)`);
}
main();
