import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { firstSlidePreviews } from "@/lib/workspaces/service";
import { agentEvents, agentRuns, artifacts, deckVersions, decks, documents, evidenceClaims, generationJobs, projects, repositorySnapshots, workspaces } from "@/lib/db/schema";

/** Read models for the API. Raw repository content is never returned, only metadata and summaries. */

export async function getJobView(db: Database, jobId: string) {
  const job = (await db.select().from(generationJobs).where(eq(generationJobs.id, jobId)))[0];
  if (!job) return undefined;
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.jobId, jobId)).orderBy(asc(agentRuns.startedAt));
  const events = runs.length
    ? await db
        .select()
        .from(agentEvents)
        .where(inArray(agentEvents.runId, runs.map((r) => r.id)))
        .orderBy(asc(agentEvents.startedAt))
    : [];
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    repositoryUrl: job.repositoryUrl,
    branch: job.branch,
    commitSha: job.commitSha,
    prompt: job.userPrompt,
    options: job.options,
    errorMessage: job.errorMessage,
    deckId: job.deckId,
    documentId: job.documentId,
    resultVersionId: job.resultVersionId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    usage: runs.reduce((u, r) => ({ inputTokens: u.inputTokens + r.inputTokens, outputTokens: u.outputTokens + r.outputTokens }), { inputTokens: 0, outputTokens: 0 }),
    events: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      name: e.name,
      status: e.status,
      model: e.model,
      input: e.inputSummary,
      output: e.outputSummary,
      error: e.errorSummary,
      durationMs: e.durationMs,
      startedAt: e.startedAt,
    })),
  };
}

export async function listRecent(db: Database, userId: string, limit = 20) {
  const jobs = await db
    .select({ job: generationJobs, workspaceId: workspaces.id, workspaceName: workspaces.name })
    .from(generationJobs)
    .innerJoin(projects, eq(generationJobs.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerId, userId))
    .orderBy(desc(generationJobs.createdAt))
    .limit(limit);
  const deckRows = await db
    .select({ deck: decks, workspaceId: workspaces.id, workspaceName: workspaces.name })
    .from(decks)
    .innerJoin(projects, eq(decks.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerId, userId))
    .orderBy(desc(decks.updatedAt))
    .limit(limit);
  const previews = deckRows.length ? await firstSlidePreviews(db, deckRows.map((r) => r.deck.id)) : new Map<string, string>();
  const docRows = await db
    .select({ doc: documents, workspaceId: workspaces.id, workspaceName: workspaces.name })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerId, userId))
    .orderBy(desc(documents.createdAt))
    .limit(limit);
  return {
    jobs: jobs.map(({ job: j, workspaceId, workspaceName }) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      repositoryUrl: j.repositoryUrl,
      prompt: j.userPrompt,
      deckId: j.deckId,
      documentId: j.documentId,
      createdAt: j.createdAt,
      errorMessage: j.errorMessage,
      workspaceId,
      workspaceName,
    })),
    documents: docRows.map(({ doc, workspaceId, workspaceName }) => documentSummary(doc, workspaceId, workspaceName)),
    decks: deckRows.map(({ deck: d, workspaceId, workspaceName }) => ({
      id: d.id,
      title: d.title,
      latestVersion: d.latestVersion,
      updatedAt: d.updatedAt,
      workspaceId,
      workspaceName,
      previewArtifactId: previews.get(d.id) ?? null,
    })),
  };
}

export async function getDeckView(db: Database, deckId: string) {
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!deck) return undefined;
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  const versions = await db.select().from(deckVersions).where(eq(deckVersions.deckId, deckId)).orderBy(desc(deckVersions.version));
  const files = versions.length
    ? await db
        .select()
        .from(artifacts)
        .where(inArray(artifacts.deckVersionId, versions.map((v) => v.id)))
        .orderBy(asc(artifacts.slideIndex))
    : [];
  const claims = await db.select().from(evidenceClaims).where(eq(evidenceClaims.snapshotId, snap.id)).orderBy(asc(evidenceClaims.createdAt));
  const pending = await db.select({ id: generationJobs.id, status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.deckId, deckId)).orderBy(desc(generationJobs.createdAt)).limit(1);
  const summary = snap.summary as { analysis?: unknown; stats?: unknown; agent?: unknown } | null;

  return {
    id: deck.id,
    title: deck.title,
    latestVersion: deck.latestVersion,
    latestJob: pending[0] ?? null,
    repository: {
      url: snap.repositoryUrl,
      owner: snap.owner,
      name: snap.name,
      branch: snap.branch,
      commitSha: snap.commitSha,
      stats: summary?.stats ?? null,
      analysis: summary?.analysis ?? null,
      agent: summary?.agent ?? null,
    },
    claims: claims.map((c) => ({ ref: c.ref, claim: c.claim, type: c.claimType, status: c.status, filePath: c.filePath, startLine: c.startLine, endLine: c.endLine })),
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      jobId: v.jobId,
      changeSummary: v.changeSummary,
      createdAt: v.createdAt,
      spec: v.spec,
      validation: v.validation,
      artifacts: files
        .filter((a) => a.deckVersionId === v.id)
        .map((a) => ({ id: a.id, type: a.artifactType, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, slideIndex: a.slideIndex })),
    })),
  };
}

type DocumentRow = typeof documents.$inferSelect;

function documentSummary(d: DocumentRow, workspaceId: string, workspaceName: string) {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    createdAt: d.createdAt,
    workspaceId,
    workspaceName,
    repository: typeof meta.repository === "string" ? meta.repository : null,
    commitSha: typeof meta.commitSha === "string" ? meta.commitSha : typeof meta.headSha === "string" ? meta.headSha : null,
    claims: (meta.claims as { total?: number; verified?: number; inferred?: number; unverified?: number } | undefined) ?? null,
  };
}

export async function listDocuments(db: Database, userId: string, opts: { workspaceId?: string; kind?: DocumentRow["kind"]; limit?: number } = {}) {
  const conditions = [eq(workspaces.ownerId, userId)];
  if (opts.workspaceId) conditions.push(eq(workspaces.id, opts.workspaceId));
  if (opts.kind) conditions.push(eq(documents.kind, opts.kind));
  const rows = await db
    .select({ doc: documents, workspaceId: workspaces.id, workspaceName: workspaces.name })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ doc, workspaceId, workspaceName }) => documentSummary(doc, workspaceId, workspaceName));
}

/** Full document with its evidence (claims of the snapshots it was generated from). */
export async function getDocumentView(db: Database, documentId: string) {
  const row = (
    await db
      .select({ doc: documents, workspaceId: workspaces.id, workspaceName: workspaces.name, repositoryId: projects.repositoryId })
      .from(documents)
      .innerJoin(projects, eq(documents.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(eq(documents.id, documentId))
  )[0];
  if (!row) return undefined;
  const snapIds = [row.doc.snapshotId, row.doc.secondarySnapshotId].filter((x): x is string => Boolean(x));
  const snaps = snapIds.length ? await db.select().from(repositorySnapshots).where(inArray(repositorySnapshots.id, snapIds)) : [];
  const claims = snapIds.length ? await db.select().from(evidenceClaims).where(inArray(evidenceClaims.snapshotId, snapIds)).orderBy(asc(evidenceClaims.createdAt)) : [];
  const job = row.doc.jobId ? (await db.select({ id: generationJobs.id, status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.id, row.doc.jobId)))[0] : undefined;
  const { claims: claimCounts, ...summary } = documentSummary(row.doc, row.workspaceId, row.workspaceName);
  return {
    ...summary,
    claimCounts,
    repositoryId: row.repositoryId,
    markdown: row.doc.markdown,
    spec: row.doc.spec,
    metadata: row.doc.metadata,
    job: job ?? null,
    snapshots: snaps.map((s) => ({ id: s.id, repositoryUrl: s.repositoryUrl, owner: s.owner, name: s.name, branch: s.branch, commitSha: s.commitSha, role: s.id === row.doc.snapshotId ? "primary" : "secondary" })),
    claims: claims.map((c) => ({ ref: c.ref, claim: c.claim, type: c.claimType, status: c.status, filePath: c.filePath, startLine: c.startLine, endLine: c.endLine, snapshotId: c.snapshotId })),
  };
}
