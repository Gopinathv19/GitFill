/** One step of a live agent turn, as streamed by POST /api/sessions/:id/messages (see LiveEvent). */
export interface Activity {
  id: string;
  kind: "tool" | "step";
  name: string;
  status: "started" | "succeeded" | "failed";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

/** Merges a streamed activity update into the list (same id = same step). */
export function upsertActivity(list: Activity[], update: Activity): Activity[] {
  const i = list.findIndex((a) => a.id === update.id);
  if (i === -1) return [...list, update];
  const next = [...list];
  next[i] = { ...next[i]!, ...update, input: update.input ?? next[i]!.input };
  return next;
}

/** Plain-language label for a step, or null for internal steps not worth showing. */
export function describeActivity(a: Activity): string | null {
  const i = a.input ?? {};
  const o = a.output ?? {};
  const done = a.status === "succeeded";
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const lines = i.start_line ? `:${i.start_line}${i.end_line ? `-${i.end_line}` : ""}` : "";
  switch (a.name) {
    case "thinking":
      return a.status === "started" ? "Thinking" : `Thought for ${Math.max(1, Math.round((a.durationMs ?? 0) / 1000))}s`;
    case "ask_codebase":
      return `Investigating “${str(i.question).slice(0, 90)}”`;
    case "snapshot":
      return done ? (o.cache === "hit" ? `Loaded repository from cache (${o.files} files @ ${o.commit})` : `Loaded repository (${o.files} files @ ${o.commit})`) : "Loading repository";
    case "github_tree":
      return done ? `Read file tree (${o.entries} entries)` : "Reading file tree";
    case "github_files":
      return done ? `Downloaded ${o.fetched} files` : `Downloading ${i.files} files`;
    case "build_context":
      return done ? `Mapped ${o.declarations} declarations and ${o.imports} imports` : "Mapping declarations and imports";
    case "retrieve_context":
      return `Searched the semantic index${i.query ? ` for “${str(i.query).slice(0, 60)}”` : ""}`;
    case "read_file":
      return `Read ${str(i.path)}${lines}`;
    case "search_code":
      return `Searched for “${str(i.query)}”`;
    case "list_directory":
      return `Listed ${str(i.path) || "the repository root"}`;
    case "outline_file":
      return `Outlined ${str(i.path)}`;
    case "find_symbol":
      return `Found definition of ${str(i.name)}`;
    case "find_references":
      return `Found references to ${str(i.name)}`;
    case "call_graph":
      return `Traced calls of ${str(i.name)}`;
    case "module_graph":
      return "Read the module dependency graph";
    case "list_routes":
      return "Listed HTTP routes";
    case "verify_and_render":
      return done ? `Verified citations: ${o.verified}/${o.citations} verified against the code` : "Verifying citations against the code";
    case "start_handbook":
      return "Started a handbook job";
    case "start_commit_comparison":
      return "Started a commit comparison";
    case "start_reuse_brief":
      return "Started an implementation brief";
    case "start_presentation":
      return "Started a presentation";
    case "revise_presentation":
      return "Started a presentation revision";
    case "agent_loop":
    case "reply":
    case "render":
      return null;
    default:
      return a.name.replace(/_/g, " ");
  }
}
