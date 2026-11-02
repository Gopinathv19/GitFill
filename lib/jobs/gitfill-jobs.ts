import { eq } from "drizzle-orm";
import type { MuseClient } from "@/lib/ai/client";
import { analyzeRepository } from "@/lib/agent/analyze";
import { githubClientForJob } from "@/lib/auth/github-token";
import type { Database } from "@/lib/db";
import { generationJobs } from "@/lib/db/schema";
import { generateReadme } from "@/lib/documents/readme";
import { writeBrainstormSpec } from "@/lib/gitfill/brainstorm";
import { describeGitfill, readGitfill } from "@/lib/gitfill/read";
import { brainstormRequestSchema, readmeRequestSchema } from "@/lib/validation/request";
import type { DbRecorder } from "./db-recorder";
import { complete, ingest, saveDocument, saveSnapshot } from "./document-jobs";

type Job = typeof generationJobs.$inferSelect;

/**
 * README.md written (or brought up to date) from the code and the team's .gitfill folder: the
 * analysis agent reads the code, the writer combines it with the team's assets and notes and the
 * current README, and image links are checked against the tree.
 */
export async function runReadmeJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = readmeRequestSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const snapshot = await ingest(github, job.repositoryUrl, request.branch ?? job.branch ?? undefined, recorder);
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  const gitfillEvent = await recorder.start("tool", "read_gitfill", { repository: snapshot.displayName });
  const gitfill = await readGitfill(github, { owner: String(snapshot.metadata.owner), name: String(snapshot.metadata.repo), sha: snapshot.version, paths: snapshot.inventory });
  await gitfillEvent.succeed({ present: gitfill.present, images: gitfill.assets.filter((a) => a.kind === "image").length, notes: gitfill.notes.map((n) => n.path), docs: gitfill.docs.length });

  const analysis = await analyzeRepository({ client, snapshot, userRequest: `Write or update the repository's README.md. ${request.instructions}`, recorder });

  await recorder.setStage("composing_document");
  const current = snapshot.files.find((f) => /^readme(\.md|\.markdown)?$/i.test(f.path))?.content;
  const readme = await generateReadme({ client, snapshot, analysis: analysis.analysis, claims: analysis.claims, recorder, gitfill: describeGitfill(gitfill), current, instructions: request.instructions });

  const snap = await saveSnapshot(db, job.projectId, snapshot, { analysis: analysis.analysis, agent: { turns: analysis.turns, toolCalls: analysis.toolCalls } }, analysis.claims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "readme",
    title: `README.md for ${snapshot.displayName}`,
    markdown: readme.markdown,
    spec: { updated: Boolean(current) },
    metadata: {
      request,
      repository: snapshot.displayName,
      commitSha: snapshot.version,
      branch: snapshot.branch,
      updatedExisting: Boolean(current),
      imagesAvailable: gitfill.assets.filter((a) => a.kind === "image").map((a) => a.path),
      removedImages: readme.removedImages,
      unknownPaths: readme.unknownPaths,
    },
    snapshotId: snap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, snap.id);
}

/** A brainstorm from chat, written as an implementation spec grounded in the code. */
export async function runBrainstormJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = brainstormRequestSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const snapshot = await ingest(github, job.repositoryUrl, request.branch ?? job.branch ?? undefined, recorder);
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  await recorder.setStage("composing_document");
  const result = await writeBrainstormSpec({ client, snapshot, conversation: request.conversation, title: request.title, recorder });
  const snap = await saveSnapshot(db, job.projectId, snapshot, {}, result.claims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "brainstorm",
    title: result.spec.title,
    markdown: result.markdown,
    spec: result.spec,
    metadata: { repository: snapshot.displayName, commitSha: snapshot.version, branch: snapshot.branch, tasks: result.spec.tasks.length, openQuestions: result.spec.openQuestions.length },
    snapshotId: snap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, snap.id);
}
