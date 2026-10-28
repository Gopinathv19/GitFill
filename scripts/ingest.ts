import "dotenv/config";
import { ingestGitHubRepository } from "@/lib/connectors/github/ingest";

/** Dev utility: `npx tsx scripts/ingest.ts <github-url> [branch]` prints what the connector would read. */
async function main() {
  const [url, branch] = process.argv.slice(2);
  if (!url) throw new Error("usage: tsx scripts/ingest.ts <github-url> [branch]");
  const snap = await ingestGitHubRepository({ url, branch });
  console.log(`${snap.displayName} @ ${snap.branch} ${snap.version.slice(0, 10)}`);
  console.log(snap.stats);
  for (const f of snap.files) console.log(`${f.category.padEnd(14)} ${String(f.sizeBytes).padStart(7)}  ${f.path}`);
  const skipped: Record<string, number> = {};
  for (const i of snap.inventory) if (!i.selected) skipped[i.skipReason!] = (skipped[i.skipReason!] ?? 0) + 1;
  console.log("skipped:", skipped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
