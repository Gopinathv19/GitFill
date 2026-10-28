import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { askRequestSchema } from "@/lib/understanding/schemas";
import { ActionError, askRepository } from "@/lib/workspaces/actions";
import { addMessage } from "@/lib/workspaces/service";

export const maxDuration = 300;

const bodySchema = askRequestSchema.extend({ repositoryId: z.string().uuid(), save: z.boolean().default(false), mirrorToChat: z.boolean().default(false) });

/** POST /api/workspaces/:id/ask — answer a question about a repository, synchronously, with sources. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { repositoryId, save, mirrorToChat, ...request } = bodySchema.parse(await req.json());
    const db = getDb();
    const result = await askRepository(db, user.id, id, repositoryId, request, { save });
    if (mirrorToChat) {
      await addMessage(db, id, "user", request.question);
      await addMessage(db, id, "assistant", result.markdown);
    }
    return ok(result);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    if (err instanceof Error && ["GitHubError", "ModelError", "ToolLoopError", "StructuredOutputError"].includes(err.name)) return fail(502, "analysis_failed", publicErrorMessage(err));
    return handleError(err);
  }
}
