import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";
import { getPreferences, savePreferences } from "@/lib/preferences/service";

/** GET /api/preferences — the signed-in user's configuration, with defaults filled in. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await getPreferences(getDb(), user.id));
  } catch (err) {
    return handleError(err);
  }
}

/** PUT /api/preferences — replace the configuration (validated). */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    return ok(await savePreferences(getDb(), user.id, await req.json().catch(() => null)));
  } catch (err) {
    return handleError(err);
  }
}
