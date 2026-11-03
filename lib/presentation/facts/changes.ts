import type { CommitInfo, CompareFile, CompareResult } from "@/lib/connectors/github/client";

/**
 * "What changed" facts for stakeholder-update and "what's new" decks: release-notes material
 * measured from git (GitHub's compare and commit listings), so a deck can say what shipped
 * without a model inventing it. Every fact names the path, area or commit it comes from.
 */

export type CommitKind = "feature" | "fix" | "docs" | "refactor" | "test" | "chore" | "other";

/** GitHub's compare endpoint stops listing files and commits at these counts. */
const GITHUB_MAX_FILES = 300;

const MAX_CONTRIBUTORS = 8;
const MAX_AREAS = 10;
const MAX_FILE_LIST = 10;
const MAX_MESSAGES = 25;
const MAX_RECENT = 20;
const MAX_MESSAGE_CHARS = 140;

/** Commits git or GitHub generate when merging; they repeat work the other commits already show. */
const MERGE_MESSAGE = /^Merge (pull request|branch|remote-tracking branch|tag|commit)\b/;

/** Conventional-commit types, with the common aliases teams use for them. */
const CONVENTIONAL_TYPES: Record<string, CommitKind> = {
  feat: "feature",
  feature: "feature",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  docs: "docs",
  doc: "docs",
  refactor: "refactor",
  test: "test",
  tests: "test",
  chore: "chore",
  build: "chore",
  ci: "chore",
  deps: "chore",
  release: "chore",
  // Formatting-only changes: housekeeping, not a refactor of behaviour or structure.
  style: "chore",
};

/** Types that say what a commit is but not which kind above; their subject ("revert: add login") must not decide it. */
const UNCLASSIFIED_TYPES = new Set(["perf", "revert"]);

/** First words of plain-English messages ("Add export button", "Fixed crash on save"). */
const FIRST_WORD_KINDS: Array<[CommitKind, Set<string>]> = [
  ["feature", new Set(["add", "adds", "added", "adding", "implement", "implements", "implemented", "introduce", "introduces", "introduced", "create", "creates", "created", "support", "supports", "enable", "enables", "allow", "allows", "new"])],
  ["fix", new Set(["fix", "fixes", "fixed", "fixing", "resolve", "resolves", "resolved", "correct", "corrects", "corrected", "patch", "patched", "repair", "repaired", "prevent", "prevents", "bugfix", "hotfix"])],
  ["refactor", new Set(["refactor", "refactors", "refactored", "refactoring", "rename", "renames", "renamed", "restructure", "reorganize", "reorganise", "simplify", "simplifies", "simplified", "extract", "extracts", "extracted", "move", "moves", "moved", "cleanup", "clean", "tidy"])],
  ["chore", new Set(["bump", "bumps", "bumped", "upgrade", "upgrades", "upgraded", "chore", "release", "released"])],
];

const VERB = "(?:add|adds|added|update|updates|updated|improve|improves|improved|fix|fixes|fixed|write|wrote|expand|expanded|rewrite|rewrote|clarify|clarified)";
/** Checked before the first-word table so "Add docs for X" is docs, not a feature. */
const DOCS_MESSAGE = new RegExp(`^(?:${VERB}\\s+(?:the\\s+|more\\s+|missing\\s+)?(?:docs?|documentation|readme|changelog|docstrings?|comments?)\\b|(?:docs?|documentation|document|documents|documented|readme)\\b)`);
/** Checked before the first-word table so "Add tests for X" or "Fix flaky test" is test work. */
const TEST_MESSAGE = new RegExp(`^(?:${VERB}\\s+(?:(?:the|more|missing|unit|e2e|integration|failing|flaky|broken)\\s+)*tests?\\b|(?:test|tests|testing)\\b)`);
const DEPENDENCY_MESSAGE = new RegExp(`^${VERB}\\s+(?:the\\s+)?(?:dependencies|dependency|deps|packages?|lockfile|package-lock|yarn\\.lock|version)\\b`);

/**
 * The kind of change a commit message describes: a conventional-commit prefix (feat:, fix(scope):,
 * docs:, refactor:, test:, chore:/build:/ci:) or a plain-English start ("Add", "Fix", "Update docs").
 * "other" when the message does not say; callers count only classified kinds.
 */
export function classifyCommit(message: string): CommitKind {
  const text = firstLine(message);
  const conventional = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.*)$/i.exec(text);
  if (conventional) {
    const kind = CONVENTIONAL_TYPES[conventional[1]!.toLowerCase()];
    if (kind) return kind;
    if (UNCLASSIFIED_TYPES.has(conventional[1]!.toLowerCase())) return "other";
    // An unknown prefix is usually a scope ("api: add retries"); classify what follows it.
    return plainEnglishKind(conventional[2] ?? "");
  }
  return plainEnglishKind(text);
}

function plainEnglishKind(text: string): CommitKind {
  const t = text.trim().toLowerCase();
  if (DOCS_MESSAGE.test(t)) return "docs";
  if (TEST_MESSAGE.test(t)) return "test";
  if (DEPENDENCY_MESSAGE.test(t)) return "chore";
  const word = /^[a-z]+/.exec(t)?.[0] ?? "";
  for (const [kind, words] of FIRST_WORD_KINDS) if (words.has(word)) return kind;
  return "other";
}

/**
 * Release-notes facts for base...head: commit count and dates, contributors, the areas and files
 * that changed (with line counts), kinds of change and the commit messages, newest first.
 */
export function changeFacts(input: { since: string; compare: CompareResult }): string {
  const { since, compare } = input;
  const header = `Changes since ${oneLine(since)} (measured from git: base ${shortSha(compare.baseSha)} → head ${shortSha(compare.headSha)}):`;
  if (compare.status === "behind" || compare.aheadBy <= 0) {
    const behind = compare.behindBy > 0 ? `\n- The head is ${plural(compare.behindBy, "commit")} behind ${oneLine(since)}.` : "";
    return `${header}\n- There are no new commits since ${oneLine(since)}.${behind}`;
  }

  // GitHub's compare lists commits oldest first.
  const newestFirst = [...compare.commits].reverse();
  const merges = newestFirst.filter((c) => isMerge(c.message));
  const work = newestFirst.filter((c) => !isMerge(c.message));
  const files = compare.files.filter((f) => f.status !== "unchanged");
  const additions = sum(files.map((f) => f.additions));
  const deletions = sum(files.map((f) => f.deletions));
  const renamed = files.filter((f) => f.status === "renamed").length;
  const partialCommits = compare.totalCommits > compare.commits.length;

  const summary = [
    `- ${plural(compare.totalCommits, "commit")}${spanText(newestFirst, " authored ")}`,
    partialCommits ? `- GitHub listed ${compare.commits.length} of the ${compare.totalCommits} commits; dates, contributors and messages below cover those only` : "",
    compare.behindBy > 0 ? `- The head is also ${plural(compare.behindBy, "commit")} behind ${oneLine(since)} (the branches diverged)` : "",
    files.length ? `- ${plural(files.length, "file")} changed, +${additions}/−${deletions} lines` : "",
    compare.files.length >= GITHUB_MAX_FILES ? `- GitHub lists at most ${GITHUB_MAX_FILES} changed files and this comparison reached that cap, so the file figures are incomplete` : "",
    renamed ? `- ${plural(renamed, "file")} renamed` : "",
    merges.length ? `- ${plural(merges.length, "merge commit")} (counted, not listed below)` : "",
    contributorsText(newestFirst, "- "),
    kindText(work),
  ].filter(Boolean);

  return [
    `${header}\n${summary.join("\n")}`,
    section("Areas changed (files grouped by directory, cut to its top two levels; most lines changed first):", areaLines(files), "areas", MAX_AREAS),
    section("Added files:", fileLines(files, "added"), "added files", MAX_FILE_LIST),
    section("Removed files:", fileLines(files, "removed"), "removed files", MAX_FILE_LIST),
    section("Commit messages (newest first; merge commits left out, identical messages merged):", messageLines(work), "distinct messages", MAX_MESSAGES),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * For decks with no since-ref: the latest commits on a branch as GitHub's commit listing returns
 * them (newest first), with dates, contributors and the span they cover. "" when there are none.
 */
export function recentChangeFacts(commits: CommitInfo[], opts: { branch: string }): string {
  if (!commits.length) return "";
  const merges = commits.filter((c) => isMerge(c.message)).length;
  const work = commits.filter((c) => !isMerge(c.message));
  const summary = [
    `- The latest ${plural(commits.length, "commit")} GitHub returned (not the full history)${spanText(commits, ", authored ")}`,
    contributorsText(commits, "- "),
    merges ? `- ${plural(merges, "merge commit")} (counted, not listed below)` : "",
  ].filter(Boolean);
  const lines = work.map((c) => {
    const author = c.author ? oneLine(c.author) : "";
    return `- ${dateOf(c.authoredAt) ?? "undated"} ${shortSha(c.sha)} ${firstLine(c.message)}${author ? ` (${author})` : ""}`;
  });
  return [`Recent commits on ${oneLine(opts.branch)}:\n${summary.join("\n")}`, section("Commit messages (newest first):", lines, "commits", MAX_RECENT)]
    .filter(Boolean)
    .join("\n\n");
}

interface Area {
  dir: string;
  files: number;
  additions: number;
  deletions: number;
}

/** The directory an area is named after: at most two segments; files at the top level are "(root)". */
function areaOf(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  return dirs.length ? `${dirs.slice(0, 2).join("/")}/` : "(root)";
}

function areaLines(files: CompareFile[]): string[] {
  const map = new Map<string, Area>();
  for (const f of files) {
    const dir = areaOf(cleanPath(f.filename));
    const a = map.get(dir) ?? { dir, files: 0, additions: 0, deletions: 0 };
    a.files++;
    a.additions += f.additions;
    a.deletions += f.deletions;
    map.set(dir, a);
  }
  return [...map.values()]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || b.files - a.files || compareText(a.dir, b.dir))
    .map((a) => `- ${a.dir} — ${plural(a.files, "file")}, +${a.additions}/−${a.deletions}`);
}

/** Added files largest first by lines added; removed files largest first by lines deleted. */
function fileLines(files: CompareFile[], status: "added" | "removed"): string[] {
  const lines = (f: CompareFile) => (status === "added" ? f.additions : f.deletions);
  return files
    .filter((f) => f.status === status)
    .sort((a, b) => lines(b) - lines(a) || compareText(a.filename, b.filename))
    .map((f) => `- ${cleanPath(f.filename)} (${status === "added" ? "+" : "−"}${plural(lines(f), "line")})`);
}

/**
 * One line per distinct message, at its newest commit, with how many commits share it. Messages are
 * compared before they are shortened, so two long messages sharing a prefix are not merged.
 */
function messageLines(newestFirst: CommitInfo[]): string[] {
  const entries = new Map<string, { commit: CommitInfo; count: number }>();
  for (const c of newestFirst) {
    const message = collapse(c.message.split("\n")[0] ?? "");
    if (!message) continue;
    const e = entries.get(message);
    if (e) e.count++;
    else entries.set(message, { commit: c, count: 1 });
  }
  return [...entries].map(
    ([message, { commit, count }]) => `- ${dateOf(commit.authoredAt) ?? "undated"} ${shortSha(commit.sha)} ${truncate(message)}${count > 1 ? ` (${count} commits)` : ""}`,
  );
}

function contributorsText(commits: CommitInfo[], prefix: string): string {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const name = c.author ? oneLine(c.author) : "";
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!counts.size) return "";
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  const shown = ranked.slice(0, MAX_CONTRIBUTORS).map(([name, n]) => `${name} (${plural(n, "commit")})`);
  const more = ranked.length > MAX_CONTRIBUTORS ? `, …and ${ranked.length - MAX_CONTRIBUTORS} more` : "";
  return `${prefix}Contributors (${ranked.length}): ${shown.join(", ")}${more}`;
}

const KIND_LABELS: Array<[CommitKind, string, string]> = [
  ["feature", "feature", "features"],
  ["fix", "fix", "fixes"],
  ["docs", "docs change", "docs changes"],
  ["refactor", "refactor", "refactors"],
  ["test", "test change", "test changes"],
  ["chore", "chore", "chores"],
];

/** Counts only messages that say their kind; the rest are reported as unclassified, not guessed. */
function kindText(commits: CommitInfo[]): string {
  const counts = new Map<CommitKind, number>();
  for (const c of commits) {
    const kind = classifyCommit(c.message);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = KIND_LABELS.filter(([kind]) => counts.get(kind)).map(([kind, one, many]) => {
    const n = counts.get(kind)!;
    return `${n} ${n === 1 ? one : many}`;
  });
  if (!parts.length) return "";
  const other = counts.get("other") ?? 0;
  return `- By kind (from commit messages): ${parts.join(", ")}${other ? `; ${other} unclassified` : ""}`;
}

/** A headed list capped at `max` lines, saying how many were left out. "" when empty. */
function section(heading: string, lines: string[], noun: string, max: number): string {
  if (!lines.length) return "";
  const more = lines.length > max ? [`- …and ${lines.length - max} more ${noun}`] : [];
  return `${heading}\n${[...lines.slice(0, max), ...more].join("\n")}`;
}

/** " authored 2024-04-01 to 2024-05-02" over the commits' author dates; "" when none are dated. */
function spanText(commits: CommitInfo[], lead: string): string {
  const dates = commits
    .map((c) => dateOf(c.authoredAt))
    .filter((d): d is string => d !== null)
    .sort();
  if (!dates.length) return "";
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  return from === to ? `${lead}on ${from}` : `${lead}${from} to ${to}`;
}

/** The calendar date as written in the ISO string, so no timezone conversion moves it a day. */
function dateOf(iso: string | null | undefined): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1] ?? null;
}

function isMerge(message: string): boolean {
  return MERGE_MESSAGE.test(firstLine(message));
}

function firstLine(message: string): string {
  return oneLine(message.split("\n")[0] ?? "");
}

/** Collapses whitespace and control characters and caps the length, since this text goes into prompts. */
function oneLine(text: string): string {
  return truncate(collapse(text));
}

function collapse(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ").trim();
}

/** Cuts at MAX_MESSAGE_CHARS without splitting a surrogate pair (a lone half is invalid text). */
function truncate(line: string): string {
  if (line.length <= MAX_MESSAGE_CHARS) return line;
  const cut = line.slice(0, MAX_MESSAGE_CHARS - 1);
  return `${/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

/**
 * Git allows newlines and control characters in file names; one would split a fact line in the
 * prompt, so they are shown as spaces. Paths are not shortened, since a cut path is not a real file.
 */
function cleanPath(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Code-point order, so ties sort the same on every machine regardless of locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
