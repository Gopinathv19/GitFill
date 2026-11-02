import { describe, expect, it } from "vitest";
import { applyRevision, revisionStepsSchema } from "@/lib/agent/planner";
import { sampleDeck } from "../fixtures/sample-deck";

const empty = { id: null, after: null, layout: null, section: null, title: null, change: null, theme: null, labels: null };

describe("revision steps", () => {
  it("accepts flat operations with unused fields set to null", () => {
    const parsed = revisionStepsSchema.parse({ summary: "Shorter title.", operations: [{ ...empty, op: "replace", id: "s2", change: "Shorten the title." }, { ...empty, op: "set_labels", labels: { header: "", footer: "evidence: acme/app", cover: [{ label: "Repository", value: "acme/app" }] } }] });
    expect(parsed.operations.map((o) => o.op)).toEqual(["replace", "set_labels"]);
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
  it("replaces the labels without touching slides", () => {
    const labels = { header: "acme/app", footer: "", cover: [{ label: "Repository", value: "acme/app" }] };
    const applied = applyRevision(sampleDeck, { summary: "", operations: [{ op: "set_labels", labels }] });
    expect(applied.spec.labels).toEqual(labels);
    expect(applied.spec.slides).toEqual(sampleDeck.slides);
    expect(applied.changedIds).toEqual([]);
  });
});
