import { authMode } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { DEMO_USER, safeNext, signIn } from "@/lib/auth/current";
import { fail, handleError, publicOrigin } from "@/lib/http";

/** POST /api/auth/stub — one-click demo sign-in for local testing. Disabled unless AUTH_MODE=stub. */
export async function POST(req: Request) {
  try {
    if (authMode() !== "stub") return fail(404, "not_found", "Stub sign-in is disabled.");
    const form = await req.formData().catch(() => null);
    const next = safeNext(form?.get("next")?.toString());
    return await signIn(
      getDb(),
      DEMO_USER,
      new URL(next, publicOrigin(req)).toString(),
    );
  } catch (err) {
    return handleError(err);
  }
}
