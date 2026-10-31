import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";
import { listSessions } from "@/lib/workspaces/service";

/** GET /api/sessions — the user's chat sessions across workspaces, most recent first. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await listSessions(getDb(), user.id));
  } catch (err) {
    return handleError(err);
  }
}
