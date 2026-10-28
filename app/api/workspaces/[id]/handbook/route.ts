import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { handbookRequestSchema } from "@/lib/understanding/schemas";
import { ActionError, startHandbook } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

const bodySchema = handbookRequestSchema.partial().extend({ repositoryId: z.string().uuid() });

/** POST /api/workspaces/:id/handbook — queue a repository, module or feature handbook. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { repositoryId, ...options } = bodySchema.parse(await req.json());
    const db = getDb();
    const { job, repo, request } = await startHandbook(db, user.id, id, repositoryId, options);
    await addMessage(db, id, "user", `Generate a ${request.audience.replace(/_/g, " ")} for ${repo.owner}/${repo.name}${request.focus ? ` (${request.scope}: ${request.focus})` : ""}. ${request.instructions}`.trim());
    await addMessage(db, id, "assistant", `Started exploring ${repo.owner}/${repo.name} for the handbook. Progress appears below.`, [job.id]);
    return ok({ jobId: job.id }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    return handleError(err);
  }
}
