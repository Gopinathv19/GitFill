/**
 * Deterministic symbol extraction. Regex-based, language-aware, and intentionally
 * conservative: it finds declarations (functions, classes, methods, types) with their
 * line ranges so explanations and diagrams can point at real code. No code is executed.
 */

export type Language = "typescript" | "python" | "go" | "java" | "kotlin" | "rust" | "ruby" | "csharp" | "php" | "unknown";

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "struct" | "trait" | "module" | "variable";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  path: string;
  line: number;
  endLine: number;
  exported: boolean;
  /** Enclosing class/module for methods. */
  parent?: string;
  /** The declaration line, trimmed, for display. */
  signature: string;
}

const EXT_LANG: Record<string, Language> = {
  ts: "typescript", tsx: "typescript", js: "typescript", jsx: "typescript", mjs: "typescript", cjs: "typescript", mts: "typescript", cts: "typescript",
  py: "python", go: "go", java: "java", kt: "kotlin", kts: "kotlin", rs: "rust", rb: "ruby", cs: "csharp", php: "php",
};

export function languageOf(path: string): Language {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "unknown";
  return EXT_LANG[path.slice(dot + 1).toLowerCase()] ?? "unknown";
}

interface Pattern {
  re: RegExp;
  kind: SymbolKind | ((m: RegExpMatchArray) => SymbolKind);
  name: number;
  exported?: (m: RegExpMatchArray, line: string) => boolean;
  /** Methods are only accepted when indented inside a class. */
  method?: boolean;
}

const TS_PATTERNS: Pattern[] = [
  { re: /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, kind: "type", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  // Arrow functions and function expressions assigned to a binding.
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>/, kind: "function", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?function\b/, kind: "function", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:memo|forwardRef)\s*\(/, kind: "function", name: 1, exported: (_m, l) => /^\s*export\b/.test(l) },
  // Class methods: indented, name(args) {  — excludes control-flow keywords.
  { re: /^\s+(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{;]+)?\{\s*$/, kind: "method", name: 1, method: true },
];

const TS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "constructor", "else", "do", "try", "with", "typeof", "new", "await", "yield"]);

const PY_PATTERNS: Pattern[] = [
  { re: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function", name: 2, exported: (m) => !m[2]!.startsWith("_") },
  { re: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class", name: 2, exported: (m) => !m[2]!.startsWith("_") },
];

const GO_PATTERNS: Pattern[] = [
  { re: /^func\s+\(\s*\w+\s+\*?(\w+)\s*\)\s+([A-Za-z_]\w*)/, kind: "method", name: 2, exported: (m) => /^[A-Z]/.test(m[2]!) },
  { re: /^func\s+([A-Za-z_]\w*)/, kind: "function", name: 1, exported: (m) => /^[A-Z]/.test(m[1]!) },
  { re: /^type\s+([A-Za-z_]\w*)\s+struct\b/, kind: "struct", name: 1, exported: (m) => /^[A-Z]/.test(m[1]!) },
  { re: /^type\s+([A-Za-z_]\w*)\s+interface\b/, kind: "interface", name: 1, exported: (m) => /^[A-Z]/.test(m[1]!) },
  { re: /^type\s+([A-Za-z_]\w*)\s+/, kind: "type", name: 1, exported: (m) => /^[A-Z]/.test(m[1]!) },
];

const JVM_PATTERNS: Pattern[] = [
  { re: /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|data|open|internal|export)\s+)*(?:class|object)\s+([A-Za-z_]\w*)/, kind: "class", name: 1, exported: (_m, l) => /\b(public|open|data|object)\b/.test(l) || !/\b(private|internal)\b/.test(l) },
  { re: /^\s*(?:(?:public|private|protected|static|sealed)\s+)*interface\s+([A-Za-z_]\w*)/, kind: "interface", name: 1, exported: (_m, l) => !/\bprivate\b/.test(l) },
  { re: /^\s*(?:(?:public|private|protected|static)\s+)*(?:enum(?:\s+class)?)\s+([A-Za-z_]\w*)/, kind: "enum", name: 1, exported: (_m, l) => !/\bprivate\b/.test(l) },
  { re: /^\s*(?:(?:public|private|protected|static)\s+)*record\s+([A-Za-z_]\w*)/, kind: "struct", name: 1, exported: (_m, l) => !/\bprivate\b/.test(l) },
  // Kotlin functions.
  { re: /^\s*(?:(?:public|private|protected|internal|override|open|suspend|inline|operator|infix)\s+)*fun\s+(?:<[^>]*>\s+)?(?:[\w.<>]+\.)?([A-Za-z_]\w*)\s*\(/, kind: (m) => (m[0].startsWith(" ") || m[0].startsWith("\t") ? "method" : "function"), name: 1, exported: (_m, l) => !/\b(private|internal)\b/.test(l) },
  // Java/C# methods: modifiers, return type, name(args) { or throws.
  { re: /^\s+(?:(?:public|private|protected|static|final|abstract|synchronized|override|virtual|async|sealed)\s+)+[\w<>\[\],.?\s]+?\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{?\s*$/, kind: "method", name: 1, method: true, exported: (_m, l) => /\bpublic\b/.test(l) },
];

const RUST_PATTERNS: Pattern[] = [
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, kind: (m) => (/^\s/.test(m[0]) ? "method" : "function"), name: 1, exported: (_m, l) => /\bpub\b/.test(l) },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct", name: 1, exported: (_m, l) => /\bpub\b/.test(l) },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum", name: 1, exported: (_m, l) => /\bpub\b/.test(l) },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: "trait", name: 1, exported: (_m, l) => /\bpub\b/.test(l) },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*\{/, kind: "module", name: 1, exported: (_m, l) => /\bpub\b/.test(l) },
  { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:]+\s+for\s+)?([A-Za-z_]\w*)/, kind: "class", name: 1, exported: () => true },
];

const RUBY_PATTERNS: Pattern[] = [
  { re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, kind: (m) => (/^\s/.test(m[0]) ? "method" : "function"), name: 1, exported: () => true },
  { re: /^\s*class\s+([A-Z][\w:]*)/, kind: "class", name: 1, exported: () => true },
  { re: /^\s*module\s+([A-Z][\w:]*)/, kind: "module", name: 1, exported: () => true },
];

const PHP_PATTERNS: Pattern[] = [
  { re: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?([A-Za-z_]\w*)/, kind: (m) => (/^\s/.test(m[0]) ? "method" : "function"), name: 1, exported: (_m, l) => !/\bprivate\b/.test(l) },
  { re: /^\s*(?:(?:abstract|final|readonly)\s+)*class\s+([A-Za-z_]\w*)/, kind: "class", name: 1, exported: () => true },
  { re: /^\s*interface\s+([A-Za-z_]\w*)/, kind: "interface", name: 1, exported: () => true },
  { re: /^\s*trait\s+([A-Za-z_]\w*)/, kind: "trait", name: 1, exported: () => true },
  { re: /^\s*enum\s+([A-Za-z_]\w*)/, kind: "enum", name: 1, exported: () => true },
];

const PATTERNS: Partial<Record<Language, Pattern[]>> = {
  typescript: TS_PATTERNS,
  python: PY_PATTERNS,
  go: GO_PATTERNS,
  java: JVM_PATTERNS,
  kotlin: JVM_PATTERNS,
  csharp: JVM_PATTERNS,
  rust: RUST_PATTERNS,
  ruby: RUBY_PATTERNS,
  php: PHP_PATTERNS,
};

const MAX_SYMBOLS_PER_FILE = 400;

export function extractSymbols(path: string, content: string): CodeSymbol[] {
  const lang = languageOf(path);
  const patterns = PATTERNS[lang];
  if (!patterns) return [];
  const lines = content.split("\n");
  const out: CodeSymbol[] = [];
  const containers: Array<{ name: string; indent: number; endLine: number }> = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length && out.length < MAX_SYMBOLS_PER_FILE; i++) {
    const line = lines[i]!;
    if (lang !== "python" && lang !== "ruby") {
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("#")) continue;
      if (t.startsWith("/*")) {
        if (!line.includes("*/")) inBlockComment = true;
        continue;
      }
    } else if (line.trimStart().startsWith("#")) continue;

    const lineNo = i + 1;
    while (containers.length && containers[containers.length - 1]!.endLine < lineNo) containers.pop();

    for (const p of patterns) {
      const m = line.match(p.re);
      if (!m) continue;
      const name = m[p.name];
      if (!name || TS_KEYWORDS.has(name)) continue;
      const indent = line.length - line.trimStart().length;
      let kind = typeof p.kind === "function" ? p.kind(m) : p.kind;
      const parent = containers.find((c) => c.indent < indent)?.name ?? containers[containers.length - 1]?.name;
      if (p.method && !parent) continue;
      if (kind === "function" && parent && indent > 0 && (lang === "typescript" || lang === "python")) {
        // Nested function inside a class/function body: keep only when the parent is a container type.
        kind = "method";
      }
      const endLine = lang === "python" || lang === "ruby" ? indentedEnd(lines, i, indent) : bracedEnd(lines, i);
      const sym: CodeSymbol = {
        name,
        kind,
        path,
        line: lineNo,
        endLine,
        exported: p.exported ? p.exported(m, line) : true,
        ...(parent && kind === "method" ? { parent } : {}),
        signature: line.trim().slice(0, 160),
      };
      out.push(sym);
      if (kind === "class" || kind === "interface" || kind === "struct" || kind === "trait" || kind === "module" || kind === "enum") {
        containers.push({ name, indent, endLine });
      }
      break;
    }
  }
  return out;
}

/** End of a brace-delimited block starting at `start`: counts { and } outside of strings/comments. */
function bracedEnd(lines: string[], start: number): number {
  let depth = 0;
  let seenOpen = false;
  const limit = Math.min(lines.length, start + 2000);
  for (let i = start; i < limit; i++) {
    const line = stripStringsAndComments(lines[i]!);
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        seenOpen = true;
      } else if (ch === "}") {
        depth--;
        if (seenOpen && depth === 0) return i + 1;
      }
    }
    if (!seenOpen && i - start >= 3) return start + 1;
    if (seenOpen && depth <= 0) return i + 1;
  }
  return seenOpen ? limit : start + 1;
}

/** End of an indentation-delimited block (Python, Ruby-ish): the last line indented deeper than `indent`. */
function indentedEnd(lines: string[], start: number, indent: number): number {
  let end = start + 1;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const ind = line.length - line.trimStart().length;
    if (ind <= indent) break;
    end = i + 1;
  }
  return end;
}

function stripStringsAndComments(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "#" && !/[\w)]/.test(line[i - 1] ?? "")) break;
    out += ch;
  }
  return out;
}

/** Finds the innermost symbol that contains a line, for "explain selection" features. */
export function enclosingSymbol(symbols: CodeSymbol[], line: number): CodeSymbol | undefined {
  let best: CodeSymbol | undefined;
  for (const s of symbols) {
    if (s.line <= line && s.endLine >= line) {
      if (!best || s.endLine - s.line < best.endLine - best.line) best = s;
    }
  }
  return best;
}
