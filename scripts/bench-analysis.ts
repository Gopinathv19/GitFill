/**
 * Token and quality benchmark for repository analysis: ingests a GitHub repository, runs the
 * analysis agent (with the light reader's digests) and prints tokens per step, turns and claim
 * counts. Compare models or efforts with MUSE_MODEL_<ROLE> / MUSE_EFFORT_<ROLE>.
 *
 *   ARTIFACT_STORAGE_PATH=/tmp/gf npx tsx scripts/bench-analysis.ts https://github.com/owner/repo
 */
import "dotenv/config";
import { MuseClient } from "@/lib/ai/client";
import { analyzeRepository } from "@/lib/agent/analyze";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { ingestGitHubRepository } from "@/lib/connectors/github/ingest";

async function main() {
  const usage = new Map<string, { calls: number; input: number; output: number; ms: number; model: string }>();
  const client = new MuseClient((e) => {
    const key = e.purpose.split(":")[0]!;
    const u = usage.get(key) ?? { calls: 0, input: 0, output: 0, ms: 0, model: e.model };
    u.calls++;
    u.input += e.usage.inputTokens;
    u.output += e.usage.outputTokens;
    u.ms += e.durationMs;
    usage.set(key, u);
  });
  const t0 = Date.now();
  const snapshot = await ingestGitHubRepository({ url: process.argv[2]! });
  console.log(`snapshot ${snapshot.displayName}@${snapshot.version.slice(0, 7)}: ${snapshot.files.length} files, ${snapshot.files.reduce((n, f) => n + f.content.length, 0)} chars`);
  const result = await analyzeRepository({
    client,
    snapshot,
    userRequest: "Deck type: Engineering walkthrough — How the system is built and how its key flows work, for engineers.\nAudience: Engineering team",
    recorder: new MemoryRecorder(),
  });
  const claims = result.claims;
  console.table([...usage.entries()].map(([purpose, u]) => ({ purpose, ...u, ms: Math.round(u.ms / 1000) + "s" })));
  console.log({
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    turns: result.turns,
    toolCalls: result.toolCalls,
    claims: claims.length,
    verified: claims.filter((c) => c.status === "verified").length,
    unverified: claims.filter((c) => c.status === "unverified").length,
    workflows: result.analysis.workflows.length,
    components: result.analysis.components.length,
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
