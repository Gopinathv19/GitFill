import { describe, expect, it } from "vitest";
import type { Claim } from "@/lib/evidence/evidence";
import { cite, diagramBlock, footnotes, location, makeRenderContext } from "@/lib/understanding/render";

const snapshot = { connector: "github", sourceUrl: "https://github.com/acme/app", version: "0123456789abcdef0123456789abcdef01234567" };
const claim: Claim = { ref: "C1", claim: "The `router` dispatches requests.", claimType: "architecture", filePath: "src/router.ts", startLine: 10, endLine: 12, excerpt: "", status: "verified", note: "" };

describe("render helpers", () => {
  it("cites known refs as footnotes linked to GitHub at the commit", () => {
    const ctx = makeRenderContext([{ snapshot, claims: [claim] }]);
    expect(cite(["C1", "C9"], ctx)).toBe("[^C1]");
    const notes = footnotes(ctx);
    expect(notes).toContain("[^C1]: **Verified** · [src/router.ts:10-12](https://github.com/acme/app/blob/0123456789abcdef0123456789abcdef01234567/src/router.ts#L10-L12)");
    expect(location("src/x.ts:4", ctx)).toContain("#L4)");
  });

  it("renders diagrams with sources and skips empty ones", () => {
    const ctx = makeRenderContext([{ snapshot, claims: [] }]);
    const block = diagramBlock({ kind: "component", title: "Arch", nodes: [{ id: "a", label: "API", path: "src/api.ts" }], edges: [{ from: "a", to: "zzz" }] }, ctx);
    expect(block).toContain("```mermaid");
    expect(block).toContain("Diagram sources");
    expect(ctx.diagramIssues).toHaveLength(1);
    expect(diagramBlock(undefined, ctx)).toBe("");
  });
});
