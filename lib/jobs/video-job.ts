import { desc, eq } from "drizzle-orm";
import type { MuseClient } from "@/lib/ai/client";
import { deckEvidence } from "@/lib/agent/planner";
import { githubClientForJob } from "@/lib/auth/github-token";
import type { Database } from "@/lib/db";
import { artifacts, deckVersions, decks, evidenceClaims, generationJobs, repositorySnapshots } from "@/lib/db/schema";
import type { Claim } from "@/lib/evidence/evidence";
import { parseDeckSpec } from "@/lib/presentation/legacy";
import { getStorage, safeFilename } from "@/lib/storage";
import { openRepositorySource } from "@/lib/understanding/ask";
import { videoRequestSchema } from "@/lib/validation/request";
import { videoBrief, videoContext } from "@/lib/video/context";
import { produceVideo } from "@/lib/video/produce";
import type { DbRecorder } from "./db-recorder";
import type { SnapshotSummary } from "./pipeline";

type Job = typeof generationJobs.$inferSelect;

/**
 * Makes an explainer video and thumbnail from a deck's latest version: its story, evidence and the
 * repository (read-only tools) go to the director; the results are stored on that version.
 */
export async function runVideoJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = videoRequestSchema.parse(job.options);
  if (!job.deckId) throw new Error("Video job has no presentation.");
  const deck = (await db.select().from(decks).where(eq(decks.id, job.deckId)))[0];
  if (!deck) throw new Error("Presentation not found.");
  const version = (await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id)).orderBy(desc(deckVersions.version)).limit(1))[0];
  if (!version) throw new Error("Presentation has no versions.");
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  await db.update(generationJobs).set({ branch: snap.branch, commitSha: snap.commitSha, snapshotId: snap.id }).where(eq(generationJobs.id, job.id));

  const claims: Claim[] = (await db.select().from(evidenceClaims).where(eq(evidenceClaims.snapshotId, snap.id))).map((r) => ({ ...r, claimType: r.claimType as Claim["claimType"], note: "" }));
  const summary = snap.summary as SnapshotSummary;
  const spec = parseDeckSpec(version.spec);
  const evidence = summary?.analysis
    ? deckEvidence({ snapshot: { displayName: `${snap.owner}/${snap.name}`, branch: snap.branch, version: snap.commitSha, stats: summary.stats, metadata: summary.metadata }, analysis: summary.analysis, claims })
    : "";

  // The repository at the deck's commit, for brand colours, copy and snippets. The deck alone is enough without it.
  const source = await openRepositorySource({ url: snap.repositoryUrl, branch: snap.commitSha, client: await githubClientForJob(db, job), recorder }).catch(() => null);

  const workDir = getStorage().localPath(`work/${job.id}`);
  const result = await produceVideo({
    client,
    recorder,
    brief: videoBrief({ spec, brief: request.brief, instructions: request.instructions }),
    context: videoContext(spec, evidence),
    targetSeconds: request.seconds,
    source,
    workDir,
    onStage: (stage) => recorder.setStage(stage === "composing" ? "composing_video" : "rendering_video"),
  });

  const storage = getStorage();
  const prefix = `decks/${deck.id}/videos/${job.id}`;
  const base = `${snap.name}-video-v${version.version}`;
  const files = [
    { type: "video" as const, name: "video.mp4", data: result.mp4, mime: "video/mp4", filename: safeFilename(base, "mp4") },
    { type: "thumbnail" as const, name: "thumbnail.png", data: result.thumbnail, mime: "image/png", filename: safeFilename(`${base}-thumbnail`, "png") },
    { type: "video_source" as const, name: "video.html", data: Buffer.from(result.draft.video), mime: "text/html; charset=utf-8", filename: safeFilename(`${base}-source`, "html") },
  ];
  const rows: (typeof artifacts.$inferInsert)[] = [];
  for (const f of files) {
    const key = `${prefix}/${f.name}`;
    const { sizeBytes } = await storage.put(key, f.data);
    rows.push({ jobId: job.id, deckVersionId: version.id, artifactType: f.type, storageKey: key, filename: f.filename, mimeType: f.mime, sizeBytes });
  }
  await db.insert(artifacts).values(rows);
  await (await recorder.start("step", "video_ready", {})).succeed({ title: result.draft.title, summary: result.draft.summary, seconds: Math.round(result.probe.duration) });
  await db.update(generationJobs).set({ status: "completed", completedAt: new Date() }).where(eq(generationJobs.id, job.id));
}
