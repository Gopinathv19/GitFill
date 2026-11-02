/**
 * Compares models on the two light jobs: compressing source files into digests (checks line
 * ranges) and reviewing a rendered slide image. Run it when a new, smaller model ships.
 *
 *   BENCH_FILES=lib/a.ts,lib/b.ts npx tsx scripts/bench-models.ts storage/work/<job>/round-0/slide-01.png
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { MuseClient } from "@/lib/ai/client";
import { numberLines } from "@/lib/ai/prompts";
import { visualReviewSchema } from "@/lib/validation/visual-review";

const digestSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    purpose: z.string().max(400),
    keyPoints: z.array(z.object({ text: z.string().max(240), startLine: z.number().int(), endLine: z.number().int() })).max(10),
  })),
});

async function main() {
  const files = (process.env.BENCH_FILES ?? "lib/agent/planner.ts,lib/presentation/pptx.ts").split(",");
  const texts = await Promise.all(files.map((f) => readFile(f, "utf8")));
  const lens = texts.map((t) => t.split("\n").length);
  const body = files.map((f, i) => `<repository_file path="${f}">\n${numberLines(texts[i]!.split("\n"))}\n</repository_file>`).join("\n\n");
  const png = await readFile(process.argv[2]!);
  const client = new MuseClient();
  const runs: Array<{ model: string; effort?: "minimal" | "low" }> = [
    { model: "muse-spark-1.1" }, { model: "muse-spark-1.2" }, { model: "muse-spark-1.3", effort: "minimal" }, { model: "muse-spark-1.3", effort: "low" },
  ];
  for (const r of runs) {
    const label = `${r.model}${r.effort ? `/${r.effort}` : ""}`;
    let t = Date.now();
    try {
      const { data, usage } = await client.structured({
        model: r.model, purpose: "bench_digest", schema: digestSchema, schemaName: "Digest", maxTokens: 6000, timeoutMs: 120_000, correctionAttempts: 1,
        ...(r.effort ? { reasoningEffort: r.effort } : {}),
        messages: [
          { role: "system", content: "You compress source files for another engineer. For each file: its purpose in 1-2 sentences, and up to 8 key points (what a reader must know: main functions, decisions, constants), each with the exact line range it comes from. Lines are shown as '  12| code'. Never invent." },
          { role: "user", content: body },
        ],
      });
      const badLines = data.files.flatMap((f) => { const n = lens[files.indexOf(f.path)] ?? 0; return f.keyPoints.filter((k) => k.startLine < 1 || k.endLine > n || k.endLine < k.startLine); }).length;
      console.log(`DIGEST ${label}: ${Date.now() - t} ms, in ${usage.inputTokens}, out ${usage.outputTokens}, files ${data.files.length}, points ${data.files.reduce((n, f) => n + f.keyPoints.length, 0)}, bad line ranges ${badLines}`);
      console.log(`  ${data.files[0]?.purpose}\n  - ${data.files[0]?.keyPoints.slice(0, 3).map((k) => `${k.text} [${k.startLine}-${k.endLine}]`).join("\n  - ")}`);
    } catch (e) {
      console.log(`DIGEST ${label}: FAILED ${(e as Error).message.slice(0, 200)}`);
    }
    t = Date.now();
    try {
      const { data, usage } = await client.structured({
        model: r.model, purpose: "bench_review", schema: visualReviewSchema, schemaName: "SlideVisualReview", maxTokens: 4000, timeoutMs: 120_000,
        ...(r.effort ? { reasoningEffort: r.effort } : {}),
        messages: [
          { role: "system", content: "You are a senior presentation designer reviewing one rendered slide. Report only real, visible problems with a concrete suggestion each." },
          { role: "user", content: [{ type: "text", text: "Review this slide." }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] },
        ],
      });
      console.log(`VISION ${label}: ${Date.now() - t} ms, in ${usage.inputTokens}, out ${usage.outputTokens}, score ${data.score}, issues ${data.issues.map((i) => `${i.severity}:${i.category}`).join(", ") || "none"}`);
    } catch (e) {
      console.log(`VISION ${label}: FAILED ${(e as Error).message.slice(0, 200)}`);
    }
  }
}
main().then(() => process.exit(0));
