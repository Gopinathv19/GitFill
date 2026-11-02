import { encodeWav, TARGET_RATE } from "@/lib/voice/wav";
import { ApiError } from "./api";

/**
 * Browser dictation: records the microphone with MediaRecorder (WebM/Opus in Chrome and Firefox,
 * MP4 in Safari), then decodes it, mixes it to mono and resamples it to 24 kHz with an
 * OfflineAudioContext, and encodes 16-bit WAV, the only format the transcription model takes.
 * Audio never leaves the browser except as that WAV to /api/transcribe.
 */

/** Recordings stop themselves after this long. */
export const MAX_RECORDING_SECONDS = 300;

export class VoiceError extends Error {
  override name = "VoiceError";
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof OfflineAudioContext !== "undefined";
}

export interface Recording {
  /** Stops and returns the recording as mono 24 kHz WAV. */
  stop(): Promise<Blob>;
  /** Stops and throws the audio away. */
  cancel(): void;
  /** Input level 0..1, for a meter; call from requestAnimationFrame. */
  level(): number;
  readonly startedAt: number;
}

/** Asks for the microphone and starts recording. Throws VoiceError with a message for the user. */
export async function startRecording(opts: { onAutoStop?: () => void } = {}): Promise<Recording> {
  if (!voiceSupported()) throw new VoiceError("This browser cannot record audio.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    throw new VoiceError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was blocked. Allow it for this site in the browser's address bar and try again."
        : name === "NotFoundError"
          ? "No microphone was found."
          : "The microphone could not be opened.",
    );
  }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const meter = new AudioContext();
  const analyser = meter.createAnalyser();
  analyser.fftSize = 512;
  meter.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);

  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    void meter.close().catch(() => undefined);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const timer = setTimeout(() => opts.onAutoStop?.(), MAX_RECORDING_SECONDS * 1000);
  recorder.start(1000);
  let done = false;

  return {
    startedAt: Date.now(),
    level() {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 64);
    },
    async stop() {
      if (done) throw new VoiceError("Already stopped.");
      done = true;
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      if (!blob.size) throw new VoiceError("Nothing was recorded.");
      return toWav(blob);
    },
    cancel() {
      done = true;
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}

/** Any recording the browser can decode → mono 16-bit WAV at 24 kHz. */
export async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new VoiceError("The recording could not be decoded.");
  } finally {
    void ctx.close().catch(() => undefined);
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([new Uint8Array(encodeWav({ sampleRate: TARGET_RATE, samples: rendered.getChannelData(0) }))], { type: "audio/wav" });
}

/** Sends a WAV recording to the server and returns the text. */
export async function transcribeRecording(wav: Blob, workspaceId?: string): Promise<string> {
  const form = new FormData();
  form.set("audio", wav, "dictation.wav");
  if (workspaceId) form.set("workspaceId", workspaceId);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { data?: { text: string }; error?: { code: string; message: string } };
  if (!res.ok || !body.data) throw new ApiError(body.error?.message ?? `Transcription failed (${res.status})`, body.error?.code ?? "error", res.status);
  return body.data.text;
}
