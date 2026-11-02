import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { readmeRequestSchema } from "@/lib/validation/request";
import { ActionError, startReadme } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

const bodySchema = readmeRequestSchema.partial().extend({ repositoryId: z.string().uuid() });

/** POST /api/workspaces/:id/readme — queue README.md written or updated from the code and .gitfill/assets. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { repositoryId, ...options } = bodySchema.parse(await req.json());
    const db = getDb();
    const { job, repo, request } = await startReadme(db, user.id, id, repositoryId, options);
    await addMessage(db, id, "user", `Write the README for ${repo.owner}/${repo.name}. ${request.instructions}`.trim());
    await addMessage(db, id, "assistant", `Reading ${repo.owner}/${repo.name} and its .gitfill folder to write the README. Progress appears below.`, [job.id]);
    return ok({ jobId: job.id }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    return handleError(err);
  }
}
