import "dotenv/config";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MuseClient } from "@/lib/ai/client";
import { generateIllustration } from "@/lib/ai/images";
import { modelFor } from "@/lib/ai/models";
import { env, requireEnv } from "@/lib/config/env";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import { layoutDeck } from "@/lib/presentation/layouts";
import { getTheme } from "@/lib/presentation/themes";
import { reviewSlidesVisually } from "@/lib/validation/visual-review";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

/**
 * Live check of every Meta Model API capability GitFill depends on:
 * model list, tool calling, structured output, image input and image generation.
 * Usage: npm run muse:check   (render a sample first with `npx tsx scripts/render-sample.ts`)
 */
async function main() {
  const base = env().MODEL_API_BASE_URL;
  const key = requireEnv("MODEL_API_KEY");
  const results: Array<[string, string]> = [];
  const step = async (name: string, fn: () => Promise<string>) => {
    try {
      results.push([name, `ok — ${await fn()}`]);
    } catch (err) {
      results.push([name, `FAILED — ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  await step("GET /models", async () => {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = body.data?.map((m) => m.id) ?? [];
    const needed = [modelFor("planner"), modelFor("analyst"), modelFor("illustrator")];
    const missing = needed.filter((m) => !ids.includes(m));
    if (missing.length) throw new Error(`missing models: ${missing.join(", ")} (have: ${ids.join(", ")})`);
    return ids.join(", ");
  });

  const client = new MuseClient();
  await step(`tool calling (${modelFor("analyst")})`, async () => {
    const out = await runToolLoop<{ total: number }>({
      client,
      model: modelFor("analyst"),
      purpose: "check",
      system: "Use the tools. Call add, then call finish with the sum.",
      messages: [{ role: "user", content: "What is 19 + 23? Use the add tool, then finish." }],
      tools: [
        defineTool({ name: "add", description: "Add two numbers", input: z.object({ a: z.number(), b: z.number() }), run: async ({ a, b }) => ({ sum: a + b }) }),
        defineTool({ name: "finish", description: "Submit the answer", input: z.object({ total: z.number() }), terminal: true, run: async () => ({ ok: true }) }),
      ],
      recorder: new MemoryRecorder(),
      maxTurns: 4,
    });
    return `total=${out.result.total}, turns=${out.turns}`;
  });

  await step(`structured output (${modelFor("planner")})`, async () => {
    const { data } = await client.structured({
      model: modelFor("planner"),
      purpose: "check",
      schema: z.object({ title: z.string(), bullets: z.array(z.string()).min(2).max(3) }),
      schemaName: "Check",
      messages: [{ role: "user", content: "Give a slide title and 2-3 bullets about Postgres row locking." }],
    });
    return `"${data.title}" with ${data.bullets.length} bullets`;
  });

  await step(`image input / visual review (${modelFor("reviewer")})`, async () => {
    const dir = path.resolve("storage/sample/midnight");
    const pngs = (await readdir(dir)).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
    if (!pngs.length) throw new Error("no rendered sample; run `npx tsx scripts/render-sample.ts` first");
    const laid = layoutDeck(sampleDeck, getTheme("midnight"), "check").slice(3, 5);
    const rendered = [3, 4].map((i, j) => ({ index: j, pngPath: path.join(dir, pngs[i]!), words: [] }));
    const r = await reviewSlidesVisually({ client, slides: laid, rendered, recorder: new MemoryRecorder() });
    if (!Object.keys(r.scores).length) throw new Error("no scores returned");
    return `scores ${JSON.stringify(r.scores)}, ${r.issues.length} issue(s)`;
  });

  await step(`image generation (${modelFor("illustrator")})`, async () => {
    const png = await generateIllustration("Software architecture overview");
    return `${png.byteLength} bytes PNG`;
  });

  for (const [name, status] of results) console.log(`${status.startsWith("ok") ? "✓" : "✗"} ${name}: ${status}`);
  if (results.some(([, s]) => s.startsWith("FAILED"))) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
