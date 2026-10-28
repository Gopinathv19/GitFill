import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { artifactResponse } from "@/lib/artifact-response";
import { assertArtifactAccess } from "@/lib/workspaces/service";

/** GET /api/artifacts/:id[?download=1] — serves a stored artifact the user owns. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid artifact id.");
    const artifact = await assertArtifactAccess(getDb(), user.id, id);
    return artifactResponse(artifact, new URL(req.url).searchParams.get("download") === "1");
  } catch (err) {
    return handleError(err);
  }
}
