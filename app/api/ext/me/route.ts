import { requireRequestUser } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { env } from "@/lib/config/env";
import { handleError, ok } from "@/lib/http";

/** GET /api/ext/me — verifies an API token and reports server capabilities. */
export async function GET(req: Request) {
  try {
    const user = await requireRequestUser(getDb(), req);
    return ok({ user, modelConfigured: Boolean(env().MODEL_API_KEY), capabilities: ["explain", "document", "changes", "drift"] });
  } catch (err) {
    return handleError(err);
  }
}
