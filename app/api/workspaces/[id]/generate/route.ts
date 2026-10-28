import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { generateRequestSchema } from "@/lib/validation/request";
import { ActionError, startPresentation } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

const bodySchema = generateRequestSchema.omit({ repositoryUrl: true }).partial().extend({ repositoryId: z.string().uuid() });

/**
 * POST /api/workspaces/:id/generate — start a presentation for a workspace repo directly
 * (no model call needed to start). The request is mirrored into the chat history.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { repositoryId, ...options } = bodySchema.parse(await req.json());
    const db = getDb();
    const { job, repo, request } = await startPresentation(db, user.id, id, repositoryId, options);
    await addMessage(db, id, "user", `Generate a ${request.slideCount}-slide presentation of ${repo.owner}/${repo.name} for ${request.audience}. ${request.instructions}`.trim());
    await addMessage(db, id, "assistant", `Started analyzing ${repo.owner}/${repo.name}. Progress appears below.`, [job.id]);
    return ok({ jobId: job.id }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    return handleError(err);
  }
}
