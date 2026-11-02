import { z } from "zod";
import { writeReadmeQuestions } from "@/lib/agent/deck-questions";
import { requireUser } from "@/lib/auth/current";
import { env } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { README_TEMPLATE_IDS } from "@/lib/readme/templates";
import { ActionError } from "@/lib/workspaces/actions";

export const maxDuration = 120;

const bodySchema = z.object({
  repositoryId: z.string().uuid(),
  template: z.enum(README_TEMPLATE_IDS).default("showcase"),
  sections: z.array(z.string().max(40)).max(30).optional(),
  notes: z.string().trim().max(2000).optional(),
  hasBanner: z.boolean().optional(),
  links: z.array(z.string().max(300)).max(6).optional(),
});

/** POST /api/workspaces/:id/readme-questions — GitFill scouts the repository and asks 2-4 questions before writing the README. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    if (!env().MODEL_API_KEY) return fail(503, "not_configured", "The model is not configured, so GitFill cannot write questions. Generate without them.");
    return ok(await writeReadmeQuestions(getDb(), user.id, id, bodySchema.parse(await req.json())));
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    return handleError(err);
  }
}
