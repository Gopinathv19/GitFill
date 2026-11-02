import { describe, expect, it } from "vitest";
import { applyRevision, revisionStepsSchema } from "@/lib/agent/planner";
import { sampleDeck } from "../fixtures/sample-deck";

const empty = { id: null, after: null, layout: null, section: null, title: null, change: null, theme: null };

describe("revision steps", () => {
  it("accepts flat operations with unused fields set to null", () => {
    const parsed = revisionStepsSchema.parse({ summary: "Shorter title.", operations: [{ ...empty, op: "replace", id: "s2", change: "Shorten the title." }, { ...empty, op: "hide_commit" }] });
    expect(parsed.operations.map((o) => o.op)).toEqual(["replace", "hide_commit"]);
  });

  it("names the fields an operation is missing", () => {
    const result = revisionStepsSchema.safeParse({ summary: "x", operations: [{ ...empty, op: "insert", after: "s1" }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.at(-1))).toEqual(["layout", "title", "change"]);
  });

  it("allows an empty plan when nothing can carry out the request", () => {
    expect(revisionStepsSchema.parse({ summary: "Not in the deck.", operations: [] }).operations).toEqual([]);
  });
});

describe("applyRevision", () => {
  it("hides and shows the commit without touching slides", () => {
    const spec = sampleDeck;
    expect(spec.showCommit).toBe(true);
    const hidden = applyRevision(spec, { summary: "", operations: [{ op: "hide_commit" }] });
    expect(hidden.spec.showCommit).toBe(false);
    expect(hidden.spec.slides).toEqual(spec.slides);
    expect(hidden.changedIds).toEqual([]);
    expect(applyRevision(hidden.spec, { summary: "", operations: [{ op: "show_commit" }] }).spec.showCommit).toBe(true);
  });
});
