import path from "node:path";
import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { VIDEO_AUTHOR_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { createSearchTools } from "@/lib/agent/search-tools";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import type { CodeSource } from "@/lib/repo-store";
import { MOODS, type Mood } from "./music";
import { reviewFrame } from "./review";
import { checkScene, findHolds, renderStills, renderThumbnail, saveScene, stillName, THUMBNAIL, VIDEO, type SceneCheck } from "./scene";

export interface VideoDraft {
  video: string;
  thumbnail: string;
  duration: number;
  title: string;
  summary: string;
  music: Mood;
}

/** A document the agent is writing, with what has been checked about its current text. */
interface Doc {
  html: string;
  /** Bumped on every write or edit. */
  version: number;
  /** The version the last preview rendered. */
  previewed: number;
  check: SceneCheck | null;
}

const MAX_HTML = 150_000;
const SEARCH_TOOLS = ["list_files", "grep", "read_file", "outline_file"];

/**
 * The video director: Muse Wonder writes the video and thumbnail as HTML through tools, renders
 * stills of the moments it chooses, reads the measured defects and a reviewer's critique, and edits
 * until the frames are clean. GitFill only provides the primitives; the scenes are the model's.
 */
export async function authorVideo(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  /** The request and reader brief, as text. */
  brief: string;
  /** The deck's story and the evidence behind it, as text. */
  context: string;
  targetSeconds: number;
  source: CodeSource | null;
  /** Where scenes and stills are written; stills are served to the live view from here. */
  workDir: string;
}): Promise<VideoDraft> {
  const video: Doc = { html: "", version: 0, previewed: -1, check: null };
  /** The video version whose still stretches were already reported; finishing again accepts them. */
  let holdsReported = -1;
  const thumb: Doc = { html: "", version: 0, previewed: -1, check: null };
  /** Paths relative to workDir, for the live view. */
  const rel = (p: string) => path.relative(opts.workDir, p).split(path.sep).join("/");

  const store = async (doc: Doc, html: string, kind: "video" | "thumbnail") => {
    doc.html = html;
    doc.version++;
    await saveScene(html, path.join(opts.workDir, `${kind}.html`));
    if (kind === "video") {
      doc.check = await checkScene(html);
      return {
        saved: true,
        version: doc.version,
        duration: doc.check.duration,
        problems: doc.check.problems,
        next: doc.check.problems.length ? "Fix these problems with edit_video, then preview." : "Preview the key moment of every scene with preview_video.",
      };
    }
    return { saved: true, version: doc.version, next: "Preview it with preview_thumbnail." };
  };

  const edit = (doc: Doc, i: { old_text: string; new_text: string; replace_all: boolean }) => {
    if (!doc.html) throw new Error("Nothing written yet: use the write tool first.");
    const count = doc.html.split(i.old_text).length - 1;
    if (count === 0) throw new Error("old_text was not found. Copy it exactly from the document, including whitespace.");
    if (count > 1 && !i.replace_all) throw new Error(`old_text occurs ${count} times; include more surrounding text to make it unique, or set replace_all.`);
    return i.replace_all ? doc.html.split(i.old_text).join(i.new_text) : doc.html.replace(i.old_text, () => i.new_text);
  };

  const review = async (pngPath: string, label: string, context: string) => {
    const r = await reviewFrame({ client: opts.client, recorder: opts.recorder, pngPath, label, context });
    return r ? { score: r.score, issues: r.issues.map((x) => `${x.severity} ${x.category}: ${x.description} → ${x.suggestion}`) } : { score: null, issues: ["(review unavailable)"] };
  };

  const editInput = z.object({ old_text: z.string().min(1).max(20_000), new_text: z.string().max(40_000), replace_all: z.boolean().default(false) });

  const tools = [
    ...(opts.source ? createSearchTools(opts.source).filter((t) => SEARCH_TOOLS.includes(t.name)) : []),
    defineTool({
      name: "write_video",
      description: "Write (or fully replace) the video HTML document. Returns the render-contract check.",
      input: z.object({ html: z.string().min(200).max(MAX_HTML) }),
      run: async (i) => store(video, i.html, "video"),
    }),
    defineTool({
      name: "edit_video",
      description: "Replace exact text in the video document (like a code editor's find/replace). Returns the render-contract check.",
      input: editInput,
      run: async (i) => store(video, edit(video, i), "video"),
    }),
    defineTool({
      name: "preview_video",
      description: "Render the video at up to 8 moments (seconds). For each frame: measured defects and a reviewer's score and issues.",
      input: z.object({ times: z.array(z.number().min(0).max(600)).min(1).max(8) }),
      run: async (i) => {
        if (!video.html) throw new Error("Write the video first.");
        if (!video.check?.duration) throw new Error(`Fix the render contract first: ${video.check?.problems.join(" ")}`);
        const times = [...new Set(i.times.map((t) => Math.min(t, video.check!.duration! - 0.05)))];
        const stills = await renderStills(video.html, times, path.join(opts.workDir, "stills", `v${video.version}`));
        const reviews = await Promise.all(stills.map((s) => review(s.pngPath, stillName(s.t), `Frame at t=${s.t.toFixed(1)}s of a ${video.check!.duration}s video.`)));
        video.previewed = video.version;
        return {
          version: video.version,
          stills: stills.map((s, k) => ({ t: s.t, file: rel(s.pngPath), measured: s.problems, ...reviews[k] })),
        };
      },
    }),
    defineTool({
      name: "write_thumbnail",
      description: `Write (or fully replace) the ${THUMBNAIL.width}×${THUMBNAIL.height} thumbnail HTML document.`,
      input: z.object({ html: z.string().min(100).max(60_000) }),
      run: async (i) => store(thumb, i.html, "thumbnail"),
    }),
    defineTool({
      name: "edit_thumbnail",
      description: "Replace exact text in the thumbnail document.",
      input: editInput,
      run: async (i) => store(thumb, edit(thumb, i), "thumbnail"),
    }),
    defineTool({
      name: "preview_thumbnail",
      description: "Render the thumbnail: measured defects and a reviewer's score and issues (also judged at small size).",
      input: z.object({}),
      run: async () => {
        if (!thumb.html) throw new Error("Write the thumbnail first.");
        const still = await renderThumbnail(thumb.html, path.join(opts.workDir, "stills", `thumbnail-v${thumb.version}.png`));
        const r = await review(still.pngPath, "thumbnail", `Video thumbnail, ${THUMBNAIL.width}×${THUMBNAIL.height}; it is usually shown about 320 px wide.`);
        thumb.previewed = thumb.version;
        return { version: thumb.version, stills: [{ file: rel(still.pngPath), measured: still.problems, ...r }] };
      },
    }),
    defineTool({
      name: "finish_video",
      description: "Finish once the last previews of the video and the thumbnail came after your last edits.",
      input: z.object({
        title: z.string().min(3).max(100),
        summary: z.string().min(10).max(1500).describe("The scenes with their time ranges, in one paragraph."),
        music: z.enum(MOODS),
      }),
      terminal: true,
      run: async () => {
        if (!video.check?.duration || video.check.problems.length) throw new Error(`The video still breaks the render contract: ${video.check?.problems.join(" ") || "not written"}`);
        if (video.previewed !== video.version) throw new Error("Preview the video after your last edit before finishing.");
        if (!thumb.html) throw new Error("Write and preview the thumbnail before finishing.");
        if (thumb.previewed !== thumb.version) throw new Error("Preview the thumbnail after your last edit before finishing.");
        if (holdsReported !== video.version) {
          const holds = await findHolds(video.html, video.check.duration);
          if (holds.length) {
            holdsReported = video.version;
            const list = holds.map((h) => `${h.from.toFixed(1)}–${h.to.toFixed(1)}s (${(h.to - h.from).toFixed(1)}s)`).join(", ");
            throw new Error(
              `Nothing on screen changes during ${list}: those stretches read as slides, not video. Give each one motion with purpose (stream or type text, step through items, light up a flow in sequence, count numbers up, move a cursor through a mock UI), preview, and finish again. Calling finish_video again without edits accepts the video as it is.`,
            );
          }
        }
        return { accepted: true };
      },
    }),
  ];

  const user = [
    `Target length: about ${opts.targetSeconds} seconds. Video ${VIDEO.width}×${VIDEO.height}, rendered at ${VIDEO.fps} fps.`,
    opts.brief,
    opts.context,
  ].join("\n\n");

  const { result } = await runToolLoop<{ title: string; summary: string; music: Mood }>({
    client: opts.client,
    model: modelFor("director"),
    purpose: "author_video",
    system: VIDEO_AUTHOR_PROMPT,
    messages: [{ role: "user", content: user }],
    tools,
    recorder: opts.recorder,
    maxTurns: 28,
    maxToolCalls: 70,
    // A full video document is large, and hidden reasoning counts against max_tokens too.
    maxTokens: 48_000,
    reasoningEffort: "low",
    trimHistory: { keepTurns: 4, maxChars: 260_000 },
  });
  return { video: video.html, thumbnail: thumb.html, duration: video.check!.duration!, title: result.title, summary: result.summary, music: result.music };
}
