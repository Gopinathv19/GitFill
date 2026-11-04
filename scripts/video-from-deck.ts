import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { RepositoryAnalysis } from "@/lib/agent/analysis-schema";
import { deckEvidence } from "@/lib/agent/planner";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { MuseClient } from "@/lib/ai/client";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { getDb } from "@/lib/db";
import { deckVersions, decks, evidenceClaims, projects, repositorySnapshots, workspaces } from "@/lib/db/schema";
import type { Claim } from "@/lib/evidence/evidence";
import { parseDeckSpec } from "@/lib/presentation/legacy";
import { closeBrowser } from "@/lib/render/browser";
import { githubClientFor } from "@/lib/auth/github-token";
import { openRepositorySource } from "@/lib/understanding/ask";
import { videoBrief, videoContext } from "@/lib/video/context";
import { produceVideo } from "@/lib/video/produce";

/**
 * Dev utility: makes a video and thumbnail from an existing deck's latest version (nothing written
 * to the database). The repository is opened at the deck's commit with the deck owner's GitHub access.
 * Usage: npx tsx scripts/video-from-deck.ts <deckId> <outDir> [seconds] [--brief=brief.txt] [--ask="what the video should be"]
 */
async function main() {
  const [deckId, outArg, seconds = "60"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!deckId || !outArg) throw new Error("usage: video-from-deck <deckId> <outDir> [seconds]");
  const briefArg = process.argv.find((a) => a.startsWith("--brief="))?.slice(8);
  const ask = process.argv.find((a) => a.startsWith("--ask="))?.slice(6) ?? "";
  const out = path.resolve(outArg);
  await mkdir(out, { recursive: true });

  const db = getDb();
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0]!;
  const v = (await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id)).orderBy(desc(deckVersions.version)).limit(1))[0]!;
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  const summary = snap.summary as { stats: SourceSnapshot["stats"]; metadata: SourceSnapshot["metadata"]; analysis: RepositoryAnalysis };
  const claims: Claim[] = (await db.select().from(evidenceClaims).where(eq(evidenceClaims.snapshotId, snap.id))).map((r) => ({ ...r, claimType: r.claimType as Claim["claimType"], note: "" }));
  const spec = parseDeckSpec(v.spec);
  const snapshot = { displayName: `${snap.owner}/${snap.name}`, branch: snap.branch, version: snap.commitSha, stats: summary.stats, metadata: summary.metadata } as SourceSnapshot;
  const brief = briefArg ? await import("node:fs/promises").then((fs) => fs.readFile(briefArg, "utf8")) : "";
  const owner = (await db.select({ id: workspaces.ownerId }).from(projects).innerJoin(workspaces, eq(projects.workspaceId, workspaces.id)).where(eq(projects.id, deck.projectId)))[0]!;

  const recorder = new MemoryRecorder((e) => {
    if (e.type !== "activity" || e.status === "started") return;
    const ev = e as { name: string; status: string; durationMs?: number; output?: unknown; error?: string };
    console.log(`  ${ev.status === "failed" ? "✗" : "✓"} ${ev.name} ${ev.durationMs ? `${(ev.durationMs / 1000).toFixed(1)}s` : ""} ${ev.error ?? (ev.output ? JSON.stringify(ev.output).slice(0, 200) : "")}`);
  });
  const source = await openRepositorySource({ url: snap.repositoryUrl, branch: snap.commitSha, client: await githubClientFor(db, owner.id), recorder }).catch((err) => {
    console.log("repository tools unavailable:", (err as Error).message);
    return null;
  });
  const t0 = Date.now();
  const result = await produceVideo({
    client: new MuseClient(recorder.modelObserver()),
    recorder,
    brief: videoBrief({ spec, brief, instructions: ask }),
    context: videoContext(spec, deckEvidence({ snapshot, analysis: summary.analysis, claims })),
    targetSeconds: Number(seconds),
    source,
    workDir: out,
    onStage: async (s) => console.log(`== ${s} (${((Date.now() - t0) / 1000).toFixed(0)}s)`),
  });
  await writeFile(path.join(out, "final.mp4"), result.mp4);
  await writeFile(path.join(out, "final-thumbnail.png"), result.thumbnail);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s; tokens in ${recorder.usage.inputTokens} out ${recorder.usage.outputTokens}`);
  console.log("%s\n%s\n", result.draft.title, result.draft.summary, result.probe);
  await closeBrowser();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await closeBrowser();
  process.exit(1);
});
