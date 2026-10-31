import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { formatTimings, summarizeTimings, type TimingSummary } from "@/lib/agent/timings";
import { env, requireEnv } from "@/lib/config/env";
import { forgetSnapshots } from "@/lib/connectors/cache";
import { GitHubClient } from "@/lib/connectors/github/client";
import { answerGitHubQuestion } from "@/lib/understanding/ask";
import { askRequestSchema } from "@/lib/understanding/schemas";

/**
 * Latency benchmark for code questions: runs a fixed question set through the same pipeline
 * as the workspace ask/chat paths and saves per-step timings plus the answers.
 *
 *   npx tsx scripts/bench-ask.ts <github-url> [--branch b] [--questions file.txt] [--cold] [--label name]
 *   npx tsx scripts/bench-ask.ts --compare storage/bench/a.json storage/bench/b.json
 *
 * Without --cold only the first question pays for the snapshot; the rest hit the cache, like a chat session.
 */
const DEFAULT_QUESTIONS = [
  "What does this project do? Explain the core idea and the main components.",
  "Walk through the main request flow from the entry point to where data is stored.",
  "How is authentication handled?",
  "Where is configuration loaded, and which settings matter most?",
  "Which modules depend on each other the most, and why?",
];

interface Row {
  question: string;
  ok: boolean;
  error?: string;
  timings: TimingSummary;
  agent?: { turns: number; toolCalls: number };
  claims?: { total: number; verified: number };
  markdown?: string;
  events: MemoryRecorder["events"];
}

interface BenchFile {
  label: string;
  url: string;
  branch?: string;
  commit?: string;
  cold: boolean;
  model: string;
  startedAt: string;
  rows: Row[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) return compare(args.compare);
  if (!args.url) throw new Error("usage: tsx scripts/bench-ask.ts <github-url> [--branch b] [--questions file.txt] [--cold] [--label name]");
  requireEnv("MODEL_API_KEY");

  const questions = args.questions ? (await readFile(args.questions, "utf8")).split("\n").map((q) => q.trim()).filter((q) => q && !q.startsWith("#")) : DEFAULT_QUESTIONS;
  const client = new GitHubClient(env().GITHUB_TOKEN);
  const out: BenchFile = { label: args.label, url: args.url, branch: args.branch, cold: args.cold, model: env().MODEL_API_BASE_URL, startedAt: new Date().toISOString(), rows: [] };

  for (const [i, question] of questions.entries()) {
    if (args.cold) forgetSnapshots();
    const recorder = new MemoryRecorder();
    const started = Date.now();
    console.log(`\n[${i + 1}/${questions.length}] ${question}`);
    try {
      const { snapshot, result } = await answerGitHubQuestion({ url: args.url, branch: args.branch, client, request: askRequestSchema.parse({ question }), recorder });
      out.commit = snapshot.version;
      const totalMs = Date.now() - started;
      out.rows.push({
        question,
        ok: true,
        timings: summarizeTimings(recorder, totalMs),
        agent: result.agent,
        claims: { total: result.claims.length, verified: result.claims.filter((c) => c.status === "verified").length },
        markdown: result.markdown,
        events: recorder.events,
      });
      console.log(formatTimings(recorder, `Q${i + 1}`, totalMs));
    } catch (err) {
      const totalMs = Date.now() - started;
      out.rows.push({ question, ok: false, error: err instanceof Error ? err.message : String(err), timings: summarizeTimings(recorder, totalMs), events: recorder.events });
      console.log(formatTimings(recorder, `Q${i + 1} FAILED: ${err instanceof Error ? err.message : err}`, totalMs));
    }
  }

  printTable(out);
  const dir = path.join(env().ARTIFACT_STORAGE_PATH, "bench");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${args.label}-${out.startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(out, null, 2));
  console.log(`\nSaved ${file}  (answers included; compare later with --compare)`);
}

function printTable(b: BenchFile) {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  console.log(`\n=== ${b.label} — ${b.url}${b.commit ? ` @ ${b.commit.slice(0, 7)}` : ""} (${b.cold ? "cold every question" : "warm after first"}) ===`);
  console.log(["#", "total", "snapshot", "context", "retrieval", "loop", "model", "turns", "tools", "in tok", "out tok", "verified"].map((h) => h.padStart(9)).join(""));
  for (const [i, r] of b.rows.entries()) {
    const t = r.timings;
    const retrieval = r.events.filter((e) => e.name === "retrieve_context").reduce((a, e) => a + (e.durationMs ?? 0), 0);
    console.log(
      [
        `Q${i + 1}${r.ok ? "" : "!"}`,
        s(t.totalMs),
        s(t.steps.snapshot ?? 0),
        s(t.steps.build_context ?? 0),
        s(retrieval),
        s(t.steps.agent_loop ?? 0),
        s(t.model.ms),
        String(t.model.calls),
        String(t.tools.calls),
        t.model.inputTokens.toLocaleString("en-US"),
        t.model.outputTokens.toLocaleString("en-US"),
        r.claims ? `${r.claims.verified}/${r.claims.total}` : "-",
      ]
        .map((c) => c.padStart(9))
        .join(""),
    );
  }
  const ok = b.rows.filter((r) => r.ok).map((r) => r.timings.totalMs).sort((a, b) => a - b);
  if (ok.length) console.log(`median ${s(ok[Math.floor(ok.length / 2)]!)}, max ${s(ok[ok.length - 1]!)}, ${b.rows.length - ok.length} failed`);
}

async function compare([a, b]: [string, string]) {
  const [before, after] = (await Promise.all([readFile(a, "utf8"), readFile(b, "utf8")])).map((t) => JSON.parse(t) as BenchFile) as [BenchFile, BenchFile];
  printTable(before);
  printTable(after);
  console.log(`\n=== ${before.label} → ${after.label} ===`);
  for (const r of after.rows) {
    const prev = before.rows.find((p) => p.question === r.question);
    if (!prev) continue;
    const d = (x: number, y: number) => `${(x / 1000).toFixed(1)}s → ${(y / 1000).toFixed(1)}s (${y <= x ? "-" : "+"}${Math.abs(((y - x) / Math.max(x, 1)) * 100).toFixed(0)}%)`;
    console.log(`- ${r.question.slice(0, 70)}\n    total ${d(prev.timings.totalMs, r.timings.totalMs)}, input tokens ${prev.timings.model.inputTokens} → ${r.timings.model.inputTokens}`);
  }
}

function parseArgs(argv: string[]) {
  const args = { url: "", branch: undefined as string | undefined, questions: undefined as string | undefined, cold: false, label: "baseline", compare: undefined as [string, string] | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--branch") args.branch = argv[++i];
    else if (a === "--questions") args.questions = argv[++i];
    else if (a === "--label") args.label = argv[++i]!.replace(/[^\w.-]/g, "_");
    else if (a === "--cold") args.cold = true;
    else if (a === "--compare") args.compare = [argv[++i]!, argv[++i]!];
    else args.url = a;
  }
  return args;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
