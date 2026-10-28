import { readFile } from "node:fs/promises";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { REPAIR_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { RunRecorder } from "@/lib/agent/recorder";
import type { SlideIssue } from "@/lib/validation/checks";
import { slideSchema, type Bullet, type Slide } from "./spec";

export interface RepairAction {
  slideId: string;
  kind: "deterministic" | "model";
  description: string;
}

const OVERFLOW_CODES = new Set(["text_dense", "text_overflow_estimated", "text_overflow_rendered", "text_too_small", "text_overlap", "render_off_slide", "out_of_bounds"]);

/**
 * Rule-based fixes for measurable defects. Each rule edits the slide spec (never raw
 * geometry), so the fix survives later revisions. Returns null when no rule applies.
 */
export function repairDeterministically(slide: Slide, issues: SlideIssue[]): { slide: Slide; action: RepairAction } | null {
  const geometric = issues.filter((i) => OVERFLOW_CODES.has(i.code));
  if (geometric.length === 0) return null;
  const s = structuredClone(slide);
  const note = (text: string) => (s.notes = s.notes ? `${s.notes}\n${text}` : text);
  const affected = new Set(geometric.map((i) => i.elementId?.replace(/^s\d+x*\./, "").replace(/\d+$/, "")));

  const trimBullets = (bullets: Bullet[], keep: number): Bullet[] => {
    const moved = bullets.slice(keep);
    if (moved.length) note(`Additional points: ${moved.map((b) => b.text).join("; ")}`);
    return bullets.slice(0, keep);
  };

  switch (s.layout) {
    case "bullets":
      if (s.bullets.length > 3) {
        const keep = s.bullets.length - 1;
        s.bullets = trimBullets(s.bullets, keep);
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: `Moved the last bullet into speaker notes (${keep} remain).` } };
      }
      if (s.keyMessage && affected.has("body")) {
        note(`Key message: ${s.keyMessage}`);
        delete s.keyMessage;
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Moved the key message into notes to give bullets more room." } };
      }
      return null;
    case "two_column":
      if (s.left.bullets.length > 3 || s.right.bullets.length > 3) {
        const max = Math.max(s.left.bullets.length, s.right.bullets.length) - 1;
        s.left.bullets = trimBullets(s.left.bullets, Math.min(s.left.bullets.length, max));
        s.right.bullets = trimBullets(s.right.bullets, Math.min(s.right.bullets.length, max));
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: `Trimmed both columns to at most ${max} bullets; the rest moved to speaker notes.` } };
      }
      return null;
    case "architecture":
      if (affected.has("caption") && s.edges.some((e) => e.label)) {
        note(`Connections: ${s.edges.filter((e) => e.label).map((e) => `${e.from} → ${e.to} (${e.label})`).join("; ")}`);
        s.edges = s.edges.map(({ from, to }) => ({ from, to }));
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Removed unreadable connector labels and listed them in speaker notes." } };
      }
      if (affected.has("label") && s.nodes.some((n) => n.detail)) {
        s.nodes = s.nodes.map((n) => ({ id: n.id, label: n.label, tier: n.tier }));
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Removed node sub-labels so node names fit." } };
      }
      return null;
    case "stack":
      if (s.groups.some((g) => g.items.some((i) => i.note))) {
        note(s.groups.flatMap((g) => g.items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`)).join("; "));
        s.groups = s.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ name: i.name, claimRefs: i.claimRefs })) }));
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Moved item notes into speaker notes." } };
      }
      return null;
    case "metrics":
      if (s.bullets.length > 1) {
        s.bullets = trimBullets(s.bullets, s.bullets.length - 1);
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Moved one supporting bullet into speaker notes." } };
      }
      return null;
    case "closing":
      if (s.bullets.length > 2) {
        s.bullets = trimBullets(s.bullets, s.bullets.length - 1);
        return { slide: s, action: { slideId: s.id, kind: "deterministic", description: "Moved one closing bullet into speaker notes." } };
      }
      return null;
    default:
      return null;
  }
}

/** Muse Spark rewrites a slide given its defects and rendered image. Output is schema-validated. */
export async function repairWithModel(opts: {
  client: MuseClient;
  slide: Slide;
  issues: SlideIssue[];
  pngPath?: string;
  recorder: RunRecorder;
}): Promise<{ slide: Slide; action: RepairAction }> {
  const { slide } = opts;
  const event = await opts.recorder.start("step", "repair_slide", { slide: slide.id, issues: opts.issues.map((i) => i.code) }, modelFor("repairer"));
  try {
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
      {
        type: "text",
        text: `Slide specification:\n${JSON.stringify(slide)}\n\nDefects to fix:\n${opts.issues
          .map((i) => `- [${i.severity}] ${i.code}: ${i.message}${i.suggestion ? ` (suggestion: ${i.suggestion})` : ""}`)
          .join("\n")}`,
      },
    ];
    if (opts.pngPath) {
      const png = await readFile(opts.pngPath);
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } });
    }
    const schema = slideSchema.refine((s) => s.id === slide.id, { message: `Slide id must stay "${slide.id}".`, path: ["id"] });
    const { data, usage } = await opts.client.structured({
      model: modelFor("repairer"),
      purpose: `repair_slide:${slide.id}`,
      schema,
      schemaName: "Slide",
      maxTokens: 4000,
      messages: [
        { role: "system", content: REPAIR_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const description = data.layout !== slide.layout ? `Rewrote slide as ${data.layout} layout.` : "Rewrote slide content to resolve the defects.";
    await event.succeed({ layout: data.layout });
    return { slide: data, action: { slideId: slide.id, kind: "model", description } };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "repair failed");
    throw err;
  }
}
