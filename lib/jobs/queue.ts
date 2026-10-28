import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { parseGitHubUrl, canonicalRepoUrl } from "@/lib/connectors/github/url";
import { rowsOf, type Database } from "@/lib/db";
import { generationJobs, projects, type JobKind, type JobStatus } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/validation/request";

export const ACTIVE_STATUSES: JobStatus[] = [
  "analyzing_repository",
  "planning_presentation",
  "generating_presentation",
  "rendering_slides",
  "validating_presentation",
  "repairing_presentation",
  "generating_documents",
  "comparing_commits",
  "composing_document",
];

/** Jobs that have not reported progress for this long are treated as abandoned by a crashed worker. */
const STALE_AFTER_MINUTES = 30;

/** Queues a generation for a workspace repository. Each generation gets its own project row. */
export async function enqueueGeneration(db: Database, target: { workspaceId: string; repositoryId: string }, request: GenerateRequest) {
  const ref = parseGitHubUrl(request.repositoryUrl);
  const url = canonicalRepoUrl(ref);
  const branch = request.branch || ref.branch;
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ workspaceId: target.workspaceId, repositoryId: target.repositoryId, name: `${ref.owner}/${ref.repo}`, description: request.purpose })
      .returning();
    const [job] = await tx
      .insert(generationJobs)
      .values({ projectId: project!.id, kind: "generate", repositoryUrl: url, branch, userPrompt: request.purpose, options: { ...request, repositoryUrl: url, branch } })
      .returning();
    return job!;
  });
}

/** Queues a handbook, commit comparison or implementation brief for a workspace repository. */
export async function enqueueDocumentJob(
  db: Database,
  target: { workspaceId: string; repositoryId: string },
  job: { kind: Exclude<JobKind, "generate" | "revise">; repositoryUrl: string; branch?: string | null; prompt: string; options: Record<string, unknown>; projectName: string },
) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ workspaceId: target.workspaceId, repositoryId: target.repositoryId, name: job.projectName, description: job.prompt.slice(0, 300) })
      .returning();
    const [row] = await tx
      .insert(generationJobs)
      .values({ projectId: project!.id, kind: job.kind, repositoryUrl: job.repositoryUrl, branch: job.branch ?? null, userPrompt: job.prompt, options: job.options })
      .returning();
    return row!;
  });
}

export async function enqueueRevision(db: Database, deck: { id: string; projectId: string }, repositoryUrl: string, instruction: string) {
  const [job] = await db
    .insert(generationJobs)
    .values({ projectId: deck.projectId, kind: "revise", deckId: deck.id, repositoryUrl, userPrompt: instruction, options: { instruction } })
    .returning();
  return job!;
}

/** Atomically claims the oldest pending job. Safe with several workers (SKIP LOCKED). */
export async function claimNextJob(db: Database) {
  const result = await db.execute(sql`
    UPDATE generation_jobs SET status = 'analyzing_repository', started_at = now(), locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM generation_jobs WHERE status = 'pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id`);
  const id = rowsOf<{ id: string }>(result)[0]?.id;
  if (!id) return undefined;
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, id));
  return job;
}

/** Marks jobs left mid-flight by a crashed worker as failed, so the UI never spins forever. */
export async function failStaleJobs(db: Database) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
  return db
    .update(generationJobs)
    .set({ status: "failed", errorMessage: "The worker stopped before this job finished. Please retry.", completedAt: new Date() })
    .where(and(inArray(generationJobs.status, ACTIVE_STATUSES), lt(generationJobs.lockedAt, cutoff)))
    .returning({ id: generationJobs.id });
}
