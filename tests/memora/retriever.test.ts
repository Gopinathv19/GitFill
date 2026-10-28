import { describe, expect, it } from "vitest";
import { bundleSnapshot, toPassage } from "@/lib/memora/retriever";

describe("Memora bundles", () => {
  it("bundles files under numbered headings with line numbers and maps chunks back", () => {
    const bundles = bundleSnapshot({
      displayName: "acme/app",
      version: "0123456789abcdef0123456789abcdef01234567",
      files: [
        { path: "src/b.ts", content: "const b = 2;\nexport { b };", category: "source", sizeBytes: 20, lineCount: 2 },
        { path: "src/a.ts", content: "const a = 1;", category: "source", sizeBytes: 12, lineCount: 1 },
      ],
    });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.filename).toBe("acme-app-0123456-part1.md");
    expect(bundles[0]!.markdown).toContain("## 1. src/a.ts");
    expect(bundles[0]!.markdown).toContain("## 2. src/b.ts");
    expect(bundles[0]!.markdown).toContain("   2| export { b };");

    const passage = toPassage({ chunk_id: "c", source_id: "s", subject_id: "j", content: "File `src/b.ts` (source, 2 lines).\n\n```\n   1| const b = 2;\n   2| export { b };\n```", content_type: "code", section_path: ["acme/app @ 0123456 (part 1)", "2. src/b.ts"], token_count: 10, similarity: 0.8, rerank_score: 0.9 });
    expect(passage).toMatchObject({ path: "src/b.ts", startLine: 1, endLine: 2, score: 0.9 });
  });

  it("splits very large files and multiple bundles", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const bundles = bundleSnapshot({ displayName: "x/y", version: "abc", files: [{ path: "big.ts", content: big, category: "source", sizeBytes: big.length, lineCount: 20_000 }] });
    expect(bundles.length).toBeGreaterThan(1);
    expect(bundles.every((b) => b.markdown.length < 100_000)).toBe(true);
  });
});
