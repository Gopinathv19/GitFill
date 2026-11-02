import { readFile } from "node:fs/promises";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { REPAIR_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import type { SlideIssue } from "@/lib/validation/checks";
import { pageBlocks, slideSchema, type Slide } from "./spec";

export interface RepairAction {
  slideId: string;
  kind: "deterministic" | "model";
  description: string;
}

/**
 * Rule-based fixes for measured defects that need no judgement. Each rule edits the slide
 * spec (never raw geometry), so the fix survives later revisions. Returns null when no
 * rule applies, and the model repair takes over.
 */
export function repairDeterministically(slide: Slide, issues: SlideIssue[]): { slide: Slide; action: RepairAction } | null {
  if (slide.layout !== "page") return null;
  const codes = new Set(issues.map((i) => i.code));
  const s = structuredClone(slide);

  // A cramped diagram gets the full page width; its column partners move below it.
  if (codes.has("diagram_small") && s.arrangement !== "stack" && s.side.length && pageBlocks(s).some((b) => b.type === "diagram")) {
    s.arrangement = "stack";
    return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Gave the diagram the full page width." } };
  }
  // Slight overflow: tighten type and spacing before rewriting anything.
  if (codes.has("overflow")) {
    const worst = Math.max(...issues.filter((i) => i.code === "overflow").map((i) => Number(/by (\d+)px/.exec(i.message)?.[1] ?? 999)));
    if (s.density === "normal" && worst <= 90) {
      s.density = "compact";
      return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Switched to compact spacing so the content fits." } };
    }
    if (s.density === "compact" && worst <= 60) {
      s.density = "tight";
      return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Switched to tight spacing so the content fits." } };
    }
  }
  return null;
}

/**
 * Muse Spark rewrites a page given its measured defects, its rendered image and the
 * repository evidence, so it can add substance to an empty page as well as cut an
 * overflowing one. Output is schema-validated.
 */
export async function repairWithModel(opts: {
  client: MuseClient;
  slide: Slide;
  issues: SlideIssue[];
  pngPath?: string;
  evidence?: string;
  recorder: RunRecorder;
}): Promise<{ slide: Slide; action: RepairAction }> {
  const { slide } = opts;
  const event = await opts.recorder.start("step", "repair_slide", { slide: slide.id, issues: opts.issues.map((i) => i.code) }, modelFor("repairer"));
  try {
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
      {
        type: "text",
        text: `Page specification:\n${JSON.stringify(slide)}\n\nDefects to fix:\n${opts.issues
          .map((i) => `- [${i.severity}] ${i.code}${i.elementId ? ` (${i.elementId})` : ""}: ${i.message}${i.suggestion ? ` Suggestion: ${i.suggestion}` : ""}`)
          .join("\n")}${opts.evidence ? `\n\n${opts.evidence}` : ""}`,
      },
    ];
    if (opts.pngPath) {
      const png = await readFile(opts.pngPath);
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } });
    }
    const schema = slideSchema.refine((s) => s.id === slide.id && s.layout === slide.layout, { message: `Slide id must stay "${slide.id}" and layout "${slide.layout}".`, path: ["id"] });
    const { data, usage } = await opts.client.structured({
      model: modelFor("repairer"),
      purpose: `repair_slide:${slide.id}`,
      schema,
      schemaName: "Slide",
      correctionAttempts: 2,
      maxTokens: 16_000,
      messages: [
        { role: "system", content: REPAIR_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    // Validation owns density; keep what the rules set.
    const fixed = data.layout === "page" && slide.layout === "page" ? { ...data, density: slide.density, section: slide.section } : data;
    const codes = new Set(opts.issues.map((i) => i.code));
    const description = codes.has("underfilled")
      ? "Added content from the evidence to fill the page."
      : codes.has("overflow")
        ? "Condensed the page so it fits."
        : codes.has("diagram_small") || codes.has("diagram_text_clipped")
          ? "Simplified the diagram so its labels are readable."
          : "Reworked the page to resolve the review findings.";
    await event.succeed({ blocks: fixed.layout === "page" ? pageBlocks(fixed).map((b) => b.type) : [] });
    return { slide: fixed, action: { slideId: slide.id, kind: "model", description } };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "repair failed");
    throw err;
  }
}
