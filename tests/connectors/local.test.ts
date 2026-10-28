import { describe, expect, it } from "vitest";
import { snapshotFromFiles } from "@/lib/connectors/local";

describe("snapshotFromFiles", () => {
  it("applies the same filters as the GitHub connector", () => {
    const snap = snapshotFromFiles({
      name: "demo",
      files: [
        { path: "./src/index.ts", content: "export const a = 1;\n" },
        { path: ".env", content: "SECRET=1" },
        { path: "package-lock.json", content: "{}" },
        { path: "node_modules/x/index.js", content: "x" },
        { path: "README.md", content: "# Demo" },
      ],
      allPaths: ["src/other.ts"],
      branch: "main",
      version: "abc",
    });
    expect(snap.connector).toBe("local");
    expect(snap.files.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts"]);
    expect(snap.inventory.find((i) => i.path === ".env")?.selected).toBe(false);
    expect(snap.inventory.find((i) => i.path === "src/other.ts")?.skipReason).toBe("not_sent_by_client");
    expect(snap.version).toBe("abc");
  });
});
