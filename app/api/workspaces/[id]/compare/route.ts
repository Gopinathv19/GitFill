import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { compareRequestSchema } from "@/lib/understanding/schemas";
import { ActionError, startComparison } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

const bodySchema = compareRequestSchema.partial().extend({ repositoryId: z.string().uuid() });

/** POST /api/workspaces/:id/compare — queue an architectural comparison of two commits. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { repositoryId, ...options } = bodySchema.parse(await req.json());
    const db = getDb();
    const { job, repo, request } = await startComparison(db, user.id, id, repositoryId, options);
    await addMessage(db, id, "user", `Explain what changed between ${request.base.slice(0, 12)} and ${request.head.slice(0, 12)} in ${repo.owner}/${repo.name}. ${request.focus}`);
    await addMessage(db, id, "assistant", `Comparing the two commits of ${repo.owner}/${repo.name}. Progress appears below.`, [job.id]);
    return ok({ jobId: job.id }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "invalid_request", err.message);
    return handleError(err);
  }
}
