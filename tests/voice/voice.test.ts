import { describe, expect, it, vi } from "vitest";
import { tidy, transcribe, TranscribeError } from "@/lib/voice/transcribe";
import { decodeWav, encodeWav, resample, toTranscriptionWav, WavError } from "@/lib/voice/wav";

/** A sine tone as WAV with the given layout, to stand in for any recording format. */
function tone(opts: { rate: number; channels: number; bits: 16 | 24 | 32; float?: boolean; seconds: number }): Uint8Array {
  const frames = Math.round(opts.rate * opts.seconds);
  const width = opts.bits / 8;
  const bytes = new Uint8Array(44 + frames * opts.channels * width);
  const v = new DataView(bytes.buffer);
  const w = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, bytes.length - 8, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, opts.float ? 3 : 1, true);
  v.setUint16(22, opts.channels, true);
  v.setUint32(24, opts.rate, true);
  v.setUint32(28, opts.rate * opts.channels * width, true);
  v.setUint16(32, opts.channels * width, true);
  v.setUint16(34, opts.bits, true);
  w(36, "data");
  v.setUint32(40, frames * opts.channels * width, true);
  for (let i = 0; i < frames; i++) {
    const s = 0.5 * Math.sin((2 * Math.PI * 440 * i) / opts.rate);
    for (let c = 0; c < opts.channels; c++) {
      const at = 44 + (i * opts.channels + c) * width;
      if (opts.float) v.setFloat32(at, s, true);
      else if (opts.bits === 16) v.setInt16(at, s * 32767, true);
      else if (opts.bits === 24) {
        const n = Math.round(s * 8388607);
        bytes[at] = n & 255;
        bytes[at + 1] = (n >> 8) & 255;
        bytes[at + 2] = (n >> 16) & 255;
      } else v.setInt32(at, s * 2147483647, true);
    }
  }
  return bytes;
}

describe("WAV for the transcription model", () => {
  it("turns any PCM or float WAV into mono 16-bit 24 kHz of the same length", () => {
    for (const layout of [
      { rate: 8000, channels: 1, bits: 16 as const },
      { rate: 44100, channels: 2, bits: 16 as const },
      { rate: 48000, channels: 2, bits: 24 as const },
      { rate: 48000, channels: 1, bits: 32 as const, float: true },
    ]) {
      const { wav, seconds } = toTranscriptionWav(tone({ ...layout, seconds: 1.5 }));
      const back = decodeWav(wav);
      expect(back.sampleRate).toBe(24000);
      expect(seconds).toBeCloseTo(1.5, 1);
      const v = new DataView(wav.buffer, wav.byteOffset);
      expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 24000, 16]);
      // The tone keeps its loudness through downmixing and resampling.
      expect(Math.max(...back.samples.slice(0, 2400).map(Math.abs))).toBeGreaterThan(0.45);
    }
  });

  it("round-trips samples and resamples linearly", () => {
    const audio = { sampleRate: 24000, samples: new Float32Array([0, 0.5, -0.5, 1, -1]) };
    const back = decodeWav(encodeWav(audio));
    expect([...back.samples].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
    expect(resample({ sampleRate: 8000, samples: new Float32Array([0, 1]) }, 16000).samples[1]).toBeCloseTo(0.5);
  });

  it("rejects what is not PCM WAV", () => {
    expect(() => decodeWav(new TextEncoder().encode("OggS not a wav file at all, just some bytes padding padding"))).toThrow(WavError);
    const adpcm = tone({ rate: 8000, channels: 1, bits: 16, seconds: 0.1 });
    new DataView(adpcm.buffer).setUint16(20, 2, true);
    expect(() => decodeWav(adpcm)).toThrow(/PCM/);
  });
});

describe("transcription request", () => {
  it("posts the multipart request Meta's ASR endpoint expects and returns tidy text", async () => {
    process.env.MODEL_API_KEY ||= "test-key";
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      const request = JSON.parse(await (form.get("request") as Blob).text());
      const audio = new Uint8Array(await (form.get("audio") as Blob).arrayBuffer());
      expect(String(url)).toMatch(/\/asr\/transcribe$/);
      expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
      expect(request).toEqual({ model: "muse-voice-transcribe-1.0", mode: "PUSH_TO_TALK", audioEncoding: "WAV", keywords: ["GitFill", "memora"], languageBias: ["en"] });
      expect(decodeWav(audio).sampleRate).toBe(24000);
      return new Response(JSON.stringify({ sessionId: "s", transcript: "how does memora retrieve facts. explain it", audioDurationMs: 2000, turns: [] }), { status: 200 });
    });
    const out = await transcribe(tone({ rate: 48000, channels: 2, bits: 16, seconds: 2 }), { keywords: ["GitFill", "memora", "GitFill", "x"], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ text: "How does memora retrieve facts. Explain it", seconds: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses empty or overlong recordings before calling the API, and explains API errors", async () => {
    process.env.MODEL_API_KEY ||= "test-key";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(transcribe(tone({ rate: 16000, channels: 1, bits: 16, seconds: 0.1 }), { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/empty/);
    await expect(transcribe(tone({ rate: 8000, channels: 1, bits: 16, seconds: 301 }), { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const err = await transcribe(tone({ rate: 16000, channels: 1, bits: 16, seconds: 1 }), { fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(TranscribeError);
    expect(err).toMatchObject({ status: 429, message: expect.stringContaining("wait a moment") });
  });

  it("capitalises sentences without changing the words", () => {
    expect(tidy("  the box was thrown.  the hogs were  fed ")).toBe("The box was thrown. The hogs were fed");
    expect(tidy("I think that that is right")).toBe("I think that that is right");
  });
});
