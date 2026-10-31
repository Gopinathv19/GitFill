import { z } from "zod";
import { runChatTurn } from "@/lib/agent/chat";
import type { LiveEvent } from "@/lib/agent/recorder";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { addMessage, assertSession } from "@/lib/workspaces/service";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const FALLBACK_REPLY = "Sorry, I couldn't process that message. Please try again.";

/**
 * POST /api/sessions/:id/messages — send a message; the agent replies and may start real jobs.
 * With `Accept: text/event-stream` the reply is streamed as Server-Sent Events:
 *   user (the stored message) → activity / text / text_reset (live progress) → done (both stored messages).
 * The turn runs to completion and is saved even if the client disconnects.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid session id.");
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(await req.json());
    const db = getDb();
    const session = await assertSession(db, user.id, id);
    const userMessage = await addMessage(db, session.workspaceId, "user", message, [], id);

    const turn = async (live?: (event: LiveEvent) => void) => {
      let reply: { reply: string; jobIds: string[] };
      try {
        reply = await runChatTurn(db, user.id, session.workspaceId, id, { live });
      } catch (err) {
        console.error("chat turn failed:", err);
        reply = { reply: FALLBACK_REPLY, jobIds: [] };
      }
      return addMessage(db, session.workspaceId, "assistant", reply.reply, reply.jobIds, id);
    };

    if (!req.headers.get("accept")?.includes("text/event-stream")) return ok({ messages: [userMessage, await turn()] });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const send = (event: string, data: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            open = false; // client went away; keep working so the answer is saved
          }
        };
        // A periodic ping keeps proxies from closing the connection while the model thinks.
        const heartbeat = setInterval(() => send("ping", {}), 15_000);
        send("user", userMessage);
        try {
          const assistant = await turn((event) => send(event.type, event));
          send("done", { messages: [userMessage, assistant] });
        } catch (err) {
          console.error("chat stream failed:", err);
          send("error", { message: FALLBACK_REPLY });
        } finally {
          clearInterval(heartbeat);
          if (open) controller.close();
        }
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        // no-transform stops response compression from buffering the stream.
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
