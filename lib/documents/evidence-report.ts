import type { SourceSnapshot } from "@/lib/connectors/types";
import { formatCitation, type Claim } from "@/lib/evidence/evidence";
import { slideClaimRefs, type DeckSpec } from "@/lib/presentation/spec";

/** Markdown appendix listing every claim, its evidence and where it is used in the deck. */
export function buildEvidenceReport(snapshot: SourceSnapshot, claims: Claim[], spec: DeckSpec): string {
  const usage = new Map<string, string[]>();
  spec.slides.forEach((s, i) => {
    for (const ref of slideClaimRefs(s)) usage.set(ref, [...(usage.get(ref) ?? []), `${i + 1}`]);
  });
  const counts = { verified: 0, inferred: 0, unverified: 0 };
  for (const c of claims) counts[c.status]++;
  const base = `${snapshot.sourceUrl}/blob/${snapshot.version}`;

  const rows = claims.map((c) => {
    const cite = formatCitation(c);
    const link = cite && c.filePath ? `[${cite}](${base}/${c.filePath.split("/").map(encodeURIComponent).join("/")}${c.startLine ? `#L${c.startLine}-L${c.endLine}` : ""})` : "—";
    return `| ${c.ref} | ${c.status} | ${c.claimType} | ${escapeCell(c.claim)} | ${link} | ${usage.get(c.ref)?.join(", ") ?? ""} |`;
  });

  return [
    `# Evidence report: ${snapshot.displayName}`,
    "",
    `Source: ${snapshot.sourceUrl} · branch \`${snapshot.branch}\` · commit \`${snapshot.version}\``,
    "",
    `${claims.length} claims recorded: **${counts.verified} verified**, ${counts.inferred} inferred, ${counts.unverified} unverified.`,
    "",
    "- **Verified**: the cited lines directly support the claim (checked by GitFill against the file at this commit).",
    "- **Inferred**: a conclusion drawn from the cited lines.",
    "- **Unverified**: the citation could not be confirmed; not presented as fact.",
    "",
    "| Ref | Status | Type | Claim | Evidence | Slides |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
