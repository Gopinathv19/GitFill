import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { reuseRequestSchema } from "@/lib/understanding/schemas";
import { ActionError, startReuseBrief } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

/** POST /api/workspaces/:id/reuse — queue an implementation brief transferring patterns between two repos. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const input = reuseRequestSchema.parse(await req.json());
    const db = getDb();
    const { job, reference, target } = await startReuseBrief(db, user.id, id, input);
    await addMessage(db, id, "user", `Reuse the ${input.reuseKinds.join(", ")} patterns of ${reference.owner}/${reference.name} in ${target.owner}/${target.name}: ${input.request}`);
    await addMessage(db, id, "assistant", `Analyzing both repositories to write the implementation brief. Progress appears below.`, [job.id]);
    return ok({ jobId: job.id }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "invalid_request", err.message);
    return handleError(err);
  }
}
