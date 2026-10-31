import { describe, expect, it } from "vitest";
import { createSearchTools } from "@/lib/agent/search-tools";
import { SnapshotSource } from "@/lib/repo-store/code-source";

const file = (path: string, content: string) => ({ path, category: "source" as const, sizeBytes: content.length, content, lineCount: content.split("\n").length });
const source = new SnapshotSource({
  displayName: "acme/demo",
  version: "local",
  files: [
    file("lib/evidence.ts", "import x from 'y';\n\nexport function verifyClaim(ref: string) {\n  return ref.length > 0;\n}\n\nexport class Checker {\n  run() {}\n}\n"),
    file("lib/use.ts", "import { verifyClaim } from './evidence';\nverifyClaim('a');\n"),
  ],
  inventory: [],
});
const tools = Object.fromEntries(createSearchTools(source).map((t) => [t.name, t]));
const run = (name: string, input: unknown) => tools[name]!.run(tools[name]!.input.parse(input));

describe("search tools", () => {
  it("grep returns path:line: text and falls back to literal search for bad regexes", async () => {
    expect(await run("grep", { pattern: "verifyClaim\\(" })).toBe("lib/evidence.ts:3: export function verifyClaim(ref: string) {\nlib/use.ts:2: verifyClaim('a');");
    expect(await run("grep", { pattern: "verifyClaim(" })).toMatch(/^Note: the pattern is not a valid regular expression.*\nlib\/evidence.ts:3:/s);
    expect(await run("grep", { pattern: "nothing-here" })).toBe("No matches.");
  });

  it("read_file numbers lines and says how to continue", async () => {
    const out = await run("read_file", { path: "lib/evidence.ts", start_line: 3, end_line: 4 });
    expect(out).toBe("lib/evidence.ts (lines 3-4 of 9)\n   3| export function verifyClaim(ref: string) {\n   4|   return ref.length > 0;\n… continue with start_line=5");
    expect(await run("read_file", { path: "../secret" })).toMatch(/^Not readable/);
  });

  it("outline_file and find_definition locate declarations", async () => {
    expect(await run("outline_file", { path: "lib/evidence.ts" })).toContain("function verifyClaim [3-5] exported");
    expect(await run("find_definition", { name: "verifyClaim" })).toBe("lib/evidence.ts:3-5  export function verifyClaim(ref: string) {");
    expect(await run("list_files", { glob: "*.ts" })).toBe("lib/evidence.ts\nlib/use.ts");
  });
});
