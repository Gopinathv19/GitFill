import { authMode } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { safeNext, signIn } from "@/lib/auth/current";
import { fail, handleError } from "@/lib/http";

/** POST /api/auth/stub — one-click demo sign-in for local testing. Disabled unless AUTH_MODE=stub. */
export async function POST(req: Request) {
  try {
    if (authMode() !== "stub") return fail(404, "not_found", "Stub sign-in is disabled.");
    const form = await req.formData().catch(() => null);
    const next = safeNext(form?.get("next")?.toString());
    return await signIn(
      getDb(),
      { githubId: "stub:demo", login: "demo-user", name: "Demo User", email: "demo@gitfill.local", avatarUrl: null },
      new URL(next, req.url).toString(),
    );
  } catch (err) {
    return handleError(err);
  }
}
