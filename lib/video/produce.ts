import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { MuseClient } from "@/lib/ai/client";
import type { RunRecorder } from "@/lib/agent/recorder";
import type { CodeSource } from "@/lib/repo-store";
import { authorVideo, type VideoDraft } from "./author";
import { muxAudio, probe, type ProbeResult } from "./ffmpeg";
import { writeMusic } from "./music";
import { renderThumbnail, renderVideo, SceneError } from "./scene";

export interface ProducedVideo {
  draft: VideoDraft;
  mp4: Buffer;
  thumbnail: Buffer;
  probe: ProbeResult;
}

/**
 * Video pipeline: the director writes and checks the scenes, then GitFill renders every frame,
 * synthesizes the soundtrack, muxes, and verifies the finished file before it is stored.
 */
export async function produceVideo(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  brief: string;
  context: string;
  targetSeconds: number;
  source: CodeSource | null;
  workDir: string;
  onStage?: (stage: "composing" | "rendering") => Promise<void>;
}): Promise<ProducedVideo> {
  await opts.onStage?.("composing");
  const draft = await authorVideo(opts);

  await opts.onStage?.("rendering");
  const silent = path.join(opts.workDir, "silent.mp4");
  const final = path.join(opts.workDir, "video.mp4");
  const frames = Math.round(draft.duration * 30);
  const renderEvent = await opts.recorder.start("tool", "render_video", { seconds: draft.duration, frames });
  try {
    await renderVideo(draft.video, { duration: draft.duration, outPath: silent });
    await renderEvent.succeed({ frames });
  } catch (err) {
    await renderEvent.fail(err instanceof Error ? err.message : "render failed");
    throw err;
  }

  const audioEvent = await opts.recorder.start("tool", "add_soundtrack", { mood: draft.music });
  if (draft.music === "none") {
    await rm(final, { force: true });
    await import("node:fs/promises").then((fs) => fs.rename(silent, final));
    await audioEvent.succeed({ music: "none" });
  } else {
    const wav = path.join(opts.workDir, "music.wav");
    await writeMusic(draft.duration, draft.music, wav);
    await muxAudio(silent, wav, final);
    await audioEvent.succeed({ music: draft.music });
  }

  const checkEvent = await opts.recorder.start("tool", "verify_video", {});
  const info = await probe(final);
  const ok = info.videoCodec === "h264" && info.width === 1920 && info.height === 1080 && Math.abs(info.duration - draft.duration) < 1 && (draft.music === "none" || info.audioCodec === "aac");
  if (!ok) {
    await checkEvent.fail(`unexpected output: ${JSON.stringify(info)}`);
    throw new SceneError(`The rendered video failed verification: ${JSON.stringify(info)}`);
  }
  await checkEvent.succeed(info);

  const thumbPath = path.join(opts.workDir, "thumbnail.png");
  await renderThumbnail(draft.thumbnail, thumbPath);
  return { draft, mp4: await readFile(final), thumbnail: await readFile(thumbPath), probe: info };
}
