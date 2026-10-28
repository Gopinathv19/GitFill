import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { githubClientFor } from "@/lib/auth/github-token";
import { canonicalRepoUrl, parseGitHubUrl } from "@/lib/connectors/github/url";
import type { Database } from "@/lib/db";
import { artifacts, chatMessages, deckVersions, decks, documents, generationJobs, projects, workspaceRepositories, workspaces } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/http";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  /** Optional: import this GitHub repository as the workspace's first repo. */
  importUrl: z.string().trim().max(500).optional(),
});

export const addRepositorySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("import"), url: z.string().trim().min(3).max(500) }),
  z.object({
    mode: z.literal("create"),
    name: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/, "Use letters, numbers, '.', '-' or '_'."),
    description: z.string().trim().max(300).optional(),
  }),
]);

/** Resolves a GitHub URL to canonical repository metadata as the user (their token sees their private repositories). */
async function lookupRepository(db: Database, userId: string, url: string) {
  const ref = parseGitHubUrl(url);
  const info = await (await githubClientFor(db, userId)).getRepo(ref.owner, ref.repo);
  const [owner, name] = info.fullName.split("/");
  return { owner: owner!, name: name!, repositoryUrl: canonicalRepoUrl({ owner: owner!, repo: name! }), defaultBranch: info.defaultBranch, description: info.description, isPrivate: info.private };
}

export async function listWorkspaces(db: Database, userId: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.ownerId, userId)).orderBy(desc(workspaces.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((w) => w.id);
  const repos = await db.select().from(workspaceRepositories).where(inArray(workspaceRepositories.workspaceId, ids)).orderBy(asc(workspaceRepositories.createdAt));
  const deckCounts = await db
    .select({ workspaceId: projects.workspaceId, n: count(decks.id) })
    .from(decks)
    .innerJoin(projects, eq(decks.projectId, projects.id))
    .where(inArray(projects.workspaceId, ids))
    .groupBy(projects.workspaceId);
  const docCounts = await db
    .select({ workspaceId: projects.workspaceId, n: count(documents.id) })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(inArray(projects.workspaceId, ids))
    .groupBy(projects.workspaceId);
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    updatedAt: w.updatedAt,
    repositories: repos.filter((r) => r.workspaceId === w.id).map(repoView),
    presentationCount: Number(deckCounts.find((d) => d.workspaceId === w.id)?.n ?? 0),
    documentCount: Number(docCounts.find((d) => d.workspaceId === w.id)?.n ?? 0),
  }));
}

export async function createWorkspace(db: Database, userId: string, input: z.infer<typeof createWorkspaceSchema>) {
  const imported = input.importUrl ? await lookupRepository(db, userId, input.importUrl) : undefined;
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ ownerId: userId, name: input.name, description: input.description || imported?.description || null }).returning();
    if (imported) await tx.insert(workspaceRepositories).values({ workspaceId: ws!.id, source: "imported", ...imported });
    return ws!;
  });
}

export async function assertWorkspace(db: Database, userId: string, workspaceId: string) {
  const ws = (await db.select().from(workspaces).where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, userId))))[0];
  if (!ws) throw new NotFoundError("Workspace not found.");
  return ws;
}

export async function getWorkspace(db: Database, userId: string, workspaceId: string) {
  const ws = await assertWorkspace(db, userId, workspaceId);
  const repos = await db.select().from(workspaceRepositories).where(eq(workspaceRepositories.workspaceId, ws.id)).orderBy(asc(workspaceRepositories.createdAt));
  const deckRows = await db
    .select({ id: decks.id, title: decks.title, latestVersion: decks.latestVersion, updatedAt: decks.updatedAt, repositoryId: projects.repositoryId })
    .from(decks)
    .innerJoin(projects, eq(decks.projectId, projects.id))
    .where(eq(projects.workspaceId, ws.id))
    .orderBy(desc(decks.updatedAt));
  const jobs = await db
    .select({ id: generationJobs.id, kind: generationJobs.kind, status: generationJobs.status, prompt: generationJobs.userPrompt, deckId: generationJobs.deckId, documentId: generationJobs.documentId, createdAt: generationJobs.createdAt })
    .from(generationJobs)
    .innerJoin(projects, eq(generationJobs.projectId, projects.id))
    .where(eq(projects.workspaceId, ws.id))
    .orderBy(desc(generationJobs.createdAt))
    .limit(10);
  const docRows = await db
    .select({ id: documents.id, kind: documents.kind, title: documents.title, createdAt: documents.createdAt, repositoryId: projects.repositoryId, metadata: documents.metadata })
    .from(documents)
    .innerJoin(projects, eq(documents.projectId, projects.id))
    .where(eq(projects.workspaceId, ws.id))
    .orderBy(desc(documents.createdAt))
    .limit(50);
  const thumbs = deckRows.length ? await firstSlidePreviews(db, deckRows.map((d) => d.id)) : new Map<string, string>();
  return {
    id: ws.id,
    name: ws.name,
    description: ws.description,
    createdAt: ws.createdAt,
    repositories: repos.map(repoView),
    presentations: deckRows.map((d) => ({ ...d, previewArtifactId: thumbs.get(d.id) ?? null })),
    documents: docRows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, createdAt: d.createdAt, repositoryId: d.repositoryId, repository: (d.metadata as { repository?: string } | null)?.repository ?? null })),
    jobs,
  };
}

/** Preview image of slide 1 of each deck's latest version, for cards. */
export async function firstSlidePreviews(db: Database, deckIds: string[]) {
  const rows = await db
    .select({ deckId: deckVersions.deckId, version: deckVersions.version, artifactId: artifacts.id })
    .from(artifacts)
    .innerJoin(deckVersions, eq(artifacts.deckVersionId, deckVersions.id))
    .where(and(inArray(deckVersions.deckId, deckIds), eq(artifacts.artifactType, "slide_preview"), eq(artifacts.slideIndex, 0)))
    .orderBy(desc(deckVersions.version));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.deckId)) out.set(r.deckId, r.artifactId);
  return out;
}

export async function addRepository(db: Database, userId: string, workspaceId: string, input: z.infer<typeof addRepositorySchema>) {
  await assertWorkspace(db, userId, workspaceId);
  const values =
    input.mode === "import"
      ? { workspaceId, source: "imported" as const, ...(await lookupRepository(db, userId, input.url)) }
      : { workspaceId, source: "created" as const, name: input.name, description: input.description || null };
  const [repo] = await db.insert(workspaceRepositories).values(values).returning();
  await db.update(workspaces).set({ updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  return repoView(repo!);
}

export async function removeRepository(db: Database, userId: string, workspaceId: string, repositoryId: string) {
  await assertWorkspace(db, userId, workspaceId);
  const deleted = await db
    .delete(workspaceRepositories)
    .where(and(eq(workspaceRepositories.id, repositoryId), eq(workspaceRepositories.workspaceId, workspaceId)))
    .returning({ id: workspaceRepositories.id });
  if (!deleted.length) throw new NotFoundError("Repository not found.");
}

export async function getRepository(db: Database, userId: string, workspaceId: string, repositoryId: string) {
  await assertWorkspace(db, userId, workspaceId);
  const repo = (await db.select().from(workspaceRepositories).where(and(eq(workspaceRepositories.id, repositoryId), eq(workspaceRepositories.workspaceId, workspaceId))))[0];
  if (!repo) throw new NotFoundError("Repository not found.");
  return repo;
}

export function repoView(r: typeof workspaceRepositories.$inferSelect) {
  return {
    id: r.id,
    source: r.source,
    name: r.name,
    owner: r.owner,
    fullName: r.owner ? `${r.owner}/${r.name}` : r.name,
    description: r.description,
    repositoryUrl: r.repositoryUrl,
    defaultBranch: r.defaultBranch,
    isPrivate: r.isPrivate,
    /** Created repos have no code on GitHub yet, so they cannot be analyzed. */
    analyzable: Boolean(r.repositoryUrl),
    createdAt: r.createdAt,
  };
}

// ─── Access checks for resources owned through a workspace ─────────────────────

export async function assertDeckAccess(db: Database, userId: string, deckId: string) {
  const row = (
    await db
      .select({ deck: decks, workspaceId: workspaces.id })
      .from(decks)
      .innerJoin(projects, eq(decks.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(and(eq(decks.id, deckId), eq(workspaces.ownerId, userId)))
  )[0];
  if (!row) throw new NotFoundError("Presentation not found.");
  return row;
}

export async function assertJobAccess(db: Database, userId: string, jobId: string) {
  const row = (
    await db
      .select({ jobId: generationJobs.id, workspaceId: workspaces.id })
      .from(generationJobs)
      .innerJoin(projects, eq(generationJobs.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(and(eq(generationJobs.id, jobId), eq(workspaces.ownerId, userId)))
  )[0];
  if (!row) throw new NotFoundError("Job not found.");
  return row;
}

export async function assertDocumentAccess(db: Database, userId: string, documentId: string) {
  const row = (
    await db
      .select({ document: documents, workspaceId: workspaces.id, workspaceName: workspaces.name, repositoryId: projects.repositoryId })
      .from(documents)
      .innerJoin(projects, eq(documents.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(and(eq(documents.id, documentId), eq(workspaces.ownerId, userId)))
  )[0];
  if (!row) throw new NotFoundError("Document not found.");
  return row;
}

export async function assertArtifactAccess(db: Database, userId: string, artifactId: string) {
  const row = (
    await db
      .select({ artifact: artifacts })
      .from(artifacts)
      .innerJoin(deckVersions, eq(artifacts.deckVersionId, deckVersions.id))
      .innerJoin(decks, eq(deckVersions.deckId, decks.id))
      .innerJoin(projects, eq(decks.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(and(eq(artifacts.id, artifactId), eq(workspaces.ownerId, userId)))
  )[0];
  if (!row) throw new NotFoundError("File not found.");
  return row.artifact;
}

// ─── Chat history ─────────────────────────────────────────────────────────────

export async function listMessages(db: Database, workspaceId: string, limit = 100) {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.workspaceId, workspaceId)).orderBy(desc(chatMessages.createdAt)).limit(limit);
  return rows.reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, jobIds: m.jobIds as string[], createdAt: m.createdAt }));
}

export async function addMessage(db: Database, workspaceId: string, role: "user" | "assistant", content: string, jobIds: string[] = []) {
  const [m] = await db.insert(chatMessages).values({ workspaceId, role, content, jobIds }).returning();
  await db.update(workspaces).set({ updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  return { id: m!.id, role: m!.role, content: m!.content, jobIds: m!.jobIds as string[], createdAt: m!.createdAt };
}
