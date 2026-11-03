import { requireUser } from "@/lib/auth/current";
import { env } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { transcribe, TranscribeError } from "@/lib/voice/transcribe";
import { getWorkspace } from "@/lib/workspaces/service";

export const maxDuration = 120;

const MAX_BODY = 33 * 1024 * 1024;

// Live dictation sends a segment every few seconds; the workspace's names are looked up once a minute.
const KEYWORD_TTL_MS = 60_000;
const keywordCache = new Map<string, { at: number; words: string[] }>();

async function workspaceKeywords(userId: string, workspaceId: string): Promise<string[]> {
  const key = `${userId}:${workspaceId}`;
  const hit = keywordCache.get(key);
  if (hit && Date.now() - hit.at < KEYWORD_TTL_MS) return hit.words;
  const ws = await getWorkspace(getDb(), userId, workspaceId).catch(() => null);
  const words = ws ? [ws.name, ...ws.repositories.flatMap((r) => [r.name, r.fullName.split("/")[0] ?? ""])] : [];
  if (keywordCache.size > 500) keywordCache.clear();
  keywordCache.set(key, { at: Date.now(), words });
  return words;
}

/**
 * POST /api/transcribe — dictation. Multipart form with `audio` (WAV; the browser converts its
 * recording to mono 24 kHz WAV) and optional `workspaceId`, whose repository names are sent as
 * keywords so names like "memora" or "pingie" are recognised. Returns { text, seconds }.
 * Audio is forwarded to the model API and never stored.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!env().MODEL_API_KEY) return fail(503, "not_configured", "Voice input needs the model API key on the server.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "too_large", "The recording is too large to transcribe.");
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!form || !(audio instanceof File)) return fail(400, "invalid_request", "Send the recording as multipart form data in the `audio` field.");
    const workspaceId = String(form.get("workspaceId") ?? "");
    const keywords = ["GitFill", ...(isUuid(workspaceId) ? await workspaceKeywords(user.id, workspaceId) : [])];
    const result = await transcribe(new Uint8Array(await audio.arrayBuffer()), { keywords });
    return ok(result);
  } catch (err) {
    if (err instanceof TranscribeError) return fail(err.status, "transcription_failed", err.message);
    return handleError(err);
  }
}
