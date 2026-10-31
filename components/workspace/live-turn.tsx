"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { Markdown } from "@/components/shared/markdown";
import { describeActivity, type Activity } from "@/lib/client/activity";
import { cn } from "@/lib/utils";

/** While an answer streams, the diagram's JSON block is not useful to read: show a placeholder. */
function readableDraft(draft: string): string {
  return draft
    .replace(/```diagram[\s\S]*?(```|$)/g, "\n\n*Drawing a diagram…*\n\n")
    .replace(/^#{1,4}\s+(Not verified|Ask next)[\s\S]*$/im, "")
    .trim();
}

function Steps({ activities }: { activities: Activity[] }) {
  const visible = activities.map((a) => ({ a, label: describeActivity(a) })).filter((x): x is { a: Activity; label: string } => x.label !== null);
  if (!visible.length) return null;
  return (
    <ol className="space-y-1">
      {visible.map(({ a, label }) => (
        <li key={a.id} className="flex items-start gap-2 text-xs text-muted-foreground">
          <span className="mt-0.5 shrink-0">
            {a.status === "started" ? <Loader2 className="size-3 animate-spin" /> : a.status === "failed" ? <X className="size-3 text-destructive" /> : <Check className="size-3 text-emerald-600 dark:text-emerald-400" />}
          </span>
          <span className={cn("min-w-0 break-words", a.status === "started" && "text-foreground")}>{label}</span>
          {a.name !== "thinking" && a.durationMs !== undefined && a.durationMs >= 1000 && <span className="ml-auto shrink-0 tabular-nums">{(a.durationMs / 1000).toFixed(1)}s</span>}
        </li>
      ))}
    </ol>
  );
}

/** The turn in progress: elapsed time, each step as it happens, then the answer text as it is written. */
export function LiveTurn({ startedAt, activities, draft }: { startedAt: number; activities: Activity[]; draft: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const text = readableDraft(draft);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="w-full space-y-2.5 rounded-lg border bg-muted/40 px-3.5 py-3 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {text ? "Writing the answer" : "Working"} · {seconds}s
      </p>
      <Steps activities={activities} />
      {text && (
        <div className="border-t pt-2.5">
          <Markdown className="text-sm">{text}</Markdown>
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/60 align-text-bottom" aria-hidden />
        </div>
      )}
    </div>
  );
}

/** After the turn: a collapsed "Worked for 23s · 9 steps" line that expands to the steps. */
export function TurnTrace({ seconds, activities }: { seconds: number; activities: Activity[] }) {
  const [open, setOpen] = useState(false);
  const steps = activities.filter((a) => describeActivity(a) !== null).length;
  if (!steps) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-foreground" aria-expanded={open}>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Worked for {seconds}s · {steps} step{steps === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-1.5 pl-5">
          <Steps activities={activities} />
        </div>
      )}
    </div>
  );
}
