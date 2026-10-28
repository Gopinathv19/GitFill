import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { addRepository, addRepositorySchema } from "@/lib/workspaces/service";

/** POST /api/workspaces/:id/repositories — import a GitHub repo or create a new one in the workspace. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const repo = await addRepository(getDb(), user.id, id, addRepositorySchema.parse(await req.json()));
    return ok(repo, 201);
  } catch (err) {
    return handleError(err);
  }
}
