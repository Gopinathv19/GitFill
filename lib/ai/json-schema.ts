import { z } from "zod";

/**
 * Converts a Zod schema into the JSON Schema subset Muse accepts for structured output
 * and tool parameters: no oneOf/allOf (oneOf becomes anyOf), no $schema keyword.
 */
export function toModelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return rewrite(json) as Record<string, unknown>;
}

function rewrite(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewrite);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "oneOf") out.anyOf = rewrite(value);
    else if (key === "allOf" && Array.isArray(value) && value.length === 1) Object.assign(out, rewrite(value[0]));
    else out[key] = rewrite(value);
  }
  return out;
}
