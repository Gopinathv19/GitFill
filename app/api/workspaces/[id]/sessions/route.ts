import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { createSession, listSessions } from "@/lib/workspaces/service";

/** GET /api/workspaces/:id/sessions — sessions in one workspace. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    return ok(await listSessions(getDb(), user.id, { workspaceId: id }));
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/workspaces/:id/sessions — start a new session (optionally titled after its first message). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { title } = z.object({ title: z.string().trim().max(4000).optional() }).parse(await req.json().catch(() => ({})));
    return ok(await createSession(getDb(), user.id, id, title), 201);
  } catch (err) {
    return handleError(err);
  }
}
