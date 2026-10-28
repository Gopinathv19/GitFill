import * as path from "node:path";
import * as vscode from "vscode";
import { Git } from "./git";
import type { WorkspacePayload } from "./client";

const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 1_500_000;
const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,rb,cs,php,sql,graphql,proto,md,json,yaml,yml,toml,prisma}";

/**
 * Collects the part of the workspace a request needs: the focus files first, then files
 * that import or are imported by them, then the rest of the workspace up to the limit.
 * Secrets and build output are excluded here and again on the server.
 */
export async function collectWorkspace(folder: vscode.WorkspaceFolder, focusPaths: string[], opts: { limit?: number } = {}): Promise<WorkspacePayload> {
  const config = vscode.workspace.getConfiguration("gitfill");
  const limit = opts.limit ?? config.get<number>("maxContextFiles") ?? 60;
  const excludes = config.get<string[]>("excludeGlobs") ?? [];
  const exclude = `{${[...excludes, "**/.env*", "**/*.pem", "**/*.key"].join(",")}}`;
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, CODE_GLOB), exclude, 5000);
  const rel = (u: vscode.Uri) => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join("/");
  const allPaths = uris.map(rel);
  const focus = new Set(focusPaths.map((p) => p.split(path.sep).join("/")));

  // Rank: focus files, then same directory, then files whose basename is imported by a focus file, then the rest.
  const focusDirs = new Set([...focus].map((p) => path.posix.dirname(p)));
  const focusContents = await Promise.all([...focus].map((p) => readRel(folder, p)));
  const mentioned = new Set<string>();
  for (const content of focusContents) {
    if (!content) continue;
    for (const m of content.matchAll(/from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)|^\s*(?:from|import)\s+([\w.]+)/gm)) {
      const spec = (m[1] ?? m[2] ?? m[3] ?? "").split("/").pop()?.replace(/\.\w+$/, "").split(".").pop();
      if (spec) mentioned.add(spec.toLowerCase());
    }
  }
  const score = (p: string) => {
    if (focus.has(p)) return 1000;
    const base = path.posix.basename(p).replace(/\.\w+$/, "").toLowerCase();
    let s = 0;
    if (focusDirs.has(path.posix.dirname(p))) s += 100;
    if (mentioned.has(base)) s += 200;
    if (/(^|\/)(index|main|app|server|routes?|router|schema|models?)\./.test(p)) s += 20;
    if (p.endsWith(".md") || p.endsWith(".json")) s -= 10;
    return s;
  };
  const ranked = [...allPaths].sort((a, b) => score(b) - score(a) || a.localeCompare(b));

  const files: WorkspacePayload["files"] = [];
  let total = 0;
  for (const p of ranked) {
    if (files.length >= limit || total >= MAX_TOTAL_BYTES) break;
    const content = focus.has(p) ? focusContents[[...focus].indexOf(p)] : await readRel(folder, p);
    if (!content || content.length > MAX_FILE_BYTES || content.includes("\u0000")) continue;
    files.push({ path: p, content });
    total += content.length;
  }
  // Unsaved editor changes win over the file on disk.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isUntitled || !doc.uri.fsPath.startsWith(folder.uri.fsPath)) continue;
    const p = rel(doc.uri);
    const entry = files.find((f) => f.path === p);
    if (entry) entry.content = doc.getText();
  }

  const git = new Git(folder.uri.fsPath);
  const [branch, head] = (await git.isRepo()) ? await Promise.all([git.branch(), git.head()]) : [undefined, undefined];
  return { name: folder.name, files, allPaths: allPaths.slice(0, 20_000), branch, head };
}

async function readRel(folder: vscode.WorkspaceFolder, relPath: string): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, relPath));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

export function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
}
