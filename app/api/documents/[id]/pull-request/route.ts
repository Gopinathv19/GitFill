import { requireUser } from "@/lib/auth/current";
import { AppNotInstalledError } from "@/lib/connectors/github/app";
import { GitHubError } from "@/lib/connectors/github/client";
import { getDb } from "@/lib/db";
import { DeliveryError } from "@/lib/gitfill/deliver";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { openPullRequest } from "@/lib/workspaces/actions";

/**
 * POST /api/documents/:id/pull-request — opens a pull request that adds the document to the
 * repository: README.md, .gitfill/docs/ (with the index) or .gitfill/brainstorm/.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const pr = await openPullRequest(getDb(), user.id, id);
    return ok(pr, 201);
  } catch (err) {
    if (err instanceof DeliveryError) return fail(409, "cannot_deliver", err.message);
    if (err instanceof AppNotInstalledError) return fail(409, "app_not_installed", err.message, { installUrl: err.installUrl });
    if (err instanceof GitHubError) return fail(err.status === 401 ? 401 : err.status === 403 ? 403 : 502, "github", err.message);
    return handleError(err);
  }
}
