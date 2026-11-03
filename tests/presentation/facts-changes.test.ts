import { describe, expect, it } from "vitest";
import type { CommitInfo, CompareFile, CompareResult } from "@/lib/connectors/github/client";
import { changeFacts, classifyCommit, recentChangeFacts } from "@/lib/presentation/facts/changes";

const BASE = "aaaaaaa1111111111111111111111111111111111";
const HEAD = "bbbbbbb2222222222222222222222222222222222";

function commit(n: number, message: string, author: string | null = "Alice", authoredAt: string | null = `2024-05-${String(n).padStart(2, "0")}T10:00:00Z`): CommitInfo {
  return { sha: `${String(n).padStart(7, "0")}${"f".repeat(33)}`, message, authoredAt, author };
}

function file(filename: string, additions: number, deletions: number, status: CompareFile["status"] = "modified"): CompareFile {
  return { filename, status, additions, deletions };
}

function compare(over: Partial<CompareResult> = {}): CompareResult {
  const commits = over.commits ?? [commit(1, "feat: add export"), commit(2, "fix: crash on save", "Bob")];
  return {
    baseSha: BASE,
    headSha: HEAD,
    status: "ahead",
    aheadBy: commits.length,
    behindBy: 0,
    totalCommits: commits.length,
    commits,
    files: [file("lib/a/x.ts", 10, 2)],
    ...over,
  };
}

/** The lines of one headed section of the facts text. */
function sectionOf(text: string, heading: string): string[] {
  const block = text.split("\n\n").find((b) => b.startsWith(heading));
  return block ? block.split("\n").slice(1) : [];
}

describe("changeFacts", () => {
  it("heads the facts with the since-ref and short base/head shas, and counts commits with their date range", () => {
    const text = changeFacts({ since: "v1.2.0", compare: compare() });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Changes since v1.2.0 (measured from git: base aaaaaaa → head bbbbbbb):");
    expect(lines[1]).toBe("- 2 commits authored 2024-05-01 to 2024-05-02");
    expect(text).toContain("- 1 file changed, +10/−2 lines");
    expect(text).toContain("- Contributors (2): Alice (1 commit), Bob (1 commit)");
  });

  it("uses totalCommits for the count and says when GitHub listed fewer commits", () => {
    const text = changeFacts({ since: "main", compare: compare({ totalCommits: 400, aheadBy: 400 }) });
    expect(text).toContain("- 400 commits authored");
    expect(text).toContain("- GitHub listed 2 of the 400 commits; dates, contributors and messages below cover those only");
  });

  it("groups files by directory, cut to two levels, and sorts areas by lines changed", () => {
    const files = [
      file("lib/presentation/facts/changes.ts", 100, 0, "added"),
      file("lib/presentation/evidence.ts", 5, 5),
      file("lib/ai/client.ts", 40, 40),
      file("app/page.tsx", 3, 1),
      file("README.md", 1, 1),
      file("package.json", 2, 0),
      file("tests/a.test.ts", 20, 0, "added"),
    ];
    const areas = sectionOf(changeFacts({ since: "v1", compare: compare({ files }) }), "Areas changed");
    expect(areas).toEqual([
      "- lib/presentation/ — 2 files, +105/−5",
      "- lib/ai/ — 1 file, +40/−40",
      "- tests/ — 1 file, +20/−0",
      "- (root) — 2 files, +3/−1",
      "- app/ — 1 file, +3/−1",
    ]);
  });

  it("caps areas at 10 and says how many were left out", () => {
    const files = Array.from({ length: 13 }, (_, i) => file(`pkg${i}/src/f.ts`, 100 - i, 0));
    const areas = sectionOf(changeFacts({ since: "v1", compare: compare({ files }) }), "Areas changed");
    expect(areas).toHaveLength(11);
    expect(areas[0]).toBe("- pkg0/src/ — 1 file, +100/−0");
    expect(areas[10]).toBe("- …and 3 more areas");
  });

  it("lists added and removed files largest first, capped, and counts renames", () => {
    const files = [
      ...Array.from({ length: 12 }, (_, i) => file(`src/new${String(i).padStart(2, "0")}.ts`, i + 1, 0, "added")),
      file("src/old.ts", 0, 80, "removed"),
      file("src/older.ts", 0, 120, "removed"),
      { ...file("src/renamed.ts", 1, 1, "renamed"), previousFilename: "src/was.ts" },
      file("src/same.ts", 0, 0, "unchanged"),
    ];
    const text = changeFacts({ since: "v1", compare: compare({ files }) });
    const added = sectionOf(text, "Added files:");
    expect(added[0]).toBe("- src/new11.ts (+12 lines)");
    expect(added[9]).toBe("- src/new02.ts (+3 lines)");
    expect(added[10]).toBe("- …and 2 more added files");
    expect(sectionOf(text, "Removed files:")).toEqual(["- src/older.ts (−120 lines)", "- src/old.ts (−80 lines)"]);
    expect(text).toContain("- 1 file renamed");
    expect(text).toContain("- 15 files changed, +79/−201 lines");
  });

  it("says when GitHub's 300-file cap was reached", () => {
    const files = Array.from({ length: 300 }, (_, i) => file(`src/f${i}.ts`, 1, 0));
    expect(changeFacts({ since: "v1", compare: compare({ files }) })).toContain("GitHub lists at most 300 changed files and this comparison reached that cap");
    expect(changeFacts({ since: "v1", compare: compare() })).not.toContain("at most 300");
  });

  it("lists commit messages newest first, leaving merge commits out but counting them", () => {
    const commits = [
      commit(1, "feat: add export"),
      commit(2, "Merge pull request #12 from acme/export"),
      commit(3, "fix: crash on save\n\nLong body that must not appear", "Bob"),
      commit(4, "Merge branch 'main' into feature"),
    ];
    const text = changeFacts({ since: "v1", compare: compare({ commits, totalCommits: 4, aheadBy: 4 }) });
    expect(sectionOf(text, "Commit messages")).toEqual(["- 2024-05-03 0000003 fix: crash on save", "- 2024-05-01 0000001 feat: add export"]);
    expect(text).toContain("- 2 merge commits (counted, not listed below)");
    expect(text).toContain("- 4 commits authored 2024-05-01 to 2024-05-04");
    expect(text).not.toContain("Long body");
  });

  it("merges identical messages at their newest commit with a count", () => {
    const commits = [commit(1, "Fix typo"), commit(2, "Add login"), commit(3, "Fix typo"), commit(4, "Fix  typo ")];
    const messages = sectionOf(changeFacts({ since: "v1", compare: compare({ commits, totalCommits: 4, aheadBy: 4 }) }), "Commit messages");
    expect(messages).toEqual(["- 2024-05-04 0000004 Fix typo (3 commits)", "- 2024-05-02 0000002 Add login"]);
  });

  it("caps commit messages at 25", () => {
    const commits = Array.from({ length: 30 }, (_, i) => commit(i + 1, `chore: step ${i + 1}`, "Alice", "2024-05-01T00:00:00Z"));
    const messages = sectionOf(changeFacts({ since: "v1", compare: compare({ commits, totalCommits: 30, aheadBy: 30 }) }), "Commit messages");
    expect(messages).toHaveLength(26);
    expect(messages[0]).toContain("chore: step 30");
    expect(messages[25]).toBe("- …and 5 more distinct messages");
  });

  it("ranks contributors by commits and caps them at 8", () => {
    const names = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jon"];
    const commits = names.flatMap((name, i) => Array.from({ length: names.length - i }, (_, j) => commit(j + 1, `work ${name} ${j}`, name)));
    commits.push(commit(1, "anonymous", null));
    const text = changeFacts({ since: "v1", compare: compare({ commits, totalCommits: commits.length, aheadBy: commits.length }) });
    expect(text).toContain("- Contributors (10): Ann (10 commits), Ben (9 commits), Cat (8 commits), Dan (7 commits), Eve (6 commits), Fay (5 commits), Gus (4 commits), Hal (3 commits), …and 2 more");
  });

  it("breaks commits down by kind, counting only classified ones", () => {
    const commits = [
      commit(1, "feat: a"),
      commit(2, "feat(ui): b"),
      commit(3, "Fix c"),
      commit(4, "docs: d"),
      commit(5, "WIP"),
      commit(6, "Merge pull request #1 from x/y"),
    ];
    const text = changeFacts({ since: "v1", compare: compare({ commits, totalCommits: 6, aheadBy: 6 }) });
    expect(text).toContain("- By kind (from commit messages): 2 features, 1 fix, 1 docs change; 1 unclassified");
  });

  it("leaves the breakdown out when no message says its kind", () => {
    const commits = [commit(1, "WIP"), commit(2, "stuff")];
    expect(changeFacts({ since: "v1", compare: compare({ commits }) })).not.toContain("By kind");
  });

  it("says there are no new commits when head is behind or equal", () => {
    const behind = changeFacts({ since: "release", compare: compare({ status: "behind", aheadBy: 0, behindBy: 3, totalCommits: 0, commits: [], files: [] }) });
    expect(behind).toBe(
      "Changes since release (measured from git: base aaaaaaa → head bbbbbbb):\n- There are no new commits since release.\n- The head is 3 commits behind release.",
    );
    const identical = changeFacts({ since: "v2", compare: compare({ status: "identical", aheadBy: 0, totalCommits: 0, commits: [], files: [] }) });
    expect(identical).toBe("Changes since v2 (measured from git: base aaaaaaa → head bbbbbbb):\n- There are no new commits since v2.");
  });

  it("notes divergence when head is also behind the since-ref", () => {
    const text = changeFacts({ since: "main", compare: compare({ status: "diverged", behindBy: 4 }) });
    expect(text).toContain("- The head is also 4 commits behind main (the branches diverged)");
  });

  it("handles commits without dates or files without leaving empty sections", () => {
    const commits = [commit(1, "feat: a", null, null)];
    const text = changeFacts({ since: "v1", compare: compare({ commits, files: [] }) });
    expect(text).toContain("- 1 commit\n");
    expect(text).not.toContain("Contributors");
    expect(text).not.toContain("Areas changed");
    expect(text).not.toContain("Added files");
    expect(sectionOf(text, "Commit messages")).toEqual(["- undated 0000001 feat: a"]);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("keeps the calendar date of the ISO string regardless of timezone offset", () => {
    const commits = [commit(1, "feat: late", "Alice", "2024-05-01T23:30:00-07:00")];
    expect(changeFacts({ since: "v1", compare: compare({ commits }) })).toContain("authored on 2024-05-01");
  });
});

describe("recentChangeFacts", () => {
  it("returns an empty string for no commits", () => {
    expect(recentChangeFacts([], { branch: "main" })).toBe("");
  });

  it("lists commits in the given (newest-first) order with dates, authors, contributors and span", () => {
    const commits = [commit(3, "feat: add export", "Bob"), commit(2, "Merge pull request #4 from a/b"), commit(1, "fix: bug", "Alice")];
    expect(recentChangeFacts(commits, { branch: "main" })).toBe(
      [
        "Recent commits on main:",
        "- The latest 3 commits GitHub returned (not the full history), authored 2024-05-01 to 2024-05-03",
        "- Contributors (2): Alice (2 commits), Bob (1 commit)",
        "- 1 merge commit (counted, not listed below)",
        "",
        "Commit messages (newest first):",
        "- 2024-05-03 0000003 feat: add export (Bob)",
        "- 2024-05-01 0000001 fix: bug (Alice)",
      ].join("\n"),
    );
  });

  it("caps the list at 20 commits", () => {
    const commits = Array.from({ length: 25 }, (_, i) => commit(25 - i, `change ${25 - i}`, null));
    const lines = sectionOf(recentChangeFacts(commits, { branch: "dev" }), "Commit messages");
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe("- 2024-05-25 0000025 change 25");
    expect(lines[20]).toBe("- …and 5 more commits");
  });

  it("flattens multi-line messages and bounds their length", () => {
    const text = recentChangeFacts([commit(1, `${"x".repeat(300)}\nbody`, "A\nB")], { branch: "main" });
    const line = sectionOf(text, "Commit messages")[0]!;
    expect(line).not.toContain("body");
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(180);
    expect(text).toContain("Contributors (1): A B (1 commit)");
  });
});

describe("classifyCommit", () => {
  it.each([
    ["feat: add export", "feature"],
    ["feat(ui)!: new layout", "feature"],
    ["Feature: dark mode", "feature"],
    ["fix(api): handle 404", "fix"],
    ["hotfix: login loop", "fix"],
    ["docs: explain setup", "docs"],
    ["refactor: split module", "refactor"],
    ["test: cover parser", "test"],
    ["chore: tidy", "chore"],
    ["build: bump node", "chore"],
    ["ci: cache deps", "chore"],
    ["style: format files", "chore"],
    ["api: add retries", "feature"],
    ["Add CSV export", "feature"],
    ["Added CSV export", "feature"],
    ["Implement OAuth", "feature"],
    ["Fix crash on save", "fix"],
    ["Fixed crash on save", "fix"],
    ["Resolve race in queue", "fix"],
    ["Update docs for deploy", "docs"],
    ["Add README section", "docs"],
    ["Document the API", "docs"],
    ["Add tests for parser", "test"],
    ["Fix flaky test", "test"],
    ["Refactor storage layer", "refactor"],
    ["Rename helper", "refactor"],
    ["Clean up imports", "refactor"],
    ["Bump next to 15.1", "chore"],
    ["Update dependencies", "chore"],
    ["Release v1.2.0", "chore"],
    ["Address review comments", "other"],
    ["Fixture refresh", "other"],
    ["Update homepage copy", "other"],
    ["Merge pull request #12 from acme/x", "other"],
    ["Revert \"feat: x\"", "other"],
    ["WIP", "other"],
    ["", "other"],
  ] as const)("%s → %s", (message, kind) => {
    expect(classifyCommit(message)).toBe(kind);
  });
});

describe("adversarial inputs", () => {
  it("does not let a perf: or revert: subject decide the kind", () => {
    expect(classifyCommit("perf: add caching")).toBe("other");
    expect(classifyCommit("revert: add login")).toBe("other");
    expect(classifyCommit("Revert(auth)!: fix token refresh")).toBe("other");
  });

  it("does not merge distinct long messages that share their first 140 characters", () => {
    const prefix = "x".repeat(150);
    const commits = [commit(1, `${prefix} one`), commit(2, `${prefix} two`)];
    const lines = sectionOf(changeFacts({ since: "v1", compare: compare({ commits }) }), "Commit messages");
    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).not.toContain("(2 commits)");
    for (const line of lines) expect(line.endsWith("…")).toBe(true);
  });

  it("keeps the since-ref, branch and file names on one line each, so they cannot add fake fact lines", () => {
    const files = [file("docs/a\n- fake fact/b.md", 1, 0, "added"), file("gone\r\nfake.ts", 0, 3, "removed")];
    const text = changeFacts({ since: "v1\n- injected", compare: compare({ files }) });
    expect(text.split("\n")[0]).toBe("Changes since v1 - injected (measured from git: base aaaaaaa → head bbbbbbb):");
    expect(sectionOf(text, "Added files")).toEqual(["- docs/a - fake fact/b.md (+1 line)"]);
    expect(sectionOf(text, "Removed files")).toEqual(["- gone  fake.ts (−3 lines)"]);
    expect(sectionOf(text, "Areas changed")).toEqual(["- (root) — 1 file, +0/−3", "- docs/a - fake fact/ — 1 file, +1/−0"]);
    expect(changeFacts({ since: "v1\nx", compare: compare({ aheadBy: 0, status: "identical" }) })).not.toMatch(/\nx/);
    expect(recentChangeFacts([commit(1, "feat: a")], { branch: "main\n- fake" }).split("\n")[0]).toBe("Recent commits on main - fake:");
  });

  it("does not cut a surrogate pair in half when shortening a message", () => {
    const text = recentChangeFacts([commit(1, `${"x".repeat(138)}😀😀`)], { branch: "main" });
    expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(text).toContain(`${"x".repeat(138)}…`);
  });
});
