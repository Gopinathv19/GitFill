import { numberLines } from "@/lib/ai/prompts";
import { env, memoraConfigured } from "@/lib/config/env";
import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";
import { MemoraClient, type MemoraChunk } from "./client";

/**
 * Repository retrieval through Memora. A snapshot (repository at an exact commit) becomes
 * one Memora subject; its files are bundled into Markdown documents whose numbered
 * headings carry the file paths and whose code lines carry line numbers, so every chunk
 * Memora returns maps back to path and line range. Indexing is idempotent per commit.
 */
export interface RetrievedPassage {
  path: string;
  startLine: number | null;
  endLine: number | null;
  content: string;
  score: number;
}

export interface RetrievalResult {
  status: "ready" | "indexing" | "unavailable";
  passages: RetrievedPassage[];
  /** Memora's own grounded answer (NVIDIA model), shown as a hint, never as GitFill's answer. */
  answer: string | null;
  latencyMs: number;
  detail?: string;
}

export interface SnapshotRetriever {
  readonly backend: "memora";
  ensureIndexed(opts?: { waitMs?: number }): Promise<"ready" | "indexing" | "unavailable">;
  retrieve(query: string, opts?: { limit?: number }): Promise<RetrievalResult>;
  /** Files ranked by how much retrieved content came from them. */
  rankFiles(query: string): Promise<string[]>;
}

const BUNDLE_TARGET_CHARS = 60_000;
const BUNDLE_MAX_CHARS = 90_000;
const POLL_MS = 3_000;

interface IndexState {
  subjectId: string;
  status: "ready" | "indexing" | "unavailable";
  checkedAt: number;
}

const g = globalThis as unknown as { __gitfillMemoraIndex?: Map<string, IndexState> };
const states = (g.__gitfillMemoraIndex ??= new Map<string, IndexState>());

export function subjectExternalId(snapshot: Pick<SourceSnapshot, "connector" | "displayName" | "version">): string {
  return `gitfill:${snapshot.connector}:${snapshot.displayName}@${snapshot.version}`.slice(0, 255);
}

/** Returns a retriever when Memora is configured and the snapshot has a stable version; otherwise null. */
export function retrieverFor(snapshot: SourceSnapshot, client: MemoraClient | null = MemoraClient.fromEnv()): SnapshotRetriever | null {
  if (!client || !memoraConfigured()) return null;
  if (snapshot.connector === "local" && snapshot.version === "working-tree") return null;
  return new MemoraRetriever(client, snapshot);
}

class MemoraRetriever implements SnapshotRetriever {
  readonly backend = "memora" as const;
  private readonly key: string;

  constructor(
    private readonly client: MemoraClient,
    private readonly snapshot: SourceSnapshot,
  ) {
    this.key = subjectExternalId(snapshot);
  }

  async ensureIndexed(opts: { waitMs?: number } = {}): Promise<"ready" | "indexing" | "unavailable"> {
    const waitMs = opts.waitMs ?? env().MEMORA_INDEX_TIMEOUT_MS;
    const cached = states.get(this.key);
    if (cached?.status === "ready") return "ready";
    try {
      const subjectId = cached?.subjectId ?? (await this.findOrCreateSubject());
      const sources = await this.client.listSources(subjectId);
      if (sources.length === 0) {
        const bundles = bundleSnapshot(this.snapshot);
        for (const b of bundles) await this.client.uploadMarkdown(subjectId, b.filename, b.markdown);
      }
      states.set(this.key, { subjectId, status: "indexing", checkedAt: Date.now() });
      const ready = await this.waitForCoverage(subjectId, waitMs);
      states.set(this.key, { subjectId, status: ready ? "ready" : "indexing", checkedAt: Date.now() });
      return ready ? "ready" : "indexing";
    } catch (err) {
      console.warn(`[memora] indexing ${this.key} failed:`, err instanceof Error ? err.message : err);
      states.set(this.key, { subjectId: cached?.subjectId ?? "", status: "unavailable", checkedAt: Date.now() });
      return "unavailable";
    }
  }

  async retrieve(query: string, opts: { limit?: number } = {}): Promise<RetrievalResult> {
    const started = Date.now();
    const status = await this.ensureIndexed({ waitMs: 0 });
    const state = states.get(this.key);
    if (status === "unavailable" || !state?.subjectId) return { status: "unavailable", passages: [], answer: null, latencyMs: Date.now() - started, detail: "Memora index unavailable." };
    try {
      const res = await this.client.query(query.slice(0, 2000), state.subjectId);
      const passages = res.chunks.map(toPassage).filter((p): p is RetrievedPassage => p !== null).slice(0, opts.limit ?? 8);
      if (status === "indexing" && passages.length) states.set(this.key, { ...state, status: "ready" });
      return { status: passages.length ? "ready" : status, passages, answer: res.answer || null, latencyMs: Date.now() - started };
    } catch (err) {
      return { status: "unavailable", passages: [], answer: null, latencyMs: Date.now() - started, detail: err instanceof Error ? err.message : "query failed" };
    }
  }

  async rankFiles(query: string): Promise<string[]> {
    const { passages } = await this.retrieve(query, { limit: 12 });
    const scores = new Map<string, number>();
    passages.forEach((p, i) => scores.set(p.path, (scores.get(p.path) ?? 0) + (p.score || 1) * (1 - i / 24)));
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
  }

  private async findOrCreateSubject(): Promise<string> {
    const existing = (await this.client.listSubjects()).find((s) => s.external_id === this.key);
    if (existing) return existing.id;
    const me = await this.client.whoami();
    return (await this.client.createSubject(me.application_id, this.key)).id;
  }

  private async waitForCoverage(subjectId: string, waitMs: number): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const sources = await this.client.listSources(subjectId);
      if (sources.some((s) => s.status === "failed") && sources.every((s) => s.status !== "processing" && s.status !== "pending")) {
        return sources.some((s) => s.status === "completed");
      }
      const done = sources.length > 0 && sources.every((s) => s.status === "completed");
      if (done) {
        const statuses = await Promise.all(sources.map((s) => this.client.embeddingStatus(s.id).catch(() => null)));
        const total = statuses.reduce((n, s) => n + (s?.total_chunks ?? 0), 0);
        const embedded = statuses.reduce((n, s) => n + (s?.embedded ?? 0), 0);
        if (total > 0 && embedded >= total) return true;
        if (total > 0 && statuses.every((s) => s && s.pending === 0 && s.processing === 0 && s.embedded === 0)) {
          await this.client.embedSubject(subjectId).catch(() => undefined);
        }
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

/** Maps a chunk back to its file through the bundle's heading and line-number prefixes. */
export function toPassage(chunk: MemoraChunk): RetrievedPassage | null {
  const heading = [...chunk.section_path].reverse().find((h) => /^\d+\.\s+\S/.test(h)) ?? null;
  const fromHeading = heading ? heading.replace(/^\d+\.\s+/, "").trim() : null;
  const fromContent = /(?:^|\n)#+\s*\d+\.\s+(\S+)/.exec(chunk.content)?.[1] ?? /File `([^`]+)`/.exec(chunk.content)?.[1] ?? null;
  const path = fromHeading ?? fromContent;
  if (!path) return null;
  const numbers = [...chunk.content.matchAll(/(?:^|\n)\s*(\d+)\| /g)].map((m) => Number(m[1]));
  const score = chunk.rerank_score ?? chunk.similarity;
  return { path, startLine: numbers.length ? Math.min(...numbers) : null, endLine: numbers.length ? Math.max(...numbers) : null, content: chunk.content.slice(0, 4000), score };
}

/** Groups files into Markdown bundles with numbered headings per file, within Memora-friendly sizes. */
export function bundleSnapshot(snapshot: Pick<SourceSnapshot, "displayName" | "version" | "files">): Array<{ filename: string; markdown: string; paths: string[] }> {
  const bundles: Array<{ filename: string; markdown: string; paths: string[] }> = [];
  let current: string[] = [];
  let paths: string[] = [];
  let size = 0;
  let n = 0;
  const flush = () => {
    if (!current.length) return;
    bundles.push({ filename: `${safe(snapshot.displayName)}-${snapshot.version.slice(0, 7)}-part${bundles.length + 1}.md`, markdown: `# ${snapshot.displayName} @ ${snapshot.version.slice(0, 7)} (part ${bundles.length + 1})\n\n${current.join("\n\n")}\n`, paths });
    current = [];
    paths = [];
    size = 0;
  };
  for (const f of sortedForBundling(snapshot.files)) {
    const section = fileSection(++n, f);
    if (size + section.length > BUNDLE_TARGET_CHARS && current.length) flush();
    if (section.length > BUNDLE_MAX_CHARS) {
      // Very large file: split by line ranges so each section stays within bounds.
      const lines = f.content.split("\n");
      const per = 600;
      for (let start = 0; start < lines.length; start += per) {
        const part = `## ${n}. ${f.path}\n\nFile \`${f.path}\` lines ${start + 1}-${Math.min(start + per, lines.length)} of ${lines.length}.\n\n\`\`\`\n${numberLines(lines.slice(start, start + per), start + 1)}\n\`\`\``;
        if (size + part.length > BUNDLE_TARGET_CHARS && current.length) flush();
        current.push(part);
        paths.push(f.path);
        size += part.length;
        n++;
      }
      continue;
    }
    current.push(section);
    paths.push(f.path);
    size += section.length;
  }
  flush();
  return bundles;
}

function fileSection(n: number, f: SourceFile): string {
  return `## ${n}. ${f.path}\n\nFile \`${f.path}\` (${f.category}, ${f.lineCount} lines).\n\n\`\`\`\n${numberLines(f.content.split("\n"))}\n\`\`\``;
}

function sortedForBundling(files: SourceFile[]): SourceFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}
