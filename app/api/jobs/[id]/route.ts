import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { getJobView } from "@/lib/jobs/queries";
import { requireUser } from "@/lib/auth/current";
import { assertJobAccess } from "@/lib/workspaces/service";

/** GET /api/jobs/:id — job status plus every recorded agent event (tool calls, model calls, steps). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid job id.");
    const { workspaceId } = await assertJobAccess(getDb(), (await requireUser()).id, id);
    const job = await getJobView(getDb(), id);
    return job ? ok({ ...job, workspaceId }) : fail(404, "not_found", "Job not found.");
  } catch (err) {
    return handleError(err);
  }
}
