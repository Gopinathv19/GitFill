import { writeFile } from "node:fs/promises";

/**
 * Original background music, synthesized here so videos carry no third-party audio: a slow pad
 * chord progression, a soft bass note per chord and a quiet bell arpeggio, with a ping-pong echo,
 * fades at both ends and peak normalization.
 */

export const MOODS = ["calm", "bright", "none"] as const;
export type Mood = (typeof MOODS)[number];

const RATE = 44_100;

/** MIDI note numbers per chord, root first. */
const PROGRESSIONS: Record<Exclude<Mood, "none">, { chords: number[][]; bpm: number; chordBeats: number }> = {
  // Am → F → C → G
  calm: { chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bpm: 84, chordBeats: 8 },
  // C → G → Am → F
  bright: { chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bpm: 104, chordBeats: 8 },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Stereo samples in [-1, 1] for the given length. */
export function synthesize(seconds: number, mood: Exclude<Mood, "none">): { left: Float32Array; right: Float32Array } {
  const { chords, bpm, chordBeats } = PROGRESSIONS[mood];
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const beat = 60 / bpm;
  const chordLen = beat * chordBeats;

  const add = (start: number, length: number, freq: number, amp: number, pan: number, env: (x: number, len: number) => number) => {
    const s0 = Math.max(0, Math.floor(start * RATE));
    const s1 = Math.min(n, Math.floor((start + length) * RATE));
    const l = amp * Math.cos((pan * Math.PI) / 4 + Math.PI / 4);
    const r = amp * Math.sin((pan * Math.PI) / 4 + Math.PI / 4);
    const w = (2 * Math.PI * freq) / RATE;
    for (let s = s0; s < s1; s++) {
      const x = (s - s0) / RATE;
      const v = Math.sin(w * (s - s0)) * env(x, length);
      left[s]! += v * l;
      right[s]! += v * r;
    }
  };
  const pad = (x: number, len: number) => Math.min(1, x / 1.2, (len - x) / 1.2);
  const pluck = (decay: number) => (x: number) => Math.min(1, x / 0.01) * Math.exp(-x / decay);

  for (let c = 0, t = 0; t < seconds; c++, t += chordLen) {
    const chord = chords[c % chords.length]!;
    for (const note of chord) {
      // Two slightly detuned voices, spread left and right, make the pad wide.
      add(t, chordLen + 0.6, hz(note) * 0.9985, 0.05, -0.7, pad);
      add(t, chordLen + 0.6, hz(note) * 1.0015, 0.05, 0.7, pad);
    }
    add(t, chordLen, hz(chord[0]! - 12), 0.12, 0, pluck(chordLen / 2.5));
    // Eighth-note arpeggio an octave up, from the second chord on.
    if (t >= chordLen) {
      const steps = chordBeats * 2;
      for (let i = 0; i < steps; i++) {
        const note = chord[[0, 1, 2, 1][i % 4]!]! + 12;
        add(t + (i * beat) / 2, 1.2, hz(note), 0.035, i % 2 ? 0.4 : -0.4, pluck(0.35));
      }
    }
  }

  // Ping-pong echo: each channel feeds the other after a dotted eighth.
  const delay = Math.round(beat * 0.75 * RATE);
  for (let s = delay; s < n; s++) {
    left[s]! += right[s - delay]! * 0.28;
    right[s]! += left[s - delay]! * 0.28;
  }

  let peak = 0;
  for (let s = 0; s < n; s++) peak = Math.max(peak, Math.abs(left[s]!), Math.abs(right[s]!));
  const gain = peak > 0 ? 0.7 / peak : 1;
  const fadeIn = 2 * RATE;
  const fadeOut = 3 * RATE;
  for (let s = 0; s < n; s++) {
    const f = Math.min(1, s / fadeIn, (n - s) / fadeOut);
    left[s]! *= gain * f;
    right[s]! *= gain * f;
  }
  return { left, right };
}

/** 16-bit stereo PCM WAV. */
export function encodeWav(left: Float32Array, right: Float32Array): Buffer {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let s = 0; s < n; s++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[s]!)) * 32767), 44 + s * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[s]!)) * 32767), 46 + s * 4);
  }
  return buf;
}

export async function writeMusic(seconds: number, mood: Exclude<Mood, "none">, outPath: string): Promise<void> {
  const { left, right } = synthesize(seconds, mood);
  await writeFile(outPath, encodeWav(left, right));
}
