import { env } from "@/lib/config/env";
import type { ReasoningEffort } from "./client";

/**
 * Which Muse model does which job, and how hard it thinks. Expensive reasoning only where one
 * decision shapes the whole output; the fast model wherever a step runs in a loop; minimal
 * reasoning for reading, compressing and describing.
 *
 * Measured on the Meta Model API (Nov 2026, same prompts): muse-spark-1.3 at reasoning
 * "minimal" compressed source files 2.5-9x faster with 3-14x fewer output tokens than
 * muse-spark-1.1 or 1.2, with no invalid line ranges, and reviewed slides 3-4x faster with far
 * fewer false findings. The older Spark versions are earlier generations, not lighter models, so
 * the light tier is Spark 1.3 at minimal effort. Any role can be pointed at another model with
 * MUSE_MODEL_<ROLE> (e.g. MUSE_MODEL_READER=muse-spark-1.2) without a code change.
 */
export type ModelRole =
  /** Deck outline and interpreting revision requests: few calls, highest stakes. */
  | "planner"
  /** Composing each deck page from the outline (runs once per slide, in parallel). */
  | "composer"
  /** Repository exploration and claim extraction: many tool-loop calls. */
  | "analyst"
  /** Visual review of rendered slide images and video frames. */
  | "reviewer"
  /** Rewriting individual slides that failed validation. */
  | "repairer"
  /** README.md generation from the analysis. */
  | "writer"
  /** Cover and section artwork. */
  | "illustrator"
  /** Interactive code questions and explanations (tool loop, latency matters). */
  | "explainer"
  /** Composing handbooks and implementation briefs from gathered evidence: few calls, high stakes. */
  | "architect"
  /** Interpreting structural diffs between commits. */
  | "differ"
  /** Writing and iterating on videos and thumbnails (tool loop over HTML scenes): few calls, large outputs. */
  | "director"
  /** Reading large files once and compressing them into digests the tool loops work from. */
  | "reader"
  /** Describing an uploaded image in a sentence or two. */
  | "describer";

const STANDARD: Record<ModelRole, string> = {
  planner: "muse-wonder-1.0",
  composer: "muse-spark-1.3",
  analyst: "muse-spark-1.3",
  reviewer: "muse-spark-1.3",
  repairer: "muse-spark-1.3",
  writer: "muse-spark-1.3",
  illustrator: "muse-image-1.0",
  explainer: "muse-spark-1.3",
  architect: "muse-wonder-1.0",
  differ: "muse-spark-1.3",
  director: "muse-wonder-1.0",
  reader: "muse-spark-1.3",
  describer: "muse-spark-1.3",
};

/**
 * Default reasoning effort per role, used when a call does not set its own. Undefined leaves
 * the model's default. Hidden reasoning is billed as output and counts against max_tokens, so
 * the light roles turn it down to "minimal".
 */
const EFFORT: Partial<Record<ModelRole, ReasoningEffort>> = {
  reader: "minimal",
  describer: "minimal",
  reviewer: "minimal",
};

/** Roles allowed to drop to the contributor tier in development (never planner: it has no Wonder contributor tier). */
const CONTRIBUTOR_ELIGIBLE: ReadonlySet<ModelRole> = new Set(["analyst", "composer", "reviewer", "repairer", "writer", "explainer", "differ", "reader", "describer"]);

const OVERRIDE = /^[a-z0-9][a-z0-9.\-]{1,80}$/;

export function modelFor(role: ModelRole): string {
  const override = process.env[`MUSE_MODEL_${role.toUpperCase()}`]?.trim();
  if (override && OVERRIDE.test(override)) return override;
  if (env().MUSE_USE_CONTRIBUTOR === "true" && CONTRIBUTOR_ELIGIBLE.has(role)) {
    return `${STANDARD[role]}-contributor`;
  }
  return STANDARD[role];
}

/** The role's default reasoning effort (MUSE_EFFORT_<ROLE> overrides it). */
export function effortFor(role: ModelRole): ReasoningEffort | undefined {
  const override = process.env[`MUSE_EFFORT_${role.toUpperCase()}`]?.trim();
  if (override === "minimal" || override === "low" || override === "medium" || override === "high") return override;
  return EFFORT[role];
}
