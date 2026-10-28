import { z } from "zod";
import { runChatTurn } from "@/lib/agent/chat";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { addMessage, assertWorkspace, listMessages } from "@/lib/workspaces/service";

/** GET /api/workspaces/:id/chat — conversation history. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const db = getDb();
    await assertWorkspace(db, user.id, id);
    return ok(await listMessages(db, id));
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/workspaces/:id/chat — send a message; the agent replies and may start real jobs. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(await req.json());
    const db = getDb();
    await assertWorkspace(db, user.id, id);
    const userMessage = await addMessage(db, id, "user", message);
    let reply: { reply: string; jobIds: string[] };
    try {
      reply = await runChatTurn(db, user.id, id);
    } catch (err) {
      console.error("chat turn failed:", err);
      reply = { reply: "Sorry, I couldn't process that message. Please try again.", jobIds: [] };
    }
    const assistant = await addMessage(db, id, "assistant", reply.reply, reply.jobIds);
    return ok({ messages: [userMessage, assistant] });
  } catch (err) {
    return handleError(err);
  }
}
