import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { revisionStepsSchema } from "@/lib/agent/planner";
import { toModelJsonSchema } from "@/lib/ai/json-schema";
import { coverSlide, pageSlide } from "@/lib/presentation/spec";
import { commitReportSchema, docCommentsSchema, docsDriftSchema, explanationSpecSchema, handbookSpecSchema, implementationBriefSchema } from "@/lib/understanding/schemas";
import { visualReviewSchema } from "@/lib/validation/visual-review";

/** The model API rejects structured-output schemas nested deeper than this ("exceeds the maximum nesting depth"). */
const MAX_DEPTH = 10;

/** Nesting depth counted in object and array levels, through properties, items and anyOf branches. */
function depth(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const n = node as Record<string, unknown>;
  let inner = 0;
  for (const [key, value] of Object.entries(n)) {
    if (key === "properties" || key === "$defs") for (const child of Object.values(value as object)) inner = Math.max(inner, depth(child));
    else if (key === "items" || key === "additionalProperties") inner = Math.max(inner, depth(value));
    else if (key === "anyOf") for (const child of value as unknown[]) inner = Math.max(inner, depth(child));
  }
  return (n.type === "object" || n.type === "array" ? 1 : 0) + inner;
}

const schemas: Record<string, z.ZodType> = {
  revisionStepsSchema,
  pageSlide,
  coverSlide,
  handbookSpecSchema,
  explanationSpecSchema,
  commitReportSchema,
  implementationBriefSchema,
  docCommentsSchema,
  docsDriftSchema,
  visualReviewSchema,
};

describe("structured output schemas", () => {
  it.each(Object.entries(schemas))("%s stays within the model API's nesting limit", (_, schema) => {
    expect(depth(toModelJsonSchema(schema))).toBeLessThanOrEqual(MAX_DEPTH);
  });
});
