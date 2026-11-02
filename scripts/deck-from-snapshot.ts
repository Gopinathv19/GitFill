import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { MuseClient } from "@/lib/ai/client";
import type { RepositoryAnalysis } from "@/lib/agent/analysis-schema";
import { deckEvidence, planDeck } from "@/lib/agent/planner";
import { MemoryRecorder } from "@/lib/agent/recorder";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { getDb } from "@/lib/db";
import { decks, evidenceClaims, repositorySnapshots } from "@/lib/db/schema";
import type { Claim } from "@/lib/evidence/evidence";
import { buildValidatedDeck } from "@/lib/presentation/build";
import { deckSpecSchema } from "@/lib/presentation/spec";
import { closeBrowser } from "@/lib/render/browser";
import { withLabels } from "@/lib/presentation/labels";
import { generateRequestSchema } from "@/lib/validation/request";

/**
 * Dev utility: plans and builds a new deck from an existing deck's stored analysis and
 * claims (no repository re-analysis, nothing written to the database).
 * Usage: npx tsx scripts/deck-from-snapshot.ts <deckId> [slideCount] [outDir] [--spec=spec.json]
 *   --spec skips planning and rebuilds a saved spec.
 *   --brief=brief.txt plans for a reader brief (as agreed in chat); --audience="…" overrides the audience.
 */
async function main() {
  const [deckId, count = "10", outArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const specArg = process.argv.find((a) => a.startsWith("--spec="))?.slice(7);
  const briefArg = process.argv.find((a) => a.startsWith("--brief="))?.slice(8);
  const audience = process.argv.find((a) => a.startsWith("--audience="))?.slice(11) ?? "Engineering team";
  if (!deckId) throw new Error("usage: deck-from-snapshot <deckId> [slideCount] [outDir]");
  const out = path.resolve(outArg ?? path.join("storage/sample/from-snapshot"));
  const db = getDb();
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!deck) throw new Error("deck not found");
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  const summary = snap.summary as { stats: SourceSnapshot["stats"]; metadata: SourceSnapshot["metadata"]; analysis: RepositoryAnalysis };
  const claims: Claim[] = (await db.select().from(evidenceClaims).where(eq(evidenceClaims.snapshotId, snap.id))).map((r) => ({
    ref: r.ref,
    claim: r.claim,
    claimType: r.claimType as Claim["claimType"],
    filePath: r.filePath,
    startLine: r.startLine,
    endLine: r.endLine,
    excerpt: r.excerpt,
    status: r.status,
    note: "",
  }));
  const snapshot = { displayName: `${snap.owner}/${snap.name}`, branch: snap.branch, version: snap.commitSha, stats: summary.stats, metadata: summary.metadata } as SourceSnapshot;

  const recorder = new MemoryRecorder((e) => {
    if (e.type !== "activity" || e.status === "started") return;
    const ev = e as { name: string; status: string; durationMs?: number; output?: unknown; error?: string };
    console.log(`  ${ev.status === "failed" ? "✗" : "✓"} ${ev.name} ${ev.durationMs ? `${(ev.durationMs / 1000).toFixed(1)}s` : ""} ${ev.error ?? (ev.output ? JSON.stringify(ev.output).slice(0, 160) : "")}`);
  });
  const client = new MuseClient(recorder.modelObserver());
  const t0 = Date.now();

  let spec;
  if (specArg) {
    spec = deckSpecSchema.parse(JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(specArg, "utf8"))));
  } else {
    const brief = briefArg ? await import("node:fs/promises").then((fs) => fs.readFile(briefArg, "utf8")) : "";
    const request = generateRequestSchema.parse({ repositoryUrl: snap.repositoryUrl, audience, slideCount: Number(count), brief });
    ({ spec } = await planDeck({ client, snapshot, analysis: summary.analysis, claims, request, recorder }));
    console.log(`planned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await import("node:fs/promises").then((fs) => fs.mkdir(out, { recursive: true }));
    await writeFile(path.join(out, "spec-planned.json"), JSON.stringify(spec, null, 2));
  }
  const t1 = Date.now();
  const labeled = withLabels(spec, { repository: snapshot.displayName, branch: snapshot.branch, sha: snapshot.version });
  const built = await buildValidatedDeck({
    spec: labeled.spec,
    ...labeled.render,
    workDir: out,
    illustrations: new Map(),
    evidence: deckEvidence({ snapshot, analysis: summary.analysis, claims }),
    client,
    recorder,
  });
  await writeFile(path.join(out, "spec-final.json"), JSON.stringify(built.spec, null, 2));
  await writeFile(path.join(out, "deck.pptx"), built.pptx);
  console.log(`built in ${((Date.now() - t1) / 1000).toFixed(1)}s; total ${((Date.now() - t0) / 1000).toFixed(1)}s; tokens in ${recorder.usage.inputTokens} out ${recorder.usage.outputTokens}`);
  console.log(JSON.stringify(built.report.summary));
  for (const u of built.report.unresolved) console.log(`  unresolved [${u.severity}] ${u.slideId} ${u.code}: ${u.message}`);
  console.log(`final render: ${path.dirname(built.render.pdfPath)}`);
  await closeBrowser();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await closeBrowser();
  process.exit(1);
});
