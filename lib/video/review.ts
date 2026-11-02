import { readFile } from "node:fs/promises";
import type { MuseClient } from "@/lib/ai/client";
import { effortFor, modelFor } from "@/lib/ai/models";
import { VIDEO_FRAME_REVIEW_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { visualReviewSchema, type VisualReview } from "@/lib/validation/visual-review";

/** Muse Spark critiques one rendered frame or thumbnail; null when the review itself failed. */
export async function reviewFrame(opts: { client: MuseClient; recorder: RunRecorder; pngPath: string; label: string; context: string }): Promise<VisualReview | null> {
  const event = await opts.recorder.start("step", "review_frame", { frame: opts.label }, modelFor("reviewer"));
  try {
    const png = await readFile(opts.pngPath);
    const { data, usage } = await opts.client.structured({
      model: modelFor("reviewer"),
      purpose: `review_frame:${opts.label}`,
      schema: visualReviewSchema,
      schemaName: "FrameReview",
      reasoningEffort: effortFor("reviewer"),
      maxTokens: 6000,
      messages: [
        { role: "system", content: VIDEO_FRAME_REVIEW_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `${opts.context} Review the rendered image.` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
          ],
        },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    await event.succeed({ score: data.score, issues: data.issues.map((i) => `${i.severity}: ${i.category}`) });
    return data;
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "frame review failed");
    return null;
  }
}
