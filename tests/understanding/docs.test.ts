import { describe, expect, it } from "vitest";
import { applyDocComments } from "@/lib/understanding/docs";

describe("applyDocComments", () => {
  it("inserts comments before the right lines regardless of order", () => {
    const src = "function a() {}\nfunction b() {}\n";
    const out = applyDocComments(src, [
      { insertBeforeLine: 1, kind: "doc", text: "/** A. */" },
      { insertBeforeLine: 2, kind: "doc", text: "/** B. */" },
    ]);
    expect(out).toBe("/** A. */\nfunction a() {}\n/** B. */\nfunction b() {}\n");
  });
});
