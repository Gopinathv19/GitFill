/**
 * WAV handling for Muse Voice Transcribe, which accepts only mono 16-bit PCM WAV at 16 or 24 kHz.
 * Browsers record WebM/Opus or MP4 and convert to WAV themselves (decodeAudioData + resampling);
 * the server parses whatever PCM WAV arrives, downmixes it to mono and resamples it to 24 kHz, so
 * any client can send any PCM WAV. Pure byte maths: no ffmpeg, safe in the browser and on the server.
 */

export const TARGET_RATE = 24_000;

export class WavError extends Error {
  override name = "WavError";
}

export interface PcmAudio {
  sampleRate: number;
  /** Mono samples in [-1, 1]. */
  samples: Float32Array;
}

/** Reads a PCM (8/16/24/32-bit integer) or 32-bit float WAV of any rate and channel count, as mono. */
export function decodeWav(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new WavError("Not a WAV file.");
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: { at: number; length: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      data = { at: body, length: Math.min(size, bytes.length - body) };
      break;
    }
    at = body + size + (size % 2);
  }
  if (!data || !channels || !sampleRate) throw new WavError("The WAV file has no audio data.");
  const isFloat = format === 3;
  if (!(format === 1 || isFloat) || (isFloat && bits !== 32) || (!isFloat && ![8, 16, 24, 32].includes(bits))) throw new WavError("Only PCM or 32-bit float WAV audio is supported.");
  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = data.at + (i * channels + c) * width;
      sum += isFloat
        ? view.getFloat32(at, true)
        : bits === 8
          ? (view.getUint8(at) - 128) / 128
          : bits === 16
            ? view.getInt16(at, true) / 32768
            : bits === 24
              ? ((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)) / 8388608)
              : view.getInt32(at, true) / 2147483648;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, samples };
}

/** Linear resampling; speech survives it well and it needs no filter tables. */
export function resample(audio: PcmAudio, rate: number): PcmAudio {
  if (audio.sampleRate === rate) return audio;
  const ratio = audio.sampleRate / rate;
  const out = new Float32Array(Math.floor(audio.samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const a = audio.samples[j] ?? 0;
    const b = audio.samples[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return { sampleRate: rate, samples: out };
}

/** Mono 16-bit PCM WAV bytes. */
export function encodeWav(audio: PcmAudio): Uint8Array {
  const n = audio.samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const write = (at: number, s: string) => [...s].forEach((ch, i) => (bytes[at + i] = ch.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, audio.samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return bytes;
}

/** Any PCM WAV → what the transcription model accepts: mono, 16-bit, 24 kHz. */
export function toTranscriptionWav(bytes: Uint8Array): { wav: Uint8Array; seconds: number } {
  const audio = resample(decodeWav(bytes), TARGET_RATE);
  return { wav: encodeWav(audio), seconds: audio.samples.length / TARGET_RATE };
}
