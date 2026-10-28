import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { createApiToken, listApiTokens } from "@/lib/auth/tokens";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";

/** GET /api/tokens — the user's active API tokens (never the secrets). */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await listApiTokens(getDb(), user.id));
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/tokens — create a token for the VS Code extension. The secret is returned once. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { name } = z.object({ name: z.string().trim().min(1).max(80).default("VS Code") }).parse(await req.json().catch(() => ({})));
    return ok(await createApiToken(getDb(), user.id, name), 201);
  } catch (err) {
    return handleError(err);
  }
}
