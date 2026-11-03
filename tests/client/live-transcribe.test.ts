import { describe, expect, it } from "vitest";
import { frameLevels, hasSpeech, nextCut, quietThreshold } from "@/lib/client/live-transcribe";

const RATE = 24_000;
/** Builds audio from [seconds, loud?] pieces: loud = a 220 Hz tone, quiet = faint noise. */
function audio(pieces: Array<[number, boolean]>): Float32Array {
  const out: number[] = [];
  let n = 0;
  for (const [sec, loud] of pieces) for (let i = 0; i < sec * RATE; i++, n++) out.push(loud ? 0.3 * Math.sin((2 * Math.PI * 220 * n) / RATE) : 0.002 * Math.sin(n * 12.9898));
  return Float32Array.from(out);
}
const thresholdOf = (s: Float32Array) => quietThreshold(frameLevels(s, 0, s.length));

describe("live transcription segmentation", () => {
  it("waits while the speaker is still talking", () => {
    const s = audio([[0.3, false], [1.5, true]]);
    expect(nextCut(s, 0, thresholdOf(s))).toBeNull();
  });

  it("cuts inside the last pause, never mid-word", () => {
    const s = audio([[2, true], [0.6, false], [1.5, true], [0.6, false], [0.5, true]]);
    const cut = nextCut(s, 0, thresholdOf(s))!;
    // The second pause spans 4.1 s to 4.7 s; the cut lands inside it.
    expect(cut / RATE).toBeGreaterThan(4.1);
    expect(cut / RATE).toBeLessThan(4.7);
  });

  it("does not cut so early that the segment is too short", () => {
    const s = audio([[0.4, true], [0.5, false], [1, true]]);
    expect(nextCut(s, 0, thresholdOf(s))).toBeNull();
  });

  it("forces a cut after 10 s without a pause", () => {
    const s = audio([[12, true]]);
    const cut = nextCut(s, 0, 0.01)!;
    expect(cut / RATE).toBeGreaterThanOrEqual(5);
    expect(cut / RATE).toBeLessThanOrEqual(10);
  });

  it("takes everything left on the final step", () => {
    const s = audio([[1, true]]);
    expect(nextCut(s, 0, 0.01, true)).toBe(s.length);
    expect(nextCut(s, s.length, 0.01, true)).toBeNull();
  });

  it("skips stretches that are only room noise", () => {
    const s = audio([[2, false], [1, true]]);
    const t = thresholdOf(s);
    expect(hasSpeech(s, 0, 2 * RATE, t)).toBe(false);
    expect(hasSpeech(s, 2 * RATE, s.length, t)).toBe(true);
  });
});
