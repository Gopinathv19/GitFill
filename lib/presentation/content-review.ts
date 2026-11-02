import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { CONTENT_REVIEW_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import { pageBlocks, type DeckSpec } from "./spec";

export const CONTENT_FINDING_KINDS = ["coverage", "accuracy", "repetition", "naming", "audience", "story"] as const;

export const contentReviewSchema = z.object({
  findings: z
    .array(
      z.object({
        slideId: z.string().regex(/^s\d+x*$/).describe("The slide to change (for a missing topic: the slide where it fits best)."),
        kind: z.enum(CONTENT_FINDING_KINDS),
        problem: z.string().trim().min(3).max(300),
        fix: z.string().trim().min(3).max(400).describe("A concrete change the page writer can apply."),
      }),
    )
    .max(16),
  summary: z.string().max(400).default(""),
});

export type ContentReview = z.infer<typeof contentReviewSchema>;
export type ContentFinding = ContentReview["findings"][number];

/**
 * Share of a deck's factual items (cards, list items, table rows, stats, components) that cite
 * no evidence. Computed, not judged, so it is reported alongside the model's review.
 */
export function uncitedShare(spec: DeckSpec): { items: number; uncited: number } {
  let items = 0;
  let uncited = 0;
  const count = (refs: string[]) => {
    items++;
    if (!refs.length) uncited++;
  };
  for (const slide of spec.slides) {
    for (const b of pageBlocks(slide)) {
      if (b.type === "cards" || b.type === "components") b.items.forEach((i) => count(i.claimRefs));
      else if (b.type === "list" || b.type === "stats" || b.type === "steps") b.items.forEach((i) => count(i.claimRefs));
      else if (b.type === "table") b.rows.forEach((r) => count(r.claimRefs));
      else if (b.type === "explain" || b.type === "diagram") count(b.claimRefs);
    }
  }
  return { items, uncited };
}

/**
 * Muse Wonder reads the whole deck against the brief and the evidence and reports content
 * problems per slide. Findings for unknown slides are dropped. Fails soft: a failed review
 * leaves the deck as composed (the step is recorded as failed).
 */
export async function reviewDeckContent(opts: { client: MuseClient; recorder: RunRecorder; spec: DeckSpec; brief: string; evidence: string }): Promise<ContentReview> {
  const cited = uncitedShare(opts.spec);
  const event = await opts.recorder.start("step", "review_content", { slides: opts.spec.slides.length, uncitedItems: `${cited.uncited}/${cited.items}` }, modelFor("planner"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("planner"),
      purpose: "review_content",
      schema: contentReviewSchema,
      schemaName: "ContentReview",
      correctionAttempts: 1,
      reasoningEffort: "medium",
      maxTokens: 16_000,
      messages: [
        { role: "system", content: CONTENT_REVIEW_PROMPT },
        {
          role: "user",
          content: `${opts.brief}\n\nDeck specification:\n${JSON.stringify({ title: opts.spec.title, deckType: opts.spec.deckType, audience: opts.spec.audience, slides: opts.spec.slides })}\n\nFactual items without claim refs: ${cited.uncited} of ${cited.items}.\n\n${opts.evidence}`,
        },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const ids = new Set(opts.spec.slides.map((s) => s.id));
    const findings = data.findings.filter((f) => ids.has(f.slideId));
    await event.succeed({ findings: findings.map((f) => `${f.slideId}:${f.kind}`), summary: data.summary });
    return { findings, summary: data.summary };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "content review failed");
    return { findings: [], summary: "" };
  }
}
