import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";
import { listRecent } from "@/lib/jobs/queries";

/** GET /api/presentations — the user's recent decks and jobs across workspaces. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await listRecent(getDb(), user.id));
  } catch (err) {
    return handleError(err);
  }
}
