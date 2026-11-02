import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { videoRequestSchema } from "@/lib/validation/request";
import { ActionError, startVideo } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

/** POST /api/presentations/:id/video — queues an explainer video and thumbnail made from the deck. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid presentation id.");
    const request = videoRequestSchema.parse(await req.json());
    const db = getDb();
    const { job, deck, workspaceId } = await startVideo(db, user.id, id, request);
    await addMessage(db, workspaceId, "user", `Make a ${request.seconds}-second video of "${deck.title}"${request.instructions ? `: ${request.instructions}` : ""}`);
    await addMessage(db, workspaceId, "assistant", "Video queued. It is written, checked frame by frame, then rendered with music.", [job.id]);
    return ok({ jobId: job.id, status: job.status }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "job_in_progress", err.message);
    return handleError(err);
  }
}
