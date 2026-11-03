import { TARGET_RATE } from "@/lib/voice/wav";
import { transcribeRecording, wavOf, type Recording } from "./voice";

/**
 * Live dictation on top of a Recording: every couple of seconds the audio so far is checked for the
 * last natural pause, and everything up to it is transcribed as one segment, so text appears phrase
 * by phrase while the user is still speaking. Cutting only at pauses keeps words whole; a long run
 * without a pause is cut at its quietest moment. Silent stretches are skipped (the model would
 * otherwise guess words). On finish only the last unsent stretch is left to transcribe.
 */

const FRAME = Math.round(TARGET_RATE * 0.05); // 50 ms analysis frames
const POLL_MS = 1000;
/** Segments in flight at once: each request takes ~2 s whatever its length, so sending them one by one falls behind. */
const PARALLEL = 3;
const MIN_SEGMENT_S = 1.2;
const MAX_SEGMENT_S = 10;
const PAUSE_FRAMES = 5; // 250 ms of quiet counts as a pause
const TAIL_GUARD_FRAMES = 4; // never cut in the last 200 ms: the speaker may be mid-word

export interface LiveTranscript {
  /** Stops listening for new segments, transcribes what is left and returns the whole text. */
  finish(): Promise<string>;
  /** Stops without transcribing the rest. */
  cancel(): void;
}

/** Frame loudness (RMS) of samples. */
export function frameLevels(samples: Float32Array, from: number, to: number): number[] {
  const out: number[] = [];
  for (let at = from; at + FRAME <= to; at += FRAME) {
    let sum = 0;
    for (let i = at; i < at + FRAME; i++) sum += samples[i]! * samples[i]!;
    out.push(Math.sqrt(sum / FRAME));
  }
  return out;
}

/** Below this a frame is quiet: a few times the recording's noise floor, never below a fixed minimum. */
export function quietThreshold(levels: number[]): number {
  if (!levels.length) return 0.01;
  const sorted = [...levels].sort((a, b) => a - b);
  return Math.max(0.008, sorted[Math.floor(sorted.length * 0.2)]! * 2.5);
}

/**
 * Where to end the next segment, as a sample index, or null to wait for more audio. `from` is
 * where the pending audio starts; `final` takes everything that is left.
 */
export function nextCut(samples: Float32Array, from: number, threshold: number, final = false): number | null {
  const end = samples.length;
  if (final) return end > from ? end : null;
  const levels = frameLevels(samples, from, end);
  const minFrames = Math.ceil((MIN_SEGMENT_S * TARGET_RATE) / FRAME);
  const maxFrames = Math.floor((MAX_SEGMENT_S * TARGET_RATE) / FRAME);
  // The latest pause that leaves a long enough segment before it and is not at the very end.
  let run = 0;
  let cut = -1;
  for (let i = 0; i < levels.length - TAIL_GUARD_FRAMES; i++) {
    run = levels[i]! < threshold ? run + 1 : 0;
    if (run >= PAUSE_FRAMES && i - Math.floor(run / 2) >= minFrames) cut = i - Math.floor(run / 2);
  }
  if (cut >= 0 && cut <= maxFrames) return from + cut * FRAME;
  if (levels.length > maxFrames) {
    // No pause for too long: cut at the quietest frame in the second half of the window.
    let best = Math.floor(maxFrames / 2);
    for (let i = best; i < maxFrames; i++) if (levels[i]! < levels[best]!) best = i;
    return from + best * FRAME;
  }
  return null;
}

/** True when a stretch has speech worth sending (not just room noise). */
export function hasSpeech(samples: Float32Array, from: number, to: number, threshold: number): boolean {
  const levels = frameLevels(samples, from, to);
  return levels.filter((l) => l >= threshold * 1.5).length >= 3;
}

export function liveTranscribe(rec: Recording, opts: { workspaceId?: string; onText: (text: string) => void }): LiveTranscript {
  // One slot per segment in spoken order; undefined while its request is still out.
  const parts: Array<string | undefined> = [];
  const pending: Array<Promise<void>> = [];
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  let committed = 0;
  let stopped = false;
  // Only the phrases up to the first one still being transcribed, so the text never jumps around.
  const shown = () => {
    const done: string[] = [];
    for (const p of parts) {
      if (p === undefined) break;
      if (p) done.push(p);
    }
    return done.join(" ").replace(/\s+/g, " ").trim();
  };
  const join = () => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const send = (samples: Float32Array, from: number, to: number, threshold: number) => {
    const index = parts.length;
    if (!hasSpeech(samples, from, to, threshold)) {
      parts.push("");
      return;
    }
    parts.push(undefined);
    const piece = samples.slice(from, to);
    pending.push(
      (async () => {
        while (inFlight >= PARALLEL) await new Promise<void>((resolve) => waiters.push(resolve));
        inFlight++;
        try {
          parts[index] = (await transcribeRecording(wavOf(piece), opts.workspaceId).catch(() => "")).trim();
        } finally {
          inFlight--;
          waiters.shift()?.();
        }
        if (!stopped) opts.onText(shown());
      })(),
    );
  };

  const step = async (final: boolean) => {
    const samples = await rec.samples();
    if (!samples) return false;
    const threshold = quietThreshold(frameLevels(samples, 0, samples.length));
    for (;;) {
      const cut = nextCut(samples, committed, threshold, final);
      if (cut === null || cut <= committed) break;
      send(samples, committed, cut, threshold);
      committed = cut;
      if (final) break;
    }
    return true;
  };

  // Checks run one at a time, so a slow decode never overlaps the next one or the final step.
  // The first second or so may not decode yet; only repeated failures mean the browser cannot
  // decode unfinished recordings, and then the whole recording is transcribed at the end instead.
  let failures = 0;
  let stepping: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (failures < 5) stepping = stepping.then(() => step(false)).then((ok) => (failures = ok ? 0 : failures + 1));
  }, POLL_MS);

  return {
    async finish() {
      clearInterval(timer);
      await stepping;
      const wav = await rec.stop();
      const decoded = await step(true);
      await Promise.all(pending);
      // A browser that cannot decode partial audio: transcribe the whole recording once, as before.
      if (!decoded && !parts.length) parts.push((await transcribeRecording(wav, opts.workspaceId)).trim());
      stopped = true;
      return join();
    },
    cancel() {
      stopped = true;
      clearInterval(timer);
      rec.cancel();
    },
  };
}
