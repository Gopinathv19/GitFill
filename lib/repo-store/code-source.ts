import { RE2JS } from "re2js";
import { exclusionReason } from "@/lib/connectors/github/filter";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { git, GitError } from "./git";
import { InvalidPatternError, type CodeSource, type FileRead, type GrepHit, type GrepOptions, type ListOptions } from "./types";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 240;
const DEFAULT_GREP_RESULTS = 80;
const GREP_PER_FILE = 20;

/** Hidden from every agent: secrets, lockfiles, generated output, binaries, dependency/build dirs. */
export function isVisiblePath(path: string): boolean {
  return !exclusionReason(path);
}

/** Normalizes a model-supplied path; rejects absolute paths and `..` segments. */
export function cleanPath(path: string): string | null {
  const p = path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!p || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "")) return null;
  return p;
}

/** Glob tokens: a literal character, or one of the wildcards below. */
type GlobToken = string | typeof STAR | typeof GLOBSTAR | typeof GLOBSTAR_DIR | typeof ONE;
const STAR = 0; // `*`: any run of characters within one path segment
const GLOBSTAR = 1; // `**`: any run of characters, across segments
const GLOBSTAR_DIR = 2; // `**/`: zero or more whole directories
const ONE = 3; // `?`: one character other than "/"
const MAX_GLOB_ALTERNATIVES = 64;

export interface GlobMatcher {
  test(path: string): boolean;
}

/**
 * Minimal glob: `**` any path, `*` within a segment, `?` one char, `{a,b}` alternatives.
 * Matched with a dynamic-programming table instead of a RegExp, so a model-supplied glob
 * runs in O(path × glob) time and cannot cause catastrophic backtracking (ReDoS).
 */
export function compileGlob(glob: string): GlobMatcher {
  let alternatives: GlobToken[][] = [[]];
  const push = (...t: GlobToken[]) => alternatives.forEach((a) => a.push(...t));
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        push(glob[i + 2] === "/" ? GLOBSTAR_DIR : GLOBSTAR);
        i += glob[i + 2] === "/" ? 2 : 1;
      } else push(STAR);
    } else if (c === "?") push(ONE);
    else if (c === "{" && glob.indexOf("}", i) !== -1) {
      const end = glob.indexOf("}", i);
      const options = glob.slice(i + 1, end).split(",").map((s) => [...s].map((ch): GlobToken => (ch === "*" ? STAR : ch)));
      alternatives = alternatives.flatMap((a) => options.map((o) => [...a, ...o])).slice(0, MAX_GLOB_ALTERNATIVES);
      i = end;
    } else push(c);
  }
  // A glob without "/" matches the file name anywhere, like most search tools.
  if (!glob.includes("/")) alternatives.forEach((a) => a.unshift(GLOBSTAR_DIR));
  return { test: (path) => alternatives.some((tokens) => globMatches(tokens, path)) };
}

/** next[j] = "tokens after this one match path[j..]"; filled from the last token backwards. */
function globMatches(tokens: GlobToken[], s: string): boolean {
  const n = s.length;
  let next = new Array<boolean>(n + 1).fill(false);
  next[n] = true;
  for (let t = tokens.length - 1; t >= 0; t--) {
    const tok = tokens[t]!;
    const cur = new Array<boolean>(n + 1).fill(false);
    let dirAhead = false; // some "/" at k >= j with next[k + 1]
    for (let j = n; j >= 0; j--) {
      if (tok === STAR) cur[j] = next[j]! || (j < n && s[j] !== "/" && cur[j + 1]!);
      else if (tok === GLOBSTAR) cur[j] = next[j]! || (j < n && cur[j + 1]!);
      else if (tok === GLOBSTAR_DIR) {
        if (j < n && s[j] === "/" && next[j + 1]) dirAhead = true;
        cur[j] = next[j]! || dirAhead;
      } else if (tok === ONE) cur[j] = j < n && s[j] !== "/" && next[j + 1]!;
      else cur[j] = j < n && s[j] === tok && next[j + 1]!;
    }
    next = cur;
  }
  return next[0]!;
}

function filterList(all: string[], opts: ListOptions): { paths: string[]; total: number } {
  const dir = opts.dir ? cleanPath(opts.dir) : "";
  if (dir === null) return { paths: [], total: 0 };
  const glob = opts.glob ? compileGlob(opts.glob) : null;
  const matched = all.filter((p) => (!dir || p === dir || p.startsWith(`${dir}/`)) && (!glob || glob.test(p)));
  return { paths: matched.slice(0, opts.limit ?? 300), total: matched.length };
}

function clipLine(text: string): string {
  return text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text;
}

function slice(path: string, content: string, range: { start?: number; end?: number } = {}): FileRead {
  const lines = content.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const start = Math.max(1, Math.min(range.start ?? 1, lines.length || 1));
  const end = Math.max(start, Math.min(range.end ?? lines.length, lines.length));
  return { path, lines: lines.slice(start - 1, end), start, total: lines.length };
}

/**
 * Code at one commit of a bare git repository. The file list and recently read files are cached
 * on the instance; LocalGitStore reuses instances per commit.
 */
export class GitSource implements CodeSource {
  private all: Promise<string[]> | null = null;
  private readonly files = new Map<string, string | null>();

  constructor(
    private readonly dir: string,
    readonly version: string,
    readonly label: string,
  ) {}

  private list(): Promise<string[]> {
    this.all ??= git(["ls-tree", "-r", "-z", "--name-only", this.version], { cwd: this.dir, maxBuffer: 64 * 1024 * 1024 })
      .then(({ stdout }) => stdout.split("\0").filter((p) => p && isVisiblePath(p)))
      .catch((err) => {
        this.all = null;
        throw err;
      });
    return this.all;
  }

  async listFiles(opts: ListOptions = {}) {
    return filterList(await this.list(), opts);
  }

  async grep(pattern: string, opts: GrepOptions = {}) {
    const max = opts.maxResults ?? DEFAULT_GREP_RESULTS;
    const scope = opts.path ? cleanPath(opts.path) : ".";
    if (scope === null) return { hits: [], truncated: false };
    const pathspec = opts.glob ? `:(glob)${scope === "." ? "" : `${scope}/`}${opts.glob.includes("/") ? opts.glob : `**/${opts.glob}`}` : scope;
    const args = ["grep", "-n", "-I", "--no-color", "--full-name", `--max-count=${GREP_PER_FILE}`, opts.fixed ? "-F" : "-E", ...(opts.ignoreCase ? ["-i"] : []), "-e", pattern, this.version, "--", pathspec];
    let stdout: string;
    try {
      ({ stdout } = await git(args, { cwd: this.dir, okCodes: [0, 1], timeoutMs: 10_000 }));
    } catch (err) {
      if (err instanceof GitError && /regex|regcomp|Invalid|Unmatched|brace|parenthes/i.test(err.stderr)) throw new InvalidPatternError(err.stderr.trim().split("\n").at(-1) ?? "invalid pattern");
      throw err;
    }
    const prefix = `${this.version}:`;
    const hits: GrepHit[] = [];
    let truncated = false;
    for (const raw of stdout.split("\n")) {
      if (!raw) continue;
      const m = /^(.*?):(\d+):(.*)$/.exec(raw.startsWith(prefix) ? raw.slice(prefix.length) : raw);
      if (!m || !isVisiblePath(m[1]!)) continue;
      if (hits.length >= max) {
        truncated = true;
        break;
      }
      hits.push({ path: m[1]!, line: Number(m[2]), text: clipLine(m[3]!) });
    }
    return { hits, truncated };
  }

  async read(path: string, range?: { start?: number; end?: number }) {
    const content = await this.content(path);
    return content === null ? null : slice(cleanPath(path)!, content, range);
  }

  /** Whole file text, or null if missing, hidden, binary or too large. */
  async content(path: string): Promise<string | null> {
    const p = cleanPath(path);
    if (!p || !isVisiblePath(p)) return null;
    if (this.files.has(p)) return this.files.get(p)!;
    let text: string | null = null;
    try {
      const size = Number((await git(["cat-file", "-s", `${this.version}:${p}`], { cwd: this.dir })).stdout.trim());
      if (size <= MAX_FILE_BYTES) {
        const { stdout } = await git(["cat-file", "blob", `${this.version}:${p}`], { cwd: this.dir, maxBuffer: MAX_FILE_BYTES + 1024 });
        text = stdout.includes("\0") ? null : stdout;
      }
    } catch (err) {
      if (!(err instanceof GitError)) throw err;
    }
    if (this.files.size > 200) this.files.delete(this.files.keys().next().value!);
    this.files.set(p, text);
    return text;
  }
}

/**
 * The same interface over an in-memory snapshot (the VS Code extension's local files, tests).
 * Only files the snapshot holds can be read or searched; the rest of the inventory is listed.
 */
export class SnapshotSource implements CodeSource {
  readonly label: string;
  readonly version: string;
  private readonly byPath: Map<string, string>;
  private readonly all: string[];

  constructor(snapshot: Pick<SourceSnapshot, "displayName" | "version" | "files" | "inventory">) {
    this.label = `${snapshot.displayName} @ ${snapshot.version.slice(0, 7)}`;
    this.version = snapshot.version;
    this.byPath = new Map(snapshot.files.filter((f) => isVisiblePath(f.path)).map((f) => [f.path, f.content]));
    this.all = [...new Set([...snapshot.inventory.map((i) => i.path), ...this.byPath.keys()])].filter(isVisiblePath).sort();
  }

  async listFiles(opts: ListOptions = {}) {
    return filterList(this.all, opts);
  }

  async grep(pattern: string, opts: GrepOptions = {}) {
    // Model-supplied patterns run on RE2 (linear time, no backtracking), so a pathological
    // regex cannot block the event loop (ReDoS). RE2 syntax is close to the ERE that git grep uses.
    let re: { test(line: string): boolean };
    try {
      re = RE2JS.compile(opts.fixed ? RE2JS.quote(pattern) : pattern, opts.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0);
    } catch (err) {
      throw new InvalidPatternError(err instanceof Error ? err.message : "invalid pattern");
    }
    const scope = filterList([...this.byPath.keys()].sort(), { dir: opts.path, glob: opts.glob, limit: Infinity }).paths;
    const max = opts.maxResults ?? DEFAULT_GREP_RESULTS;
    const hits: GrepHit[] = [];
    for (const path of scope) {
      let perFile = 0;
      const lines = this.byPath.get(path)!.split("\n");
      for (let i = 0; i < lines.length && perFile < GREP_PER_FILE; i++) {
        if (!re.test(lines[i]!)) continue;
        if (hits.length >= max) return { hits, truncated: true };
        hits.push({ path, line: i + 1, text: clipLine(lines[i]!) });
        perFile++;
      }
    }
    return { hits, truncated: false };
  }

  async read(path: string, range?: { start?: number; end?: number }) {
    const p = cleanPath(path);
    const content = p ? this.byPath.get(p) : undefined;
    return content === undefined ? null : slice(p!, content, range);
  }
}
