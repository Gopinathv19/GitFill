import { z } from "zod";
import { numberLines } from "@/lib/ai/prompts";
import { extractSymbols } from "@/lib/analysis/symbols";
import { InvalidPatternError, type CodeSource } from "@/lib/repo-store/types";
import { defineTool, type ToolDefinition } from "./tool-loop";

const READ_LINES = 250;
const LIST_LIMIT = 300;
const pathArg = z.string().min(1).max(400);

/**
 * On-demand code search over a CodeSource (git store, repo service or snapshot). Results are plain
 * text in the shapes models know from coding tools (`path:line: text`, numbered lines) and always
 * say how to get more when cut off.
 */
export function createSearchTools(source: CodeSource): ToolDefinition[] {
  return [
    defineTool({
      name: "grep",
      description: "Search file contents with an extended regular expression (or literal text). Returns `path:line: text`. Narrow with `path` (directory) or `glob` (e.g. \"*.ts\").",
      input: z.object({
        pattern: z.string().min(1).max(200),
        path: pathArg.optional(),
        glob: z.string().max(100).optional(),
        ignore_case: z.boolean().default(false),
        literal: z.boolean().default(false),
      }),
      run: async (i) => {
        let note = "";
        let result;
        try {
          result = await source.grep(i.pattern, { path: i.path, glob: i.glob, ignoreCase: i.ignore_case, fixed: i.literal });
        } catch (err) {
          if (!(err instanceof InvalidPatternError)) throw err;
          note = "Note: the pattern is not a valid regular expression, so it was searched as literal text.\n";
          result = await source.grep(i.pattern, { path: i.path, glob: i.glob, ignoreCase: i.ignore_case, fixed: true });
        }
        if (!result.hits.length) return `${note}No matches.`;
        const lines = result.hits.map((h) => `${h.path}:${h.line}: ${h.text}`);
        return `${note}${lines.join("\n")}${result.truncated ? "\n… more matches: narrow with path or glob" : ""}`;
      },
    }),
    defineTool({
      name: "list_files",
      description: "List file paths, optionally under a directory and/or matching a glob (e.g. \"**/*.go\").",
      input: z.object({ dir: pathArg.optional(), glob: z.string().max(100).optional() }),
      run: async (i) => {
        const { paths, total } = await source.listFiles({ dir: i.dir, glob: i.glob, limit: LIST_LIMIT });
        if (!total) return "No files.";
        return `${paths.join("\n")}${total > paths.length ? `\n… ${total - paths.length} more: narrow with dir or glob` : ""}`;
      },
    }),
    defineTool({
      name: "read_file",
      description: `Read a file with line numbers, at most ${READ_LINES} lines per call. Read only the range you need; cite the line numbers you see.`,
      input: z.object({ path: pathArg, start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
      run: async (i) => {
        const start = i.start_line ?? 1;
        const end = Math.min(i.end_line ?? start + READ_LINES - 1, start + READ_LINES - 1);
        const file = await source.read(i.path, { start, end });
        if (!file) return `Not readable: ${i.path} does not exist, is hidden (secrets, lockfiles, generated output) or is binary. Use list_files to find the right path.`;
        const last = file.start + file.lines.length - 1;
        return `${file.path} (lines ${file.start}-${last} of ${file.total})\n${numberLines(file.lines, file.start)}${last < file.total ? `\n… continue with start_line=${last + 1}` : ""}`;
      },
    }),
    defineTool({
      name: "outline_file",
      description: "Declarations in a file (functions, classes, types, methods) with their line ranges. Cheaper than reading the whole file.",
      input: z.object({ path: pathArg }),
      run: async (i) => {
        const file = await source.read(i.path);
        if (!file) return `Not readable: ${i.path}.`;
        const symbols = extractSymbols(file.path, file.lines.join("\n"));
        if (!symbols.length) return `No declarations found in ${file.path} (${file.total} lines); use read_file.`;
        return `${file.path} (${file.total} lines)\n${symbols
          .slice(0, 150)
          .map((s) => `${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name} [${s.line}-${s.endLine}]${s.exported ? " exported" : ""}`)
          .join("\n")}`;
      },
    }),
    defineTool({
      name: "find_definition",
      description: "Where a function, class, type or variable is declared: `path:start-end  signature`.",
      input: z.object({ name: z.string().regex(/^[A-Za-z_$][\w$]*$/, "an identifier").max(120) }),
      run: async (i) => {
        const decl = `\\b(function|class|interface|type|enum|struct|trait|def|func|fn|const|let|var|val|object|module|record)\\b[^;{=]*\\b${i.name}\\b`;
        const { hits } = await source.grep(decl, { maxResults: 40 });
        const out: string[] = [];
        for (const path of [...new Set(hits.map((h) => h.path))].slice(0, 8)) {
          const file = await source.read(path);
          if (!file) continue;
          for (const s of extractSymbols(path, file.lines.join("\n"))) if (s.name === i.name) out.push(`${path}:${s.line}-${s.endLine}  ${s.signature}`);
        }
        if (out.length) return out.join("\n");
        return hits.length ? `No exact declaration parsed; candidate lines:\n${hits.slice(0, 15).map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n")}` : `No declaration of ${i.name} found; try grep.`;
      },
    }),
  ];
}
