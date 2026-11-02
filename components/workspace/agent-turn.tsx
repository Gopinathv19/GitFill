"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { DataView, hasData } from "@/components/shared/data-view";
import { Markdown } from "@/components/shared/markdown";
import { describeActivity, type Activity } from "@/lib/client/activity";
import type { Segment, Turn, WorkItem } from "@/lib/client/turn";
import { cn } from "@/lib/utils";

/** While an answer streams, the diagram's JSON block is not useful to read: show a placeholder. */
function readableDraft(draft: string): string {
  return draft
    // Diagrams are drawn once the answer is complete; mid-stream they are half-written and invalid.
    .replace(/```(?:diagram|mermaid)[\s\S]*?(```|$)/g, "\n\n*Drawing a diagram…*\n\n")
    .replace(/^#{1,4}\s+(Not verified|Ask next)[\s\S]*$/im, "")
    .trim();
}

const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** Ticks once a second while something is running, so open timers count up. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** A muted, optionally expandable header line: "▸ Thought for 3s", "▾ Worked for 7s". */
function Disclosure({ label, open, onToggle, running, children }: { label: string; open: boolean; onToggle?: () => void; running?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? open : undefined}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors enabled:hover:text-foreground"
      >
        {running ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90", !onToggle && "opacity-0")} />}
        {label}
      </button>
      {open && children ? <div className="ml-[0.4rem] mt-2 border-l pl-4">{children}</div> : null}
    </div>
  );
}

function IoPanel({ label, value, tone }: { label: string; value: unknown; tone?: "error" }) {
  if (!hasData(value)) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/40 px-3 py-2.5">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {tone === "error" ? <p className="text-[12.5px] text-destructive">{String(value)}</p> : <DataView value={value} />}
    </div>
  );
}

function StepRow({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false);
  const label = describeActivity(activity) ?? activity.name;
  const running = activity.status === "started";
  const failed = activity.status === "failed";
  const hasDetail = !running && (activity.input || activity.output || activity.error);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        className={cn("group flex w-full min-w-0 items-start gap-1.5 py-0.5 text-left text-[13px]", running ? "text-foreground" : failed ? "text-destructive" : "text-muted-foreground enabled:hover:text-foreground")}
      >
        {running ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : null}
        <span className="min-w-0 break-words">{label}</span>
        {hasDetail ? <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100", open && "rotate-90 opacity-100")} /> : null}
        {!running && activity.durationMs !== undefined && activity.durationMs >= 1000 ? <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">{(activity.durationMs / 1000).toFixed(1)}s</span> : null}
      </button>
      {open ? (
        <div className="mb-2 mt-1 space-y-2">
          <IoPanel label="Input" value={activity.input} />
          {failed ? <IoPanel label="Error" value={activity.error} tone="error" /> : <IoPanel label="Output" value={activity.output} />}
        </div>
      ) : null}
    </li>
  );
}

function WorkGroup({ segment, live, now }: { segment: Extract<Segment, { kind: "work" }>; live: boolean; now: number }) {
  const running = live && segment.endedAt === null;
  const [open, setOpen] = useState<boolean | null>(null);
  // Open while running; afterwards collapsed unless the user opened it.
  const isOpen = open ?? running;
  const steps = segment.items.filter((i): i is Extract<WorkItem, { kind: "step" }> => i.kind === "step");
  const elapsed = secs((segment.endedAt ?? now) - segment.startedAt);
  const failed = steps.filter((s) => s.activity.status === "failed").length;
  const label = running ? `Working · ${elapsed}s` : `Worked for ${elapsed}s · ${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;
  return (
    <Disclosure label={label} open={isOpen} onToggle={() => setOpen(!isOpen)} running={running}>
      <ol className="space-y-0.5">
        {segment.items.map((it) =>
          it.kind === "step" ? (
            <StepRow key={it.activity.id} activity={it.activity} />
          ) : (
            <li key={it.id} className="flex items-center gap-1.5 py-0.5 text-[13px] italic text-muted-foreground/80">
              {live && it.endedAt === null ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {live && it.endedAt === null ? "Thinking…" : `Thought for ${secs((it.endedAt ?? now) - it.startedAt)}s`}
            </li>
          ),
        )}
      </ol>
    </Disclosure>
  );
}

/**
 * An agent turn without boxes: thinking time, the agent's narration, collapsible "Worked for"
 * groups whose steps open to their real input and output, then the answer. Used live while the
 * turn streams, and afterwards above the stored answer.
 */
export function AgentTurn({ turn, live = false }: { turn: Turn; live?: boolean }) {
  // Live turns tick so open timers count up; finished turns are static.
  const now = useNow(live);
  const draft = live ? readableDraft(turn.draft) : "";
  const idle = live && !turn.segments.length && !draft;
  return (
    <div className="space-y-3" aria-live={live ? "polite" : undefined}>
      {idle ? <Disclosure label="Thinking…" open={false} running /> : null}
      {turn.segments.map((s) => {
        if (s.kind === "narration") return <Markdown key={s.id} className="text-sm">{s.text}</Markdown>;
        if (s.kind === "thought") {
          const open = live && s.endedAt === null;
          return <Disclosure key={s.id} label={open ? "Thinking…" : `Thought for ${secs((s.endedAt ?? now) - s.startedAt)}s`} open={false} running={open} />;
        }
        return <WorkGroup key={s.id} segment={s} live={live} now={now} />;
      })}
      {draft ? (
        <div>
          <Markdown className="text-sm">{draft}</Markdown>
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/60 align-text-bottom" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
