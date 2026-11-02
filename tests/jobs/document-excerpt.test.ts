import { describe, expect, it } from "vitest";
import { documentExcerpt } from "@/lib/jobs/queries";

describe("documentExcerpt", () => {
  it("returns the first prose paragraph as plain text, skipping headings, code and lists", () => {
    const md = [
      "# Title",
      "",
      "```mermaid\nflowchart LR\n\nA --> B\n```",
      "",
      "- a list item that is long enough to be mistaken for prose if not skipped",
      "",
      "GitFill turns a **repository** into [evidence](https://x)-backed `docs`[^C1] that cite their sources line by line.",
    ].join("\n");
    expect(documentExcerpt(md)).toBe("GitFill turns a repository into evidence-backed docs that cite their sources line by line.");
  });

  it("returns null when there is no prose", () => {
    expect(documentExcerpt("# Only a title\n\n| a | b |")).toBeNull();
  });
});
