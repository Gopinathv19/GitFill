import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MuseClient } from "@/lib/ai/client";
import type { RunRecorder } from "@/lib/agent/recorder";
import { renderPptx, type RenderResult } from "@/lib/render/renderer";
import { checkLayout, checkRender, type SlideIssue } from "@/lib/validation/checks";
import { reviewSlidesVisually } from "@/lib/validation/visual-review";
import { layoutDeck } from "./layouts";
import { writePptx } from "./generator";
import { repairDeterministically, repairWithModel, type RepairAction } from "./repair";
import { slideSchema, type DeckSpec } from "./spec";
import { getTheme } from "./themes";

export interface ValidationRound {
  round: number;
  issues: SlideIssue[];
  repairs: RepairAction[];
  visualScores: Record<string, number>;
}

export interface ValidationReport {
  rounds: ValidationRound[];
  /** Issues still present in the final render. */
  unresolved: SlideIssue[];
  summary: { detected: number; repairsApplied: number; unresolved: number; finalAverageScore: number | null };
}

export interface BuildResult {
  spec: DeckSpec;
  pptx: Buffer;
  render: RenderResult;
  report: ValidationReport;
}

export interface BuildOptions {
  spec: DeckSpec;
  footer: string;
  workDir: string;
  illustrations: ReadonlyMap<string, string>;
  client: MuseClient | null;
  recorder: RunRecorder;
  /** Limit the first visual review to these slides (revisions); undefined = all. */
  reviewSlideIds?: ReadonlySet<string>;
  maxRepairRounds?: number;
  visualReview?: boolean;
}

const REPAIRABLE_VISUAL: ReadonlySet<string> = new Set(["high", "medium"]);

/**
 * Generate → render → check → repair, bounded. Each round renders the actual .pptx,
 * runs geometry checks and Muse Spark visual review, then applies targeted slide repairs.
 */
export async function buildValidatedDeck(opts: BuildOptions): Promise<BuildResult> {
  const maxRounds = opts.maxRepairRounds ?? 2;
  let spec = opts.spec;
  const rounds: ValidationRound[] = [];
  let reviewIds = opts.reviewSlideIds;
  let last: { pptx: Buffer; render: RenderResult; issues: SlideIssue[]; scores: Record<string, number> } | undefined;

  for (let round = 0; round <= maxRounds; round++) {
    await opts.recorder.setStage(round === 0 ? "generating_presentation" : "repairing_presentation");
    const theme = getTheme(spec.theme);
    const laid = layoutDeck(spec, theme, opts.footer, opts.illustrations);
    const layoutIssues = checkLayout(laid);

    const genEvent = await opts.recorder.start("tool", "generate_pptx", { round, slides: spec.slides.length });
    const pptx = await writePptx(laid, { title: spec.title, subject: spec.purpose });
    const roundDir = path.join(opts.workDir, `round-${round}`);
    await mkdir(roundDir, { recursive: true });
    const pptxPath = path.join(roundDir, "deck.pptx");
    await writeFile(pptxPath, pptx);
    await genEvent.succeed({ bytes: pptx.byteLength });

    await opts.recorder.setStage("rendering_slides");
    const renderEvent = await opts.recorder.start("tool", "render_slides", { round });
    let render: RenderResult;
    try {
      render = await renderPptx(pptxPath, roundDir);
      await renderEvent.succeed({ pages: render.slides.length });
    } catch (err) {
      await renderEvent.fail(err instanceof Error ? err.message : "render failed");
      throw err;
    }

    await opts.recorder.setStage("validating_presentation");
    const checkEvent = await opts.recorder.start("tool", "check_layout", { round });
    const renderIssues = checkRender(laid, render.slides);
    const deterministic = [...layoutIssues, ...renderIssues];
    await checkEvent.succeed({ issues: deterministic.map((i) => `${i.slideId}:${i.code}`) });

    let visual: SlideIssue[] = [];
    let scores: Record<string, number> = {};
    if (opts.client && opts.visualReview !== false && (reviewIds === undefined || reviewIds.size > 0)) {
      const r = await reviewSlidesVisually({ client: opts.client, slides: laid, rendered: render.slides, onlySlideIds: reviewIds, recorder: opts.recorder });
      visual = r.issues;
      scores = r.scores;
    }
    const issues = [...deterministic, ...visual];
    const roundInfo: ValidationRound = { round, issues, repairs: [], visualScores: scores };
    rounds.push(roundInfo);
    last = { pptx, render, issues, scores: { ...(last?.scores ?? {}), ...scores } };

    const toRepair = groupBySlide(issues.filter((i) => i.source !== "visual_review" || REPAIRABLE_VISUAL.has(i.severity)));
    if (toRepair.size === 0 || round === maxRounds) break;

    const repaired = new Set<string>();
    const slides = [...spec.slides];
    for (const [slideId, slideIssues] of toRepair) {
      const index = slides.findIndex((s) => s.id === slideId);
      if (index < 0) continue;
      const current = slides[index]!;
      const det = repairDeterministically(current, slideIssues);
      if (det) {
        slides[index] = slideSchema.parse(det.slide);
        roundInfo.repairs.push(det.action);
        repaired.add(slideId);
        await (await opts.recorder.start("tool", "repair_slide_rule", { slide: slideId })).succeed(det.action.description);
        continue;
      }
      if (!opts.client) continue;
      try {
        const fixed = await repairWithModel({ client: opts.client, slide: current, issues: slideIssues, pngPath: render.slides[index]?.pngPath, recorder: opts.recorder });
        slides[index] = fixed.slide;
        roundInfo.repairs.push(fixed.action);
        repaired.add(slideId);
      } catch {
        // Recorded by repairWithModel; the issue stays unresolved and is reported.
      }
    }
    if (repaired.size === 0) break;
    spec = { ...spec, slides };
    reviewIds = repaired;
  }

  const final = last!;
  const finalIds = new Set(spec.slides.map((s) => s.id));
  const unresolved = final.issues.filter((i) => i.slideId === "deck" || finalIds.has(i.slideId));
  const scoreValues = Object.entries(final.scores).filter(([id]) => finalIds.has(id)).map(([, v]) => v);
  return {
    spec,
    pptx: final.pptx,
    render: final.render,
    report: {
      rounds,
      unresolved,
      summary: {
        detected: rounds.reduce((n, r) => n + r.issues.length, 0),
        repairsApplied: rounds.reduce((n, r) => n + r.repairs.length, 0),
        unresolved: unresolved.length,
        finalAverageScore: scoreValues.length ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10 : null,
      },
    },
  };
}

function groupBySlide(issues: SlideIssue[]): Map<string, SlideIssue[]> {
  const out = new Map<string, SlideIssue[]>();
  for (const i of issues) {
    if (i.slideId === "deck") continue;
    out.set(i.slideId, [...(out.get(i.slideId) ?? []), i]);
  }
  return out;
}
