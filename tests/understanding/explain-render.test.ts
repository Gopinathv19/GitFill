import { describe, expect, it } from "vitest";
import { EXPLAIN_PROMPT } from "@/lib/ai/prompts";
import { splitAnswer } from "@/lib/client/answer-parts";
import type { SourceFile } from "@/lib/connectors/types";
import { replaceCitations, verifyCitations } from "@/lib/evidence/citations";
import { renderExplanation, tidyProse } from "@/lib/understanding/explain";

const models: SourceFile = {
  path: "lib/ai/models.ts",
  category: "source",
  sizeBytes: 0,
  lineCount: 6,
  content: ["const STANDARD = {", '  planner: "muse-wonder-1.0",', '  analyst: "muse-spark-1.3",', "};", "export function modelFor(role) {", "  return STANDARD[role]; }"].join("\n"),
};
const files = new Map([[models.path, models]]);
const meta = { connector: "github", sourceUrl: "https://github.com/acme/app", version: "abc1234def", displayName: "acme/app", branch: "main" };

function render(body: string) {
  const { claims, refs } = verifyCitations(body, files, { refPrefix: "C", firstIndex: 1, max: 60 });
  const spec = { title: "Model routing", answer: body, claimRefs: claims.map((c) => c.ref), references: [], unverified: [], followUps: [] };
  return renderExplanation(spec, meta, claims, refs);
}

describe("explanation rendering", () => {
  const body = [
    "GitFill picks a model by **role**, not per request: a fixed table maps each role to a model `lib/ai/models.ts:1-4`.",
    "",
    "Callers ask `modelFor` for their role and get the model name back `lib/ai/models.ts:5-6`. The dev server runs on `localhost:3000`.",
  ].join("\n");

  it("shows citations as evidence markers, not file paths, in the prose", () => {
    const md = render(body);
    const prose = md.split("\n").filter((l) => !l.startsWith("[^")).join("\n");
    expect(prose).not.toContain("lib/ai/models.ts:1-4");
    expect(prose).toMatch(/to a model\[\^C1\]\./);
    // The file and lines live in the footnote; a sentence naming a checked identifier is verified.
    expect(md).toMatch(/^\[\^C1\]: \*Inferred\* · .*lib\/ai\/models\.ts:1-4/m);
    expect(md).toMatch(/^\[\^C2\]: \*\*Verified\*\* · .*lib\/ai\/models\.ts:5-6/m);
    // Code-like text that is not a file citation stays.
    expect(prose).toContain("`localhost:3000`");
    const parts = splitAnswer(md);
    expect(parts.evidence.map((e) => e.location)).toEqual(["lib/ai/models.ts:1-4", "lib/ai/models.ts:5-6"]);
  });

  it("drops citations over the cap instead of leaving raw paths, and marks missing files unverified", () => {
    const text = "Routing lives in one table `lib/ai/models.ts:1-4`.";
    const over = verifyCitations(text, files, { refPrefix: "C", firstIndex: 1, max: 0 });
    expect(tidyProse(replaceCitations(text, over.refs, (r) => `[^${r}]`, { dropUnresolved: true }))).toBe("Routing lives in one table.");
    expect(replaceCitations(text, [null], (r) => r)).toBe(text);
    const ghost = verifyCitations("It is in `lib/ai/ghost.ts:3-9`.", files, { refPrefix: "C", firstIndex: 1, max: 60 });
    expect(ghost.claims[0]?.status).toBe("unverified");
  });

  it("never edits code excerpts while tidying prose", () => {
    expect(tidyProse("a .\n```ts\nfor (i = 0 ; i < n ; i++) {}\n```\nb ,")).toBe("a.\n```ts\nfor (i = 0 ; i < n ; i++) {}\n```\nb,");
  });

  it("asks for an explanation that teaches, scaled to the question", () => {
    expect(EXPLAIN_PROMPT).toContain("Teach the idea, not the file list");
    expect(EXPLAIN_PROMPT).toContain("800-1500 words");
    expect(EXPLAIN_PROMPT).not.toContain("200-400 words");
  });
});
