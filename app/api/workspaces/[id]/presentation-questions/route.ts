import { z } from "zod";
import { writeDeckQuestions } from "@/lib/agent/deck-questions";
import { requireUser } from "@/lib/auth/current";
import { env } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { DECK_TYPES } from "@/lib/presentation/deck-types";
import { ActionError } from "@/lib/workspaces/actions";

export const maxDuration = 120;

const bodySchema = z.object({
  repositoryId: z.string().uuid(),
  deckType: z.enum(DECK_TYPES).default("engineering_walkthrough"),
  audience: z.string().trim().max(120).optional(),
  minutes: z.number().int().min(1).max(90).optional(),
  notes: z.string().trim().max(2000).optional(),
  mustCover: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  assetIds: z.array(z.string().uuid()).max(30).optional(),
});

/**
 * POST /api/workspaces/:id/presentation-questions — GitFill scouts the repository and returns
 * 2-4 questions grounded in its code ({ intro, questions[] }), to ask before generating a deck.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    if (!env().MODEL_API_KEY) return fail(503, "not_configured", "The model is not configured, so GitFill cannot write questions. Generate without them.");
    const body = bodySchema.parse(await req.json());
    return ok(await writeDeckQuestions(getDb(), user.id, id, body));
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    return handleError(err);
  }
}
