import { requireUser } from "@/lib/auth/current";
import { revokeApiToken } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";

/** DELETE /api/tokens/:id — revoke a token. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid token id.");
    const revoked = await revokeApiToken(getDb(), user.id, id);
    return revoked ? ok({ revoked: true }) : fail(404, "not_found", "Token not found.");
  } catch (err) {
    return handleError(err);
  }
}
