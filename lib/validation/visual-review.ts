import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { VISUAL_REVIEW_PROMPT } from "@/lib/ai/prompts";
import type { LaidOutSlide } from "@/lib/presentation/layouts";
import type { RenderedSlide } from "@/lib/render/renderer";
import type { RunRecorder } from "@/lib/agent/recorder";
import type { SlideIssue } from "./checks";

export const visualReviewSchema = z.object({
  score: z.number().int().min(1).max(10).describe("Overall visual quality, 10 = ready to present."),
  issues: z
    .array(
      z.object({
        category: z.enum(["crowded", "hierarchy", "alignment", "readability", "overlap", "diagram", "consistency", "composition", "empty_space"]),
        severity: z.enum(["low", "medium", "high"]),
        description: z.string().max(240),
        suggestion: z.string().max(240),
      }),
    )
    .max(6),
});

export type VisualReview = z.infer<typeof visualReviewSchema>;

/**
 * Muse Spark looks at each rendered slide image and critiques it like a designer.
 * Geometry is already covered by deterministic checks; this catches what code cannot measure.
 */
export async function reviewSlidesVisually(opts: {
  client: MuseClient;
  slides: LaidOutSlide[];
  rendered: RenderedSlide[];
  /** Restrict review to these slide ids (re-review after repair). */
  onlySlideIds?: ReadonlySet<string>;
  recorder: RunRecorder;
  concurrency?: number;
}): Promise<{ issues: SlideIssue[]; scores: Record<string, number> }> {
  const issues: SlideIssue[] = [];
  const scores: Record<string, number> = {};
  const targets = opts.slides
    .map((slide, index) => ({ slide, index, page: opts.rendered[index] }))
    .filter((t) => t.page && (!opts.onlySlideIds || opts.onlySlideIds.has(t.slide.slideId)));

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const { slide, index, page } = targets[next++]!;
      const event = await opts.recorder.start("step", "visual_review", { slide: slide.slideId, layout: slide.layout }, modelFor("reviewer"));
      try {
        const png = await readFile(page!.pngPath);
        const { data, usage } = await opts.client.structured({
          model: modelFor("reviewer"),
          purpose: `visual_review:${slide.slideId}`,
          schema: visualReviewSchema,
          schemaName: "SlideVisualReview",
          maxTokens: 1500,
          messages: [
            { role: "system", content: VISUAL_REVIEW_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: `Slide ${index + 1} of ${opts.slides.length}. Layout type: ${slide.layout}. Review the rendered image.` },
                { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
              ],
            },
          ],
        });
        await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
        scores[slide.slideId] = data.score;
        for (const i of data.issues) {
          issues.push({
            slideId: slide.slideId,
            slideIndex: index,
            source: "visual_review",
            code: `visual_${i.category}`,
            severity: i.severity,
            message: i.description,
            suggestion: i.suggestion,
          });
        }
        await event.succeed({ score: data.score, issues: data.issues.map((i) => `${i.severity}: ${i.category}`) });
      } catch (err) {
        await event.fail(err instanceof Error ? err.message : "visual review failed");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, targets.length) }, worker));
  return { issues, scores };
}
