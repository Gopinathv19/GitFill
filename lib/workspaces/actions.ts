import { and, eq, inArray } from "drizzle-orm";
import { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { githubClientFor } from "@/lib/auth/github-token";
import { getSnapshot } from "@/lib/connectors/cache";
import { parseGitHubUrl } from "@/lib/connectors/github/url";
import type { Database } from "@/lib/db";
import { generationJobs, projects, repositorySnapshots } from "@/lib/db/schema";
import { saveDocument } from "@/lib/jobs/document-jobs";
import { kickInlineWorker } from "@/lib/jobs/inline";
import { ACTIVE_STATUSES, enqueueDocumentJob, enqueueGeneration, enqueueRevision } from "@/lib/jobs/queue";
import { explainCode } from "@/lib/understanding/explain";
import { compareRequestSchema, handbookRequestSchema, type AskRequest, type CompareRequest, type HandbookRequest, type ReuseKind } from "@/lib/understanding/schemas";
import { generateRequestSchema, type GenerateRequest } from "@/lib/validation/request";
import { assertDeckAccess, getRepository } from "./service";

export class ActionError extends Error {
  override name = "ActionError";
}

type Repo = Awaited<ReturnType<typeof getRepository>>;

function requireUrl(repo: Repo): string {
  if (!repo.repositoryUrl) {
    throw new ActionError(`"${repo.name}" was created in this workspace and has no code on GitHub yet, so it cannot be analyzed.`);
  }
  return repo.repositoryUrl;
}

/** Starts a presentation for one of the workspace's repositories (used by chat and the UI). */
export async function startPresentation(db: Database, userId: string, workspaceId: string, repositoryId: string, options: Partial<Omit<GenerateRequest, "repositoryUrl">>) {
  const repo = await getRepository(db, userId, workspaceId, repositoryId);
  const url = requireUrl(repo);
  const request = generateRequestSchema.parse({ ...options, repositoryUrl: url, branch: options.branch ?? repo.defaultBranch ?? undefined });
  const job = await enqueueGeneration(db, { workspaceId, repositoryId }, request);
  kickInlineWorker(db);
  return { job, repo, request };
}

/** Queues a revision for a deck the user owns, refusing if one is already running. */
export async function revisePresentation(db: Database, userId: string, deckId: string, instruction: string) {
  const { deck } = await assertDeckAccess(db, userId, deckId);
  const busy = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.deckId, deckId), inArray(generationJobs.status, ["pending", ...ACTIVE_STATUSES])));
  if (busy.length) throw new ActionError("A revision is already running for this presentation.");
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  const job = await enqueueRevision(db, deck, snap.repositoryUrl, instruction);
  kickInlineWorker(db);
  return { job, deck };
}

/** Queues a repository, module or feature handbook. */
export async function startHandbook(db: Database, userId: string, workspaceId: string, repositoryId: string, options: Partial<HandbookRequest>) {
  const repo = await getRepository(db, userId, workspaceId, repositoryId);
  const url = requireUrl(repo);
  const request = handbookRequestSchema.parse({ ...options, branch: options.branch ?? repo.defaultBranch ?? undefined });
  const prompt = `Handbook (${request.audience.replace(/_/g, " ")}, ${request.scope}${request.focus ? `: ${request.focus}` : ""}) for ${repo.owner}/${repo.name}. ${request.instructions}`.trim();
  const job = await enqueueDocumentJob(db, { workspaceId, repositoryId }, { kind: "handbook", repositoryUrl: url, branch: request.branch, prompt, options: request, projectName: `${repo.owner}/${repo.name}` });
  kickInlineWorker(db);
  return { job, repo, request };
}

/** Queues a commit-to-commit comparison. */
export async function startComparison(db: Database, userId: string, workspaceId: string, repositoryId: string, options: Partial<CompareRequest>) {
  const repo = await getRepository(db, userId, workspaceId, repositoryId);
  const url = requireUrl(repo);
  const request = compareRequestSchema.parse(options);
  if (request.base === request.head) throw new ActionError("Base and head must be different commits.");
  const prompt = `Compare ${request.base.slice(0, 12)} → ${request.head.slice(0, 12)} in ${repo.owner}/${repo.name}. ${request.focus}`;
  const job = await enqueueDocumentJob(db, { workspaceId, repositoryId }, { kind: "compare", repositoryUrl: url, branch: request.head, prompt, options: request, projectName: `${repo.owner}/${repo.name}` });
  kickInlineWorker(db);
  return { job, repo, request };
}

/** Queues an implementation brief that transfers patterns from a reference repo into a target repo. */
export async function startReuseBrief(
  db: Database,
  userId: string,
  workspaceId: string,
  input: { referenceRepositoryId: string; targetRepositoryId: string; request: string; reuseKinds: ReuseKind[]; referenceBranch?: string; targetBranch?: string },
) {
  if (input.referenceRepositoryId === input.targetRepositoryId) throw new ActionError("Reference and target must be different repositories.");
  const [reference, target] = await Promise.all([getRepository(db, userId, workspaceId, input.referenceRepositoryId), getRepository(db, userId, workspaceId, input.targetRepositoryId)]);
  const referenceUrl = requireUrl(reference);
  const targetUrl = requireUrl(target);
  const options = {
    request: input.request,
    reuseKinds: input.reuseKinds,
    referenceUrl,
    referenceBranch: input.referenceBranch ?? reference.defaultBranch ?? undefined,
    targetUrl,
    targetBranch: input.targetBranch ?? target.defaultBranch ?? undefined,
  };
  const prompt = `Implementation brief: reuse ${input.reuseKinds.join(", ")} patterns from ${reference.owner}/${reference.name} in ${target.owner}/${target.name}. ${input.request}`;
  const job = await enqueueDocumentJob(db, { workspaceId, repositoryId: target.id }, { kind: "reuse", repositoryUrl: targetUrl, branch: options.targetBranch, prompt, options, projectName: `${target.owner}/${target.name}` });
  kickInlineWorker(db);
  return { job, reference, target };
}

/** Lists recent commits of a repository for the comparison picker. */
export async function listRepositoryCommits(db: Database, userId: string, workspaceId: string, repositoryId: string, branch?: string) {
  const repo = await getRepository(db, userId, workspaceId, repositoryId);
  const ref = parseGitHubUrl(requireUrl(repo));
  const commits = await (await githubClientFor(db, userId)).listCommits(ref.owner, ref.repo, branch ?? repo.defaultBranch ?? undefined, 40);
  return { repository: `${ref.owner}/${ref.repo}`, branch: branch ?? repo.defaultBranch, commits };
}

/**
 * Answers a question about a repository synchronously: the snapshot comes from the cache
 * (or is ingested), the explainer agent works through real tools, and the explanation is
 * returned as Markdown with sources. Optionally saved as a document.
 */
export async function askRepository(db: Database, userId: string, workspaceId: string, repositoryId: string, request: AskRequest, opts: { save?: boolean } = {}) {
  const repo = await getRepository(db, userId, workspaceId, repositoryId);
  const url = requireUrl(repo);
  const snapshot = await getSnapshot(url, request.branch ?? repo.defaultBranch ?? undefined, { client: await githubClientFor(db, userId) });
  const recorder = new MemoryRecorder();
  const result = await explainCode({ client: new MuseClient(), snapshot, request, recorder });
  let documentId: string | null = null;
  if (opts.save) {
    const [project] = await db.insert(projects).values({ workspaceId, repositoryId, name: `${repo.owner}/${repo.name}`, description: request.question.slice(0, 300) }).returning();
    const doc = await saveDocument(db, {
      projectId: project!.id,
      kind: "explanation",
      title: result.spec.title,
      markdown: result.markdown,
      spec: result.spec,
      metadata: { question: request.question, repository: snapshot.displayName, commitSha: snapshot.version, branch: snapshot.branch, agent: result.agent, claims: { total: result.claims.length } },
    });
    documentId = doc.id;
  }
  return {
    title: result.spec.title,
    markdown: result.markdown,
    mermaid: result.mermaid,
    references: result.spec.references,
    unverified: result.spec.unverified,
    followUps: result.spec.followUps,
    repository: snapshot.displayName,
    commitSha: snapshot.version,
    branch: snapshot.branch,
    agent: result.agent,
    usage: recorder.usage,
    documentId,
  };
}
