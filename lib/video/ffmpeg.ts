import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SceneError } from "./scene";

const run = promisify(execFile);

/** Adds the soundtrack to a rendered video: video copied as-is, audio as AAC, cut to the shorter stream. */
export async function muxAudio(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", outPath]);
  } catch (err) {
    throw new SceneError(`Adding the soundtrack failed: ${(err as { stderr?: string }).stderr?.slice(-400) ?? (err as Error).message}`);
  }
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

/** What ffprobe reads from the finished file, to verify it before it is stored. */
export async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", filePath]);
  const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  return { duration: Number(data.format?.duration ?? 0), width: video?.width ?? 0, height: video?.height ?? 0, videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null };
}
