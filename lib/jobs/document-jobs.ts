import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { githubClientForJob } from "@/lib/auth/github-token";
import type { GitHubClient } from "@/lib/connectors/github/client";
import { ingestGitHubRepository } from "@/lib/connectors/github/ingest";
import { parseGitHubUrl } from "@/lib/connectors/github/url";
import { remember, snapshotCacheKey } from "@/lib/connectors/cache";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Database } from "@/lib/db";
import { documents, evidenceClaims, generationJobs, repositorySnapshots, type DocumentKind } from "@/lib/db/schema";
import type { Claim } from "@/lib/evidence/evidence";
import { retrieverFor } from "@/lib/memora/retriever";
import { compareCommits } from "@/lib/understanding/compare";
import { generateHandbook } from "@/lib/understanding/handbook";
import { generateImplementationBrief } from "@/lib/understanding/reuse";
import { compareRequestSchema, handbookRequestSchema, REUSE_KINDS } from "@/lib/understanding/schemas";
import type { DbRecorder } from "./db-recorder";

type Job = typeof generationJobs.$inferSelect;

/** Stored on the job for reuse briefs: both repositories resolved at enqueue time. */
export const reuseJobOptionsSchema = z.object({
  request: z.string(),
  reuseKinds: z.array(z.enum(REUSE_KINDS)).min(1),
  referenceUrl: z.string(),
  referenceBranch: z.string().optional(),
  targetUrl: z.string(),
  targetBranch: z.string().optional(),
});

export async function runHandbookJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = handbookRequestSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const snapshot = await ingest(github, job.repositoryUrl, request.branch ?? job.branch ?? undefined, recorder);
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  await recorder.setStage("composing_document");
  const result = await generateHandbook({ client, snapshot, request, recorder });

  const snap = await saveSnapshot(db, job.projectId, snapshot, { agent: result.agent }, result.claims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "handbook",
    title: result.spec.title,
    markdown: result.markdown,
    spec: result.spec,
    metadata: { request, repository: snapshot.displayName, commitSha: snapshot.version, branch: snapshot.branch, danglingRefs: result.danglingRefs, diagramIssues: result.diagramIssues, agent: result.agent, claims: counts(result.claims) },
    snapshotId: snap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, snap.id);
}

export async function runCompareJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = compareRequestSchema.parse(job.options);
  const ref = parseGitHubUrl(job.repositoryUrl);
  await recorder.setStage("comparing_commits");
  const result = await compareCommits({ client, github: await githubClientForJob(db, job), owner: ref.owner, repo: ref.repo, sourceUrl: job.repositoryUrl, request, recorder });
  await db.update(generationJobs).set({ commitSha: result.compare.headSha, branch: request.head }).where(eq(generationJobs.id, job.id));

  await recorder.setStage("composing_document");
  const versionRow = (v: typeof result.after, label: string) =>
    db
      .insert(repositorySnapshots)
      .values({ projectId: job.projectId, repositoryUrl: job.repositoryUrl, owner: ref.owner, name: ref.repo, defaultBranch: v.branch, branch: v.branch, commitSha: v.version, summary: { kind: "compare_version", label, displayName: v.displayName } })
      .returning();
  const [before] = await versionRow(result.before, "base");
  const [after] = await versionRow(result.after, "head");
  const beforeClaims = result.claims.filter((c) => c.claim.startsWith("[before]"));
  const afterClaims = result.claims.filter((c) => !c.claim.startsWith("[before]"));
  await insertClaims(db, after!.id, afterClaims);
  await insertClaims(db, before!.id, beforeClaims);

  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "commit_report",
    title: result.spec.title,
    markdown: result.markdown,
    spec: result.spec,
    metadata: {
      request,
      repository: result.after.displayName,
      baseSha: result.compare.baseSha,
      headSha: result.compare.headSha,
      commits: result.compare.totalCommits,
      summary: result.diff.summary,
      structural: {
        symbolsAdded: result.diff.symbols.added.length,
        symbolsRemoved: result.diff.symbols.removed.length,
        symbolsModified: result.diff.symbols.modified.length,
        symbolsMoved: result.diff.symbols.moved.length,
        dependenciesAdded: result.diff.dependencies.added.length,
        dependenciesRemoved: result.diff.dependencies.removed.length,
        packagesAdded: result.diff.packages.added,
        packagesRemoved: result.diff.packages.removed,
        routesAdded: result.diff.routes.added.length,
        routesRemoved: result.diff.routes.removed.length,
      },
      agent: result.agent,
      claims: counts(result.claims),
    },
    snapshotId: after!.id,
    secondarySnapshotId: before!.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, after!.id);
}

export async function runReuseJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const options = reuseJobOptionsSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const [reference, target] = await Promise.all([ingest(github, options.referenceUrl, options.referenceBranch, recorder, "reference"), ingest(github, options.targetUrl, options.targetBranch, recorder, "target")]);
  await db.update(generationJobs).set({ branch: target.branch, commitSha: target.version }).where(eq(generationJobs.id, job.id));

  await recorder.setStage("composing_document");
  const result = await generateImplementationBrief({ client, reference, target, request: options.request, reuseKinds: options.reuseKinds, recorder });

  const refSnap = await saveSnapshot(db, job.projectId, reference, { role: "reference", agent: result.agent }, result.referenceClaims);
  const tgtSnap = await saveSnapshot(db, job.projectId, target, { role: "target", agent: result.agent }, result.targetClaims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "implementation_brief",
    title: result.spec.title,
    markdown: result.markdown,
    spec: result.spec,
    metadata: {
      request: options.request,
      reuseKinds: options.reuseKinds,
      reference: { repository: reference.displayName, commitSha: reference.version, branch: reference.branch, url: reference.sourceUrl },
      target: { repository: target.displayName, commitSha: target.version, branch: target.branch, url: target.sourceUrl },
      danglingRefs: result.danglingRefs,
      agent: result.agent,
      claims: counts([...result.referenceClaims, ...result.targetClaims]),
    },
    snapshotId: tgtSnap.id,
    secondarySnapshotId: refSnap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, tgtSnap.id);
}

// ─── helpers ───────────────────────────────────────────────────────────────────

async function ingest(client: GitHubClient, url: string, branch: string | undefined, recorder: DbRecorder, label = "repository"): Promise<SourceSnapshot> {
  const event = await recorder.start("tool", `inspect_${label}`, { url, branch, asUser: client.authenticated });
  try {
    const snapshot = await ingestGitHubRepository({ url, branch, client });
    await event.succeed({ repository: snapshot.displayName, commit: snapshot.version.slice(0, 7), files: snapshot.stats.selectedFiles, tree: snapshot.stats.totalEntries });
    remember(snapshotCacheKey(url, branch), snapshot);
    startMemoraIndex(snapshot, recorder);
    return snapshot;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "ingest failed");
    throw err;
  }
}

/**
 * Starts indexing the snapshot in Memora in the background. Jobs never wait for it: indexing took
 * 2-3 minutes per handbook, and agents fall back to search_code until the index is ready.
 */
function startMemoraIndex(snapshot: SourceSnapshot, recorder: DbRecorder): void {
  const retriever = retrieverFor(snapshot);
  if (!retriever) return;
  void (async () => {
    const event = await recorder.start("tool", "index_repository", { backend: retriever.backend, files: snapshot.stats.selectedFiles, background: true });
    const status = await retriever.ensureIndexed().catch(() => "unavailable" as const);
    if (status === "unavailable") await event.fail("Memora index unavailable; agents fall back to search_code.");
    else await event.succeed({ status });
  })().catch(() => undefined);
}

async function saveSnapshot(db: Database, projectId: string, snapshot: SourceSnapshot, extra: Record<string, unknown>, claims: Claim[]) {
  const [snap] = await db
    .insert(repositorySnapshots)
    .values({
      projectId,
      repositoryUrl: snapshot.sourceUrl,
      owner: String(snapshot.metadata.owner),
      name: String(snapshot.metadata.repo),
      defaultBranch: snapshot.defaultBranch,
      branch: snapshot.branch,
      commitSha: snapshot.version,
      summary: { displayName: snapshot.displayName, description: snapshot.description, stats: snapshot.stats, metadata: snapshot.metadata, inventory: snapshot.inventory.slice(0, 5000), ...extra },
    })
    .returning();
  await insertClaims(db, snap!.id, claims);
  return snap!;
}

async function insertClaims(db: Database, snapshotId: string, claims: Claim[]) {
  if (!claims.length) return;
  await db.insert(evidenceClaims).values(
    claims.map((c) => ({ snapshotId, ref: c.ref, claim: c.claim, claimType: c.claimType, filePath: c.filePath, startLine: c.startLine, endLine: c.endLine, excerpt: c.excerpt, status: c.status })),
  );
}

export async function saveDocument(
  db: Database,
  doc: { projectId: string; kind: DocumentKind; title: string; markdown: string; spec: unknown; metadata: Record<string, unknown>; snapshotId?: string | null; secondarySnapshotId?: string | null; jobId?: string | null },
) {
  const [row] = await db
    .insert(documents)
    .values({ projectId: doc.projectId, kind: doc.kind, title: doc.title.slice(0, 200), markdown: doc.markdown, spec: doc.spec as object, metadata: doc.metadata, snapshotId: doc.snapshotId ?? null, secondarySnapshotId: doc.secondarySnapshotId ?? null, jobId: doc.jobId ?? null })
    .returning();
  return row!;
}

async function complete(db: Database, jobId: string, documentId: string, snapshotId: string) {
  await db.update(generationJobs).set({ status: "completed", documentId, snapshotId, completedAt: new Date() }).where(eq(generationJobs.id, jobId));
}

function counts(claims: Claim[]) {
  return { total: claims.length, verified: claims.filter((c) => c.status === "verified").length, inferred: claims.filter((c) => c.status === "inferred").length, unverified: claims.filter((c) => c.status === "unverified").length };
}
