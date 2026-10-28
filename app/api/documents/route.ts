import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { listDocuments } from "@/lib/jobs/queries";

const KINDS = new Set(["handbook", "commit_report", "implementation_brief", "explanation"]);

/** GET /api/documents?workspaceId=&kind= — the user's generated documents, newest first. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
    const kind = url.searchParams.get("kind") ?? undefined;
    if (workspaceId && !isUuid(workspaceId)) return fail(400, "invalid_id", "Invalid workspace id.");
    if (kind && !KINDS.has(kind)) return fail(400, "invalid_kind", "Unknown document kind.");
    return ok(await listDocuments(getDb(), user.id, { workspaceId, kind: kind as "handbook" | undefined }));
  } catch (err) {
    return handleError(err);
  }
}
