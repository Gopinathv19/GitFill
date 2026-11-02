import { modelFor } from "@/lib/ai/models";
import { env, requireEnv } from "@/lib/config/env";
import { toTranscriptionWav, WavError } from "./wav";

/**
 * Speech to text with Muse Voice Transcribe. The model is not served through chat completions:
 * it has its own file endpoint, POST {MODEL_API_BASE_URL}/asr/transcribe, taking a multipart body
 * with a JSON `request` part and the `audio` part (mono 16-bit WAV at 16 or 24 kHz, at most 10
 * minutes / 32 MB), and answering { sessionId, transcript, audioDurationMs, turns }.
 */

export class TranscribeError extends Error {
  override name = "TranscribeError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Dictation is interactive: a few minutes at most (the API allows 10). */
export const MAX_SECONDS = 300;
const MAX_WAV_BYTES = 32 * 1024 * 1024;

export interface Transcript {
  text: string;
  seconds: number;
}

/**
 * Transcribes a WAV recording. Any PCM WAV is accepted and converted to mono 24 kHz first.
 * `keywords` bias recognition toward names the user is likely to say (repositories, projects).
 */
export async function transcribe(audio: Uint8Array, opts: { keywords?: string[]; languages?: string[]; fetchImpl?: typeof fetch } = {}): Promise<Transcript> {
  let wav: Uint8Array;
  let seconds: number;
  try {
    ({ wav, seconds } = toTranscriptionWav(audio));
  } catch (err) {
    if (err instanceof WavError) throw new TranscribeError(`${err.message} Record again, or send a WAV file.`, 400);
    throw err;
  }
  if (seconds < 0.3) throw new TranscribeError("The recording is empty. Hold the mic a little longer and speak.", 400);
  if (seconds > MAX_SECONDS) throw new TranscribeError(`Recordings can be up to ${MAX_SECONDS / 60} minutes; this one is ${Math.ceil(seconds / 60)}.`, 413);
  if (wav.byteLength > MAX_WAV_BYTES) throw new TranscribeError("The recording is too large to transcribe.", 413);

  const keywords = [...new Set((opts.keywords ?? []).map((k) => k.trim()).filter((k) => k.length >= 2 && k.length <= 60))].slice(0, 50);
  const request = {
    model: modelFor("transcriber"),
    mode: "PUSH_TO_TALK",
    audioEncoding: "WAV",
    ...(keywords.length ? { keywords } : {}),
    // A language hint also gets sentence punctuation back (measured: none without it).
    languageBias: opts.languages?.length ? opts.languages : ["en"],
  };
  const form = new FormData();
  form.set("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
  form.set("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "dictation.wav");

  const res = await (opts.fetchImpl ?? fetch)(`${env().MODEL_API_BASE_URL.replace(/\/$/, "")}/asr/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("MODEL_API_KEY")}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  }).catch((err: unknown) => {
    throw new TranscribeError(err instanceof Error && err.name === "TimeoutError" ? "Transcription timed out. Try a shorter recording." : "Could not reach the transcription service.", 502);
  });
  if (!res.ok) {
    const hint: Record<number, string> = {
      400: "The transcription service could not read that recording.",
      401: "The transcription service rejected the server's model key.",
      413: "The recording is too large to transcribe.",
      429: "Too many transcriptions right now; wait a moment and try again.",
    };
    throw new TranscribeError(hint[res.status] ?? "Transcription failed; try again.", res.status === 401 ? 502 : res.status === 429 ? 429 : res.status === 413 ? 413 : res.status === 400 ? 400 : 502);
  }
  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown; audioDurationMs?: unknown };
  const text = typeof body.transcript === "string" ? tidy(body.transcript) : "";
  return { text, seconds: typeof body.audioDurationMs === "number" ? body.audioDurationMs / 1000 : seconds };
}

/** The model sometimes leaves a sentence uncapitalised after a period; the words themselves are never changed. */
export function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}
