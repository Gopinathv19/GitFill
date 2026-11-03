/**
 * The `.gitfill/` folder GitFill keeps in a repository: what people add for GitFill to use, and what
 * GitFill writes back for people and coding agents.
 *
 *   .gitfill/README.md     what the folder is for (added with GitFill's first pull request)
 *   .gitfill/assets/       added by people: screenshots, logo, demo GIFs, brand.json, product notes
 *   .gitfill/docs/         written by GitFill: engineering and architecture docs, plus index.md
 *   .gitfill/knowledge/    written by GitFill: brainstorms from the web chat as specs a coding agent can
 *                          implement, plus index.md listing them with their status
 *
 * Older repositories may still have .gitfill/brainstorm/ (the previous name); it is read like knowledge/.
 */

export const GITFILL_DIR = ".gitfill";
export const ASSETS_DIR = `${GITFILL_DIR}/assets`;
export const DOCS_DIR = `${GITFILL_DIR}/docs`;
export const KNOWLEDGE_DIR = `${GITFILL_DIR}/knowledge`;
/** Where specs were written before knowledge/; still read, never written. */
export const LEGACY_BRAINSTORM_DIR = `${GITFILL_DIR}/brainstorm`;
export const GITFILL_README = `${GITFILL_DIR}/README.md`;
export const DOCS_INDEX = `${DOCS_DIR}/index.md`;
export const KNOWLEDGE_INDEX = `${KNOWLEDGE_DIR}/index.md`;

export function slugify(text: string, max = 60): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || "untitled";
}

export function docPath(title: string): string {
  return `${DOCS_DIR}/${slugify(title)}.md`;
}

export function knowledgePath(title: string, date: Date): string {
  return `${KNOWLEDGE_DIR}/${date.toISOString().slice(0, 10)}-${slugify(title)}.md`;
}

/** True for a spec file in knowledge/ (or the legacy brainstorm/), not the index. */
export function isKnowledgeSpec(path: string): boolean {
  return (path.startsWith(`${KNOWLEDGE_DIR}/`) || path.startsWith(`${LEGACY_BRAINSTORM_DIR}/`)) && path.endsWith(".md") && path !== KNOWLEDGE_INDEX;
}

export interface FrontMatter {
  /** What wrote the file and for whom: docs for people, knowledge specs for coding agents. */
  gitfill: "docs" | "knowledge";
  title: string;
  /** The commit the content was written from; later commits may make it stale. */
  source_commit: string;
  generated: string;
  status?: string;
}

export function withFrontMatter(fm: FrontMatter, body: string): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** Reads the simple `key: "value"` front matter written by withFrontMatter (and tolerates hand edits). */
export function readFrontMatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2]!.trim();
    try {
      out[kv[1]!] = typeof JSON.parse(raw) === "string" ? JSON.parse(raw) : raw;
    } catch {
      out[kv[1]!] = raw.replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}

export const GITFILL_README_TEXT = `# .gitfill

This folder is where GitFill keeps what it needs to explain this repository, and what it writes back.

| Folder | Who writes it | What it is for |
|---|---|---|
| \`assets/\` | You | Screenshots, the logo, demo GIFs, \`brand.json\` (colours, fonts, tagline) and product notes in Markdown. GitFill uses them when it writes the README, docs, decks and videos. Images are linked from the README, so keep them here. |
| \`docs/\` | GitFill | Engineering and architecture docs written from the code, each with the commit it was written from. \`index.md\` lists them. |
| \`knowledge/\` | GitFill | Ideas worked out in GitFill's chat, written as specs for a coding agent: goal, decisions, open questions, the code involved, tasks and acceptance criteria. \`index.md\` lists them with their status. |

GitFill never treats \`docs/\` or \`knowledge/\` as evidence about the code: it always re-reads the code itself.

**For coding agents (Claude Code, Codex, Cursor…):** start at \`knowledge/index.md\`. A spec with \`status: "ready"\` is a task you can implement. Read the whole spec first, resolve its open questions with the team, follow its tasks in order and check every acceptance criterion before you finish. When it is done, set its \`status\` to \`"done"\` in the spec and the index.
`;
