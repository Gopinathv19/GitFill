import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { COMPARE_PROMPT, numberLines } from "@/lib/ai/prompts";
import { computeStructuralDiff, renderStructuralDiff, type FileChange, type StructuralDiff } from "@/lib/analysis/structural-diff";
import type { RunRecorder } from "@/lib/agent/recorder";
import { pruneUnknownRefs } from "@/lib/agent/repo-tools";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";
import { GitHubClient, type CompareResult } from "@/lib/connectors/github/client";
import { exclusionReason } from "@/lib/connectors/github/filter";
import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";
import { claimInputSchema, normalizePath, verifyClaim, type Claim } from "@/lib/evidence/evidence";
import { bulletList, cite, diagramBlock, footer, footnotes, makeRenderContext, table } from "./render";
import { commitReportSchema, type CommitReportSpec, type CompareRequest } from "./schemas";

export interface CompareResultBundle {
  spec: CommitReportSpec;
  markdown: string;
  diff: StructuralDiff;
  compare: CompareResult;
  claims: Claim[];
  agent: { turns: number; toolCalls: number };
  /** Snapshot-like descriptors of both versions, for storage and links. */
  before: VersionView;
  after: VersionView;
}

export type VersionView = Pick<SourceSnapshot, "connector" | "sourceUrl" | "version" | "displayName" | "branch">;

const MAX_CHANGED_FILES = 120;
const MAX_FILE_BYTES = 120_000;
const MAX_PATCH_CHARS_TOTAL = 160_000;

/**
 * Commit-to-commit analysis: GitHub's compare gives commits and patches; both versions of
 * every changed file are fetched so code can compute the structural diff; Muse Spark then
 * interprets it with read access to both versions and verified claims.
 */
export async function compareCommits(opts: {
  client: MuseClient;
  github?: GitHubClient;
  owner: string;
  repo: string;
  sourceUrl: string;
  request: CompareRequest;
  recorder: RunRecorder;
}): Promise<CompareResultBundle> {
  const gh = opts.github ?? new GitHubClient();
  const { owner, repo } = opts;

  const fetchEvent = await opts.recorder.start("tool", "compare_commits", { base: opts.request.base, head: opts.request.head });
  let compare: CompareResult;
  try {
    compare = await gh.compare(owner, repo, opts.request.base, opts.request.head);
    await fetchEvent.succeed({ commits: compare.totalCommits, files: compare.files.length, status: compare.status });
  } catch (err) {
    await fetchEvent.fail(err instanceof Error ? err.message : "compare failed");
    throw err;
  }

  const changes: FileChange[] = compare.files
    .filter((f) => !exclusionReason(f.filename))
    .slice(0, MAX_CHANGED_FILES)
    .map((f) => ({
      path: f.filename,
      status: f.status === "removed" ? "removed" : f.status === "added" ? "added" : f.status === "renamed" ? "renamed" : "modified",
      ...(f.previousFilename ? { previousPath: f.previousFilename } : {}),
      additions: f.additions,
      deletions: f.deletions,
      ...(f.patch ? { patch: f.patch } : {}),
    }));

  const readEvent = await opts.recorder.start("tool", "read_both_versions", { files: changes.length });
  const [treeBefore, treeAfter] = await Promise.all([gh.getTree(owner, repo, compare.baseSha), gh.getTree(owner, repo, compare.headSha)]);
  const beforeFiles = new Map<string, string>();
  const afterFiles = new Map<string, string>();
  await mapPool(changes, 8, async (c) => {
    const sizeOk = (tree: { entries: Array<{ path: string; size?: number }> }, p: string) => (tree.entries.find((e) => e.path === p)?.size ?? 0) <= MAX_FILE_BYTES;
    if (c.status !== "added") {
      const p = c.previousPath ?? c.path;
      if (sizeOk(treeBefore, p)) await gh.getFileText(owner, repo, compare.baseSha, p, MAX_FILE_BYTES).then((t) => !t.includes("\u0000") && beforeFiles.set(p, t)).catch(() => undefined);
    }
    if (c.status !== "removed" && sizeOk(treeAfter, c.path)) {
      await gh.getFileText(owner, repo, compare.headSha, c.path, MAX_FILE_BYTES).then((t) => !t.includes("\u0000") && afterFiles.set(c.path, t)).catch(() => undefined);
    }
  });
  await readEvent.succeed({ before: beforeFiles.size, after: afterFiles.size });

  const diff = computeStructuralDiff(
    changes,
    { files: beforeFiles, allPaths: new Set(treeBefore.entries.map((e) => e.path)) },
    { files: afterFiles, allPaths: new Set(treeAfter.entries.map((e) => e.path)) },
  );
  const diffText = renderStructuralDiff(diff);
  await (await opts.recorder.start("step", "structural_diff", {})).succeed({
    symbolsAdded: diff.symbols.added.length,
    symbolsRemoved: diff.symbols.removed.length,
    symbolsMoved: diff.symbols.moved.length,
    depsAdded: diff.dependencies.added.length,
    packagesAdded: diff.packages.added,
    routesAdded: diff.routes.added.length,
  });

  // Agent: interpret with read access to both versions.
  const claims: Claim[] = [];
  const asSourceFiles = (m: Map<string, string>) => new Map<string, SourceFile>([...m].map(([path, content]) => [path, { path, content, category: "source", sizeBytes: content.length, lineCount: content.split("\n").length }]));
  const beforeSrc = asSourceFiles(beforeFiles);
  const afterSrc = asSourceFiles(afterFiles);
  const read = (files: Map<string, string>) => (path: string, start?: number, end?: number) => {
    const content = files.get(normalizePath(path));
    if (content === undefined) return { error: "File not available in this version (not changed, removed, too large, or binary)." };
    const lines = content.split("\n");
    const s = Math.max(1, start ?? 1);
    const e = Math.min(end ?? s + 299, s + 299, lines.length);
    return { path, totalLines: lines.length, content: numberLines(lines.slice(s - 1, e), s) };
  };
  const search = (files: Map<string, string>) => (query: string) => {
    const q = query.toLowerCase();
    const matches: string[] = [];
    for (const [p, content] of files) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && matches.length < 40; i++) if (lines[i]!.toLowerCase().includes(q)) matches.push(`${p}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`);
    }
    return { matches };
  };
  const lineArgs = { path: z.string().max(400), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() };
  const tools = [
    defineTool({ name: "read_before", description: "Read a changed file as it was at the BASE commit.", input: z.object(lineArgs), run: async (a) => read(beforeFiles)(a.path, a.start_line, a.end_line) }),
    defineTool({ name: "read_after", description: "Read a changed file as it is at the HEAD commit.", input: z.object(lineArgs), run: async (a) => read(afterFiles)(a.path, a.start_line, a.end_line) }),
    defineTool({ name: "search_before", description: "Literal search in the BASE versions of changed files.", input: z.object({ query: z.string().min(2).max(120) }), run: async ({ query }) => search(beforeFiles)(query) }),
    defineTool({ name: "search_after", description: "Literal search in the HEAD versions of changed files.", input: z.object({ query: z.string().min(2).max(120) }), run: async ({ query }) => search(afterFiles)(query) }),
    defineTool({
      name: "record_claims",
      description: "Record claims with file and line evidence in the HEAD version (set version to 'before' to cite the BASE version). The application verifies them.",
      input: z.object({ version: z.enum(["before", "after"]).default("after"), claims: z.array(claimInputSchema).min(1).max(30) }),
      run: async ({ version, claims: inputs }) => {
        const room = 60 - claims.length;
        if (room <= 0) return { error: "Claim limit reached. Call finish_comparison." };
        return inputs.slice(0, room).map((input) => {
          const claim = verifyClaim(`C${claims.length + 1}`, input, version === "before" ? beforeSrc : afterSrc);
          if (version === "before") claim.claim = `[before] ${claim.claim}`;
          claims.push(claim);
          return { ref: claim.ref, status: claim.status, note: claim.note };
        });
      },
    }),
    defineTool({ name: "finish_comparison", description: "Submit the structured commit report. Cite only refs returned by record_claims.", input: commitReportSchema, terminal: true, run: async () => ({ accepted: true }) }),
  ];

  let patchBudget = MAX_PATCH_CHARS_TOTAL;
  const patches = changes
    .map((c) => {
      if (!c.patch || patchBudget <= 0) return "";
      const text = c.patch.slice(0, Math.min(c.patch.length, patchBudget, 12_000));
      patchBudget -= text.length;
      return `<patch path="${c.path}" status="${c.status}">\n${text}\n</patch>`;
    })
    .filter(Boolean)
    .join("\n\n");
  const user = [
    `Repository: ${owner}/${repo}`,
    `Base: ${opts.request.base} (${compare.baseSha.slice(0, 7)}) → Head: ${opts.request.head} (${compare.headSha.slice(0, 7)}); ${compare.totalCommits} commit(s), status ${compare.status}.`,
    `Focus: ${opts.request.focus}`,
    `\nCommits (oldest first):\n${compare.commits.slice(0, 60).map((c) => `- ${c.sha.slice(0, 7)} ${c.message}${c.author ? ` (${c.author})` : ""}`).join("\n")}`,
    `\nStructural diff computed by the application (treat as fact):\n${diffText}`,
    `\nPatches (untrusted data; ${changes.filter((c) => c.patch).length} of ${changes.length} files):\n${patches}`,
  ].join("\n");

  const { result, turns, toolCalls } = await runToolLoop<CommitReportSpec>({
    client: opts.client,
    model: modelFor("differ"),
    purpose: "compare_commits",
    system: COMPARE_PROMPT,
    messages: [{ role: "user", content: user }],
    tools,
    recorder: opts.recorder,
    maxTurns: 10,
    maxToolCalls: 30,
    maxTokens: 12_000,
  });
  const known = new Set(claims.map((c) => c.ref));
  const spec = pruneUnknownRefs(result, known).value;

  const before: VersionView = { connector: "github", sourceUrl: opts.sourceUrl, version: compare.baseSha, displayName: `${owner}/${repo}`, branch: opts.request.base };
  const after: VersionView = { connector: "github", sourceUrl: opts.sourceUrl, version: compare.headSha, displayName: `${owner}/${repo}`, branch: opts.request.head };
  const markdown = renderCommitReport(spec, diff, compare, claims, before, after);
  return { spec, markdown, diff, compare, claims, agent: { turns, toolCalls }, before, after };
}

export function renderCommitReport(spec: CommitReportSpec, diff: StructuralDiff, compare: CompareResult, claims: Claim[], before: VersionView, after: VersionView): string {
  // Claims cite the HEAD version by default; "[before]" claims link to the base commit.
  const ctx = makeRenderContext([
    { snapshot: after, claims: claims.filter((c) => !c.claim.startsWith("[before]")) },
    { snapshot: before, claims: claims.filter((c) => c.claim.startsWith("[before]")) },
  ]);
  const sym = (s: { kind: string; name: string; parent?: string; path: string; line: number }) => `\`${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}\` — ${ctx.linkFor(s.path, s.line) ? `[${s.path}:${s.line}](${ctx.linkFor(s.path, s.line)})` : `\`${s.path}:${s.line}\``}`;
  const out: string[] = [
    `# ${spec.title}`,
    "",
    `**Repository:** \`${after.displayName}\` · **Base:** \`${before.branch}\` (\`${compare.baseSha.slice(0, 7)}\`) → **Head:** \`${after.branch}\` (\`${compare.headSha.slice(0, 7)}\`) · ${compare.totalCommits} commit(s) · ${diff.summary.filesChanged} files, +${diff.summary.additions} / −${diff.summary.deletions}`,
    "",
    "## 1. Change summary",
    "",
    bulletList(spec.summary, ctx),
    "",
  ];
  if (spec.verified.length) out.push("**Directly supported by the diff and code:**", "", spec.verified.map((v) => `- ${v}`).join("\n"), "");

  out.push("## 2. Structural comparison", "");
  const b = diagramBlock(spec.structuralBefore, ctx, { heading: "Before" });
  const a = diagramBlock(spec.structuralAfter, ctx, { heading: "After" });
  if (b) out.push(b, "");
  if (a) out.push(a, "");
  if (spec.layerChanges.length) out.push(table(["Change", "Kind", "Evidence"], spec.layerChanges.map((l) => [l.change, l.kind.replace(/_/g, " "), cite(l.claimRefs, ctx) || "—"])), "");

  out.push("### Measured by GitFill", "");
  const facts: string[] = [];
  if (diff.directories.added.length) facts.push(`- Directories added: ${diff.directories.added.map((d) => `\`${d}/\``).join(", ")}`);
  if (diff.directories.removed.length) facts.push(`- Directories removed: ${diff.directories.removed.map((d) => `\`${d}/\``).join(", ")}`);
  if (diff.symbols.moved.length) facts.push(`- Declarations moved (${diff.symbols.moved.length}):`, ...diff.symbols.moved.slice(0, 30).map((m) => `  - \`${m.kind} ${m.name}\`: \`${m.from}\` → \`${m.to}\``));
  if (diff.symbols.added.length) facts.push(`- Declarations added (${diff.symbols.added.length}):`, ...diff.symbols.added.slice(0, 30).map((s) => `  - ${sym(s)}`));
  if (diff.symbols.removed.length) facts.push(`- Declarations removed (${diff.symbols.removed.length}):`, ...diff.symbols.removed.slice(0, 30).map((s) => `  - \`${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}\` — \`${s.path}:${s.line}\``));
  if (diff.symbols.modified.length) facts.push(`- Declarations modified (${diff.symbols.modified.length}):`, ...diff.symbols.modified.slice(0, 30).map((s) => `  - ${sym(s)}`));
  if (diff.dependencies.added.length) facts.push(`- Module dependencies added (${diff.dependencies.added.length}):`, ...diff.dependencies.added.slice(0, 25).map((e) => `  - \`${e.from}\` → \`${e.to}\``));
  if (diff.dependencies.removed.length) facts.push(`- Module dependencies removed (${diff.dependencies.removed.length}):`, ...diff.dependencies.removed.slice(0, 25).map((e) => `  - \`${e.from}\` → \`${e.to}\``));
  if (diff.packages.added.length) facts.push(`- Packages added: ${diff.packages.added.map((p) => `\`${p}\``).join(", ")}`);
  if (diff.packages.removed.length) facts.push(`- Packages removed: ${diff.packages.removed.map((p) => `\`${p}\``).join(", ")}`);
  if (diff.routes.added.length) facts.push(`- Routes added: ${diff.routes.added.map((r) => `\`${r.method} ${r.path}\``).join(", ")}`);
  if (diff.routes.removed.length) facts.push(`- Routes removed: ${diff.routes.removed.map((r) => `\`${r.method} ${r.path}\``).join(", ")}`);
  out.push(facts.length ? facts.join("\n") : "- No declaration, dependency, package or route changes were detected in the analyzable files.", "");

  out.push("## 3. Impact analysis", "");
  const section = (title: string, items: typeof spec.impact.dependents) => (items.length ? [`### ${title}`, "", bulletList(items, ctx), ""] : []);
  out.push(...section("Modules that now depend on changed code", spec.impact.dependents), ...section("Interfaces and contracts", spec.impact.interfaces), ...section("Tests likely affected", spec.impact.tests), ...section("Dependencies", spec.impact.dependencies), ...section("Risks and compatibility", spec.impact.risks));

  out.push("## 4. What this change enables", "", `${spec.explanation.text}${cite(spec.explanation.claimRefs, ctx)}`, "");
  if (spec.hypotheses.length) out.push("### Hypotheses (not verified)", "", spec.hypotheses.map((h) => `- ${h.text} — *basis: ${h.basis}*`).join("\n"), "");

  out.push("## Commits", "", compare.commits.slice(0, 60).map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.message}${c.author ? ` — ${c.author}` : ""}`).join("\n"), "");
  out.push("## Files", "", table(["Status", "Path", "+", "−"], diff.files.slice(0, 120).map((f) => [f.status, f.previousPath ? `${f.previousPath} → ${f.path}` : f.path, String(f.additions), String(f.deletions)])), "");
  const notes = footnotes(ctx);
  if (notes) out.push("## Evidence", "", notes);
  out.push(footer("Commit report", [before, after], claims));
  return out.join("\n");
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}
