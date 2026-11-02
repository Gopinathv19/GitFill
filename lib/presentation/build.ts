import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MuseClient } from "@/lib/ai/client";
import type { RunRecorder } from "@/lib/agent/recorder";
import { renderDeckHtml as renderPages, type RenderResult } from "@/lib/render/browser";
import { checkRender, checkSpec, type SlideIssue } from "@/lib/validation/checks";
import { reviewSlidesVisually } from "@/lib/validation/visual-review";
import { renderDeckHtml } from "./html/render";
import { writePptx, type PptxMode } from "./pptx";
import { repairDeterministically, repairWithModel, type RepairAction } from "./repair";
import { slideSchema, type DeckSpec, type Slide } from "./spec";

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
  /** The final render: PDF and one PNG per slide. */
  render: RenderResult;
  report: ValidationReport;
}

export interface BuildOptions {
  spec: DeckSpec;
  /** Page header, e.g. "owner/repo · main". */
  repoLabel: string;
  /** Page footer evidence line, e.g. "owner/repo @ abc1234". */
  evidenceLabel: string;
  /** Facts always shown on the cover (repository, commit, audience). */
  coverMeta?: Array<[string, string]>;
  workDir: string;
  /** Local image paths keyed by slide id (cover art). */
  illustrations: ReadonlyMap<string, string>;
  /** Uploaded images (screenshots, logo) as data URIs keyed by asset id. */
  images?: ReadonlyMap<string, string>;
  /** native = editable PowerPoint objects (default); image = one picture per slide. */
  pptxMode?: PptxMode;
  client: MuseClient | null;
  recorder: RunRecorder;
  /** Repository evidence for repairs that need to add content. */
  evidence?: string;
  /** Limit the first visual review to these slides (revisions); undefined = all. */
  reviewSlideIds?: ReadonlySet<string>;
  maxRepairRounds?: number;
  visualReview?: boolean;
}

const REPAIRABLE_VISUAL: ReadonlySet<string> = new Set(["high", "medium"]);
const REPAIR_CONCURRENCY = 6;

/**
 * Generate → render → check → repair, bounded. Each round renders the real pages in Chromium,
 * measures overflow, empty space and diagram legibility, asks Muse Spark to review the
 * images, then repairs only the slides with defects.
 */
export async function buildValidatedDeck(opts: BuildOptions): Promise<BuildResult> {
  const maxRounds = opts.maxRepairRounds ?? 2;
  let spec = opts.spec;
  const rounds: ValidationRound[] = [];
  let reviewIds = opts.reviewSlideIds;
  let last: { render: RenderResult; issues: SlideIssue[]; scores: Record<string, number>; html: string } | undefined;
  const illustrations = await loadImages(opts.illustrations);

  for (let round = 0; round <= maxRounds; round++) {
    await opts.recorder.setStage(round === 0 ? "generating_presentation" : "repairing_presentation");
    const html = renderDeckHtml(spec, { repoLabel: opts.repoLabel, evidence: opts.evidenceLabel, coverMeta: opts.coverMeta, illustrations, images: opts.images });

    await opts.recorder.setStage("rendering_slides");
    const renderEvent = await opts.recorder.start("tool", "render_slides", { round, slides: spec.slides.length });
    let render: RenderResult;
    try {
      render = await renderPages(html, path.join(opts.workDir, `round-${round}`));
      // Slide ids in page order let a live view map this round's images to slides.
      await renderEvent.succeed({ round, pages: render.slides.length, slideIds: render.slides.map((s) => s.slideId) });
    } catch (err) {
      await renderEvent.fail(err instanceof Error ? err.message : "render failed");
      throw err;
    }

    await opts.recorder.setStage("validating_presentation");
    const checkEvent = await opts.recorder.start("tool", "check_layout", { round });
    const deterministic = [...checkSpec(spec), ...checkRender(spec, render.slides)];
    await checkEvent.succeed({
      issues: deterministic.map((i) => `${i.slideId}:${i.code}`),
      fill: Object.fromEntries(render.slides.map((s) => [s.slideId, Math.round(s.measure.fill * 100)])),
    });

    let visual: SlideIssue[] = [];
    let scores: Record<string, number> = {};
    if (opts.client && opts.visualReview !== false && (reviewIds === undefined || reviewIds.size > 0)) {
      const r = await reviewSlidesVisually({ client: opts.client, slides: spec.slides, rendered: render.slides, onlySlideIds: reviewIds, recorder: opts.recorder });
      visual = r.issues;
      scores = r.scores;
    }
    const issues = [...deterministic, ...visual];
    const roundInfo: ValidationRound = { round, issues, repairs: [], visualScores: scores };
    rounds.push(roundInfo);
    last = { render, issues, scores: { ...(last?.scores ?? {}), ...scores }, html };

    const toRepair = groupBySlide(issues.filter((i) => i.source !== "visual_review" || REPAIRABLE_VISUAL.has(i.severity)));
    if (toRepair.size === 0 || round === maxRounds) break;

    const slides = [...spec.slides];
    const repaired = new Set<string>();
    const modelJobs: Array<{ index: number; slide: Slide; issues: SlideIssue[] }> = [];
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
      } else if (opts.client) {
        modelJobs.push({ index, slide: current, issues: slideIssues });
      }
    }

    let next = 0;
    const worker = async () => {
      while (next < modelJobs.length) {
        const job = modelJobs[next++]!;
        try {
          const fixed = await repairWithModel({
            client: opts.client!,
            slide: job.slide,
            issues: job.issues,
            pngPath: render.slides[job.index]?.pngPath,
            evidence: opts.evidence,
            recorder: opts.recorder,
            deckType: spec.deckType,
          });
          slides[job.index] = fixed.slide;
          roundInfo.repairs.push(fixed.action);
          repaired.add(job.slide.id);
        } catch {
          // Recorded by repairWithModel; the issue stays unresolved and is reported.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REPAIR_CONCURRENCY, modelJobs.length) }, worker));

    if (repaired.size === 0) break;
    spec = { ...spec, slides };
    reviewIds = repaired;
  }

  const final = last!;
  const finalIds = new Set(spec.slides.map((s) => s.id));
  const unresolved = final.issues.filter((i) => i.slideId === "deck" || finalIds.has(i.slideId));
  const scoreValues = Object.entries(final.scores)
    .filter(([id]) => finalIds.has(id))
    .map(([, v]) => v);

  await opts.recorder.setStage("generating_presentation");
  const mode = opts.pptxMode ?? "native";
  const pptxEvent = await opts.recorder.start("tool", "generate_pptx", { slides: spec.slides.length, mode });
  let pptx: Buffer;
  try {
    // The editable deck is read from a fresh render of the final pages, the same HTML that was validated.
    const slides = mode === "native" ? (await renderPages(final.html, path.join(opts.workDir, "native"), { native: true, pdf: false })).slides : final.render.slides;
    pptx = await writePptx(spec, slides, mode);
    await pptxEvent.succeed({ bytes: pptx.byteLength, mode });
  } catch (err) {
    // An editable deck that cannot be built must not cost the user the deck: fall back to pictures.
    if (mode !== "native") {
      await pptxEvent.fail(err instanceof Error ? err.message : "pptx failed");
      throw err;
    }
    pptx = await writePptx(spec, final.render.slides, "image");
    await pptxEvent.succeed({ bytes: pptx.byteLength, mode: "image", fallback: err instanceof Error ? err.message.slice(0, 200) : "native export failed" });
  }

  return {
    spec,
    pptx,
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

async function loadImages(paths: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, p] of paths) {
    try {
      out.set(id, `data:image/png;base64,${(await readFile(p)).toString("base64")}`);
    } catch {
      // A missing illustration just leaves the cover without art.
    }
  }
  return out;
}

function groupBySlide(issues: SlideIssue[]): Map<string, SlideIssue[]> {
  const out = new Map<string, SlideIssue[]>();
  for (const i of issues) {
    if (i.slideId === "deck") continue;
    out.set(i.slideId, [...(out.get(i.slideId) ?? []), i]);
  }
  return out;
}
