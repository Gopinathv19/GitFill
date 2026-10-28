import { env } from "@/lib/config/env";

/**
 * Which Muse model does which job. Expensive reasoning only where one decision shapes
 * the whole output; the fast model wherever a step runs in a loop.
 */
export type ModelRole =
  /** Deck planning and interpreting revision requests: few calls, highest stakes. */
  | "planner"
  /** Repository exploration and claim extraction: many tool-loop calls. */
  | "analyst"
  /** Visual review of rendered slide images. */
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
  | "differ";

const STANDARD: Record<ModelRole, string> = {
  planner: "muse-wonder-1.0",
  analyst: "muse-spark-1.3",
  reviewer: "muse-spark-1.3",
  repairer: "muse-spark-1.3",
  writer: "muse-spark-1.3",
  illustrator: "muse-image-1.0",
  explainer: "muse-spark-1.3",
  architect: "muse-wonder-1.0",
  differ: "muse-spark-1.3",
};

/** Roles allowed to drop to the contributor tier in development (never planner: it has no Wonder contributor tier). */
const CONTRIBUTOR_ELIGIBLE: ReadonlySet<ModelRole> = new Set(["analyst", "reviewer", "repairer", "writer", "explainer", "differ"]);

export function modelFor(role: ModelRole): string {
  if (env().MUSE_USE_CONTRIBUTOR === "true" && CONTRIBUTOR_ELIGIBLE.has(role)) {
    return `${STANDARD[role]}-contributor`;
  }
  return STANDARD[role];
}
