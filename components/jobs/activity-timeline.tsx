"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface JobEvent {
  id: string;
  type: "tool" | "model" | "step";
  name: string;
  status: "started" | "succeeded" | "failed";
  model: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number | null;
  startedAt?: string;
}

/** Which phase of a job an event belongs to, by its recorded name. */
function phaseOf(e: JobEvent): string | null {
  const n = e.name;
  if (/^(inspect_repository|list_directory|read_file|search_code|grep|find_symbol|find_definition|outline_file|call_graph|list_files|record_claims|finish_analysis|finish_exploration|index_repository)/.test(n) || n.startsWith("analyze_repository") || n.startsWith("explore")) return "Analyzing repository";
  if (/^(plan_outline|compose_slide|plan_presentation|plan_revision)/.test(n)) return "Planning slides";
  if (n === "generate_illustration") return "Cover artwork";
  if (/^(render_slides|check_layout|visual_review|repair_slide|generate_pptx)/.test(n)) return "Rendering and validating";
  if (/^(generate_readme|write_readme|readme|compose_document|compose_handbook|compare|finish_comparison|compose)/.test(n)) return "Writing documents";
  return null;
}

const TITLES: Record<string, string> = {
  inspect_repository: "Inspect repository",
  list_directory: "List directory",
  read_file: "Read",
  search_code: "Search code",
  grep: "Search code",
  find_symbol: "Find symbol",
  find_definition: "Find definition",
  outline_file: "Outline file",
  call_graph: "Call graph",
  record_claims: "Record claims",
  finish_analysis: "Finish analysis",
  plan_outline: "Plan the deck outline",
  plan_presentation: "Plan the deck",
  plan_revision: "Plan the revision",
  compose_slide: "Compose slide",
  generate_illustration: "Generate cover artwork",
  render_slides: "Render slides",
  check_layout: "Measure every page",
  visual_review: "Visual review",
  repair_slide: "AI repair",
  repair_slide_rule: "Rule repair",
  generate_pptx: "Package .pptx",
  generate_readme: "Write README.md",
};

/** Steps that repeat back to back collapse into one row. */
const GROUP_LABEL: Record<string, (n: number, items: JobEvent[]) => string> = {
  read_file: (n) => `Read ${n} files`,
  list_directory: (n) => `Listed ${n} directories`,
  search_code: (n) => `Ran ${n} searches`,
  grep: (n) => `Ran ${n} searches`,
  record_claims: (n, items) => `Recorded claims in ${n} batches · ${items.reduce((a, e) => a + (Array.isArray(e.output) ? e.output.length : 0), 0)} claims`,
  compose_slide: (n) => `Composed ${n} slides`,
  visual_review: (n, items) => {
    const scores = items.map((e) => obj(e.output).score).filter((s): s is number => typeof s === "number");
    return `Reviewed ${n} slides${scores.length ? ` · avg ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}/10` : ""}`;
  },
  repair_slide: (n) => `AI repaired ${n} slides`,
  repair_slide_rule: (n) => `Applied ${n} rule repairs`,
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function humanize(name: string): string {
  const t = name.replace(/:.*/, "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** One-line summary of what a step did, from its recorded input and output. */
function describe(e: JobEvent): string {
  const i = obj(e.input);
  const o = obj(e.output);
  if (e.status === "failed") return e.error ?? "failed";
  switch (e.name) {
    case "inspect_repository":
      return `${str(o.repository || i.url)}${o.commit ? ` @ ${str(o.commit)}` : ""}${o.files ? ` · ${str(o.files)} of ${str(o.tree)} files selected` : ""}`;
    case "read_file":
    case "list_directory":
    case "outline_file":
      return str(i.path ?? o.path);
    case "search_code":
    case "grep":
      return str(i.query ?? i.pattern);
    case "record_claims": {
      const list = Array.isArray(e.output) ? (e.output as Array<{ status?: string }>) : [];
      return list.length ? `${list.length} claims · ${list.filter((c) => c.status === "verified").length} verified` : str(o.error);
    }
    case "plan_outline":
      return `${str(o.title)}${Array.isArray(o.slides) ? ` · ${o.slides.length} slides` : ""}`;
    case "compose_slide":
      return `${str(i.slide)} · ${str(o.title || i.title).replace(/\*/g, "")}`;
    case "render_slides":
      return `Round ${Number(i.round ?? 0) + 1}${o.pages ? ` · ${str(o.pages)} pages` : ""}`;
    case "check_layout": {
      const issues = Array.isArray(o.issues) ? (o.issues as string[]) : [];
      return issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues.slice(0, 4).join(", ")}${issues.length > 4 ? "…" : ""}` : "Every check passed";
    }
    case "visual_review":
      return `${str(i.slide)}${typeof o.score === "number" ? ` · ${o.score}/10` : ""}${Array.isArray(o.issues) && o.issues.length ? ` · ${(o.issues as string[]).join(", ")}` : ""}`;
    case "repair_slide":
      return `${str(i.slide)}${Array.isArray(i.issues) ? ` · ${(i.issues as string[]).join(", ")}` : ""}`;
    case "repair_slide_rule":
      return `${str(i.slide)} · ${str(e.output)}`;
    case "generate_pptx":
      return typeof o.bytes === "number" ? `${(o.bytes / 1024 / 1024).toFixed(1)} MB` : "";
    case "finish_analysis":
    case "finish_exploration":
    case "finish_comparison":
      return o.accepted ? "Accepted" : str(o.error);
    case "generate_readme":
      return typeof o.characters === "number" ? `${o.characters.toLocaleString()} characters${Array.isArray(o.unknownPaths) && o.unknownPaths.length ? ` · ${o.unknownPaths.length} paths not found in the repository` : ""}` : "";
    case "generate_illustration":
      return typeof o.bytes === "number" ? `${Math.round(o.bytes / 1024)} KB` : str(i.prompt);
    default: {
      const s = e.output ?? e.input;
      return typeof s === "string" ? s : s ? short(JSON.stringify(s)) : "";
    }
  }
}

/** Elapsed time from the first start to the last finish: grouped steps often ran in parallel. */
function wallClock(items: JobEvent[]): number {
  if (!items.every((e) => e.startedAt)) return items.reduce((a, e) => a + (e.durationMs ?? 0), 0);
  const starts = items.map((e) => new Date(e.startedAt!).getTime());
  const ends = items.map((e, i) => starts[i]! + (e.durationMs ?? 0));
  return Math.max(...ends) - Math.min(...starts);
}

const seconds = (ms: number | null | undefined) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

type Row =
  | { kind: "phase"; id: string; label: string }
  | { kind: "thought"; id: string; durationMs: number; calls: JobEvent[]; running: boolean }
  | { kind: "step"; id: string; event: JobEvent }
  | { kind: "group"; id: string; name: string; items: JobEvent[] };

/**
 * Model calls made inside a recorded step (composing a page, reviewing an image, writing the
 * README) are already timed by that step. Only an agent's reasoning turns between tool calls
 * ("…:turnN") are shown, as "Thought for Ns".
 */
const isAgentTurn = (e: JobEvent) => e.type === "model" && /:turn\d+(:|$)/.test(e.name);

function buildRows(events: JobEvent[]): Row[] {
  const rows: Row[] = [];
  let phase: string | null = null;
  for (const e of events) {
    if (e.type === "model" && !isAgentTurn(e) && e.status !== "failed") continue;
    const p = phaseOf(e);
    if (p && p !== phase) {
      phase = p;
      rows.push({ kind: "phase", id: `phase-${e.id}`, label: p });
    }
    const last = rows[rows.length - 1];
    if (e.type === "model") {
      if (last?.kind === "thought") {
        last.durationMs += e.durationMs ?? 0;
        last.calls.push(e);
        last.running ||= e.status === "started";
      } else rows.push({ kind: "thought", id: e.id, durationMs: e.durationMs ?? 0, calls: [e], running: e.status === "started" });
      continue;
    }
    const groupable = e.name in GROUP_LABEL;
    if (groupable && last?.kind === "group" && last.name === e.name) last.items.push(e);
    else if (groupable && last?.kind === "step" && last.event.name === e.name) rows[rows.length - 1] = { kind: "group", id: last.id, name: e.name, items: [last.event, e] };
    else rows.push({ kind: "step", id: e.id, event: e });
  }
  return rows;
}

/** Status dot on the timeline rail. */
function Dot({ status, muted = false }: { status: JobEvent["status"] | "mixed"; muted?: boolean }) {
  if (status === "started") return <Loader2 className="size-3.5 animate-spin text-sky-500" />;
  return (
    <span
      className={cn(
        "block size-2.5 rounded-full ring-4 ring-background",
        muted ? "bg-muted-foreground/40" : status === "failed" ? "bg-destructive" : status === "mixed" ? "bg-amber-500" : "bg-emerald-500",
      )}
    />
  );
}

function IoBox({ label, value, tone }: { label: string; value: unknown; tone?: "error" }) {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="grid grid-cols-[3rem_1fr] border-t first:border-t-0">
      <span className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{label}</span>
      <pre className={cn("max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11.5px] leading-relaxed", tone === "error" ? "text-destructive" : "text-foreground/85")}>{text}</pre>
    </div>
  );
}

function Detail({ event }: { event: JobEvent }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-muted/40">
      <IoBox label="IN" value={event.input} />
      {event.status === "failed" ? <IoBox label="ERR" value={event.error} tone="error" /> : <IoBox label="OUT" value={event.output} />}
      {event.model ? <p className="border-t px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{event.model}</p> : null}
    </div>
  );
}

function Item({ dot, title, desc, duration, expandable, open, onToggle, children, muted = false }: {
  dot: React.ReactNode;
  title: React.ReactNode;
  desc?: string;
  duration?: string;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <li className="relative pl-8">
      <span className="absolute left-0 top-[0.4rem] grid w-[1.1rem] place-items-center">{dot}</span>
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className={cn("group flex w-full items-start gap-3 rounded-md py-1 text-left", expandable && "cursor-pointer")}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("flex items-center gap-1 text-sm", muted ? "text-muted-foreground" : "font-semibold")}>
            {title}
            {expandable ? <ChevronRight className={cn("size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100", open && "rotate-90 opacity-100")} /> : null}
          </span>
          {desc ? <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{desc}</span> : null}
        </span>
        {duration ? <span className="shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">{duration}</span> : null}
      </button>
      {open ? children : null}
    </li>
  );
}

/**
 * The job's recorded work as a timeline, newest at the bottom: each tool call, page composition,
 * render and repair as a step with its real input and output, model time as "Thought for Ns",
 * and repeated steps folded into one row. Nothing here is simulated.
 */
export function ActivityTimeline({ events, running, currentStage }: { events: JobEvent[]; running: boolean; currentStage?: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rows = buildRows(events);

  if (!rows.length) {
    return (
      <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[0.53rem] before:top-2 before:w-px before:bg-border">
        <Item dot={<Loader2 className="size-3.5 animate-spin text-sky-500" />} title="Waiting for the worker to pick up this job…" muted />
      </ol>
    );
  }

  return (
    <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[0.53rem] before:top-3 before:w-px before:bg-border">
      {rows.map((r) => {
        if (r.kind === "phase") {
          return (
            <li key={r.id} className="pb-1 pl-8 pt-4 first:pt-0">
              <div className="relative flex h-5 items-center">
                <span className="absolute -left-[1.78rem] top-1/2 block size-2 -translate-y-1/2 rotate-45 bg-foreground ring-4 ring-background" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.label}</span>
              </div>
            </li>
          );
        }
        if (r.kind === "thought") {
          const tokens = r.calls.reduce((a, c) => a + Number(obj(c.output).outputTokens ?? 0), 0);
          const failed = r.calls.find((c) => c.status === "failed");
          return (
            <Item
              key={r.id}
              dot={<Dot status={r.running ? "started" : failed ? "failed" : "succeeded"} muted={!r.running && !failed} />}
              title={r.running ? "Thinking…" : `Thought for ${seconds(r.durationMs) || "a moment"}`}
              desc={failed ? failed.error ?? undefined : r.calls.length > 1 ? `${r.calls.length} model calls${tokens ? ` · ${tokens.toLocaleString()} tokens written` : ""}` : undefined}
              muted
              expandable={!r.running}
              open={open.has(r.id)}
              onToggle={() => toggle(r.id)}
            >
              <ul className="mt-1 space-y-0.5 pb-1 font-mono text-[11.5px] text-muted-foreground">
                {r.calls.map((c) => (
                  <li key={c.id} className={cn(c.status === "failed" && "text-destructive")}>
                    {c.name} · {c.model} · {seconds(c.durationMs)}
                    {obj(c.output).inputTokens ? ` · ${Number(obj(c.output).inputTokens).toLocaleString()} in / ${Number(obj(c.output).outputTokens).toLocaleString()} out` : ""}
                    {c.error ? ` · ${c.error}` : ""}
                  </li>
                ))}
              </ul>
            </Item>
          );
        }
        if (r.kind === "group") {
          const status = r.items.some((e) => e.status === "started") ? "started" : r.items.every((e) => e.status === "failed") ? "failed" : r.items.some((e) => e.status === "failed") ? "mixed" : "succeeded";
          const total = wallClock(r.items);
          return (
            <Item
              key={r.id}
              dot={<Dot status={status} />}
              title={GROUP_LABEL[r.name]!(r.items.length, r.items)}
              desc={r.items.map(describe).filter(Boolean).slice(0, 3).join(" · ") + (r.items.length > 3 ? " …" : "")}
              duration={seconds(total)}
              expandable
              open={open.has(r.id)}
              onToggle={() => toggle(r.id)}
            >
              <ul className="mb-2 mt-1 space-y-1 border-l pl-3">
                {r.items.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => toggle(e.id)} className="flex w-full items-start gap-2 text-left text-[13px]">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", e.status === "failed" ? "bg-destructive" : e.status === "started" ? "bg-sky-500" : "bg-emerald-500")} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground">{describe(e) || TITLES[e.name] || humanize(e.name)}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{seconds(e.durationMs)}</span>
                    </button>
                    {open.has(e.id) ? <Detail event={e} /> : null}
                  </li>
                ))}
              </ul>
            </Item>
          );
        }
        const e = r.event;
        return (
          <Item
            key={r.id}
            dot={<Dot status={e.status} />}
            title={TITLES[e.name] ?? humanize(e.name)}
            desc={describe(e)}
            duration={e.status === "started" ? "" : seconds(e.durationMs)}
            expandable={e.status !== "started"}
            open={open.has(r.id)}
            onToggle={() => toggle(r.id)}
          >
            <Detail event={e} />
          </Item>
        );
      })}
      {running ? <Item dot={<Loader2 className="size-3.5 animate-spin text-sky-500" />} title={`${currentStage ?? "Working"}…`} muted /> : null}
    </ol>
  );
}
