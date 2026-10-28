import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";
import { createWorkspace, createWorkspaceSchema, listWorkspaces } from "@/lib/workspaces/service";

/** GET /api/workspaces — the signed-in user's workspaces with their repositories. */
export async function GET() {
  try {
    const user = await requireUser();
    return ok(await listWorkspaces(getDb(), user.id));
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/workspaces — create a blank workspace, or one seeded by importing a GitHub repo. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const input = createWorkspaceSchema.parse(await req.json());
    const ws = await createWorkspace(getDb(), user.id, input);
    return ok({ id: ws.id }, 201);
  } catch (err) {
    return handleError(err);
  }
}
