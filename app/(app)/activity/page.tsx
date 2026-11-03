"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, ArrowRight, BookOpen, FileSearch, GitCompareArrows, Loader2, PenLine, Presentation, Search } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { JOB_KIND_LABELS, JobStatusBadge, STAGE_LABELS } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Skeleton } from "@/components/ui/input";
import { useRecent, type Recent } from "@/lib/client/use-recent";
import { cn, timeAgo } from "@/lib/utils";

type Job = Recent["jobs"][number];
type Filter = "all" | "running" | "completed" | "failed";

/** Kinds are told apart by their icon; every tile uses the brand tone. */
const KIND_TONE = "bg-brand/10 text-brand";

const KIND: Record<string, { icon: typeof BookOpen; tone: string }> = {
  generate: { icon: Presentation, tone: KIND_TONE },
  revise: { icon: PenLine, tone: KIND_TONE },
  handbook: { icon: BookOpen, tone: KIND_TONE },
  compare: { icon: GitCompareArrows, tone: KIND_TONE },
  reuse: { icon: FileSearch, tone: KIND_TONE },
};

const stateOf = (j: Job): Exclude<Filter, "all"> => (j.status === "completed" ? "completed" : j.status === "failed" ? "failed" : "running");
const repoName = (url: string) => url.replace(/^https:\/\/github\.com\//, "");

function duration(j: Job): string | null {
  const start = j.startedAt ?? j.createdAt;
  if (!start || !j.completedAt) return null;
  const s = Math.max(0, Math.round((new Date(j.completedAt).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function dayLabel(date: string): string {
  const d = new Date(date);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: diff < 7 ? "long" : undefined, month: "short", day: "numeric" });
}

export default function ActivityPage() {
  const { data, error } = useRecent({ live: true });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const previews = useMemo(() => new Map((data?.decks ?? []).map((d) => [d.id, d.previewArtifactId])), [data]);
  const counts = useMemo(() => {
    const c = { all: jobs.length, running: 0, completed: 0, failed: 0 };
    for (const j of jobs) c[stateOf(j)]++;
    return c;
  }, [jobs]);

  const q = query.trim().toLowerCase();
  const shown = jobs.filter(
    (j) => (filter === "all" || stateOf(j) === filter) && (!q || [j.prompt, j.repositoryUrl, j.workspaceName, JOB_KIND_LABELS[j.kind]].some((v) => v?.toLowerCase().includes(q))),
  );
  const days: Array<{ label: string; jobs: Job[] }> = [];
  for (const j of shown) {
    const label = dayLabel(j.createdAt);
    const last = days[days.length - 1];
    if (last?.label === label) last.jobs.push(j);
    else days.push({ label, jobs: [j] });
  }
  const finished = counts.completed + counts.failed;

  return (
    <div className="space-y-6">
      <PageHeader title="Activity" description="Every job GitFill ran: handbooks, comparisons, briefs, presentations. Open one to follow each recorded step." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      )}
      {data?.jobs.length === 0 && <EmptyState icon={Activity} title="No jobs yet" description="Generate a presentation or a handbook from a workspace; every run shows up here." />}

      {data && jobs.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Jobs run" value={counts.all} />
            <Tile label="Completed" value={counts.completed} note={finished ? `${Math.round((counts.completed / finished) * 100)}% success rate` : undefined} tone="ok" />
            <Tile label="Running now" value={counts.running} tone={counts.running ? "live" : undefined} />
            <Tile label="Failed" value={counts.failed} tone={counts.failed ? "bad" : undefined} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Job status">
              {(["all", "running", "completed", "failed"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm capitalize transition-colors",
                    filter === f ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {f}
                  <span className={cn("text-xs tabular-nums", filter === f ? "text-background/70" : "text-muted-foreground/70")}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search jobs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs…" className="pl-9" />
            </div>
          </div>

          {days.length ? (
            <div className="space-y-7">
              {days.map((day) => (
                <section key={day.label}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day.label}</h2>
                  <ol className="relative space-y-3 before:absolute before:bottom-6 before:left-[0.6rem] before:top-6 before:w-px before:bg-border">
                    {day.jobs.map((j) => (
                      <JobCard key={j.id} job={j} preview={j.deckId ? previews.get(j.deckId) ?? null : null} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No jobs match{q ? ` “${query.trim()}”` : " this filter"}.</p>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "ok" | "bad" | "live" }) {
  return (
    <Card className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone === "live" ? <span className="size-1.5 animate-pulse rounded-full bg-brand" /> : null}
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "ok" && "text-success", tone === "bad" && "text-destructive", tone === "live" && "text-brand")}>{value}</p>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

function JobCard({ job: j, preview }: { job: Job; preview: string | null }) {
  const kind = KIND[j.kind] ?? KIND.handbook!;
  const Icon = kind.icon;
  const state = stateOf(j);
  const took = duration(j);
  const result =
    state !== "completed" ? null : j.deckId ? { href: `/presentations/${j.deckId}`, label: "Open presentation" } : j.documentId ? { href: `/documents/${j.documentId}`, label: "Open document" } : null;
  return (
    <li className="relative pl-8">
      <span className="absolute left-0 top-6 grid w-5 place-items-center">
        {state === "running" ? (
          <Loader2 className="size-4 animate-spin text-brand" />
        ) : (
          <span className={cn("block size-2.5 rounded-full ring-4 ring-background", state === "failed" ? "bg-destructive" : "bg-success")} />
        )}
      </span>
      <Card className={cn("group relative flex items-stretch gap-4 p-4 transition-colors hover:border-foreground/25", state === "running" && "border-brand/40")}>
        {/* The whole card opens the job; the result button sits above this link. */}
        <Link href={`/jobs/${j.id}`} className="absolute inset-0 rounded-[inherit]" aria-label={`Open job: ${JOB_KIND_LABELS[j.kind] ?? j.kind} for ${repoName(j.repositoryUrl)}`} />
        <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", kind.tone)}>
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold">{JOB_KIND_LABELS[j.kind] ?? j.kind}</p>
            <span className="font-mono text-xs text-muted-foreground">{repoName(j.repositoryUrl)}</span>
          </div>
          {j.prompt ? <p className="line-clamp-1 text-[13px] text-foreground/80">{j.prompt}</p> : null}
          {state === "failed" && j.errorMessage ? <p className="line-clamp-1 text-[13px] text-destructive">{j.errorMessage}</p> : null}
          <p className="text-xs text-muted-foreground">
            {j.workspaceName} · {timeAgo(j.createdAt)}
            {took ? ` · took ${took}` : ""}
            {state === "running" ? ` · ${STAGE_LABELS[j.status] ?? "Working"}…` : ""}
          </p>
        </div>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/artifacts/${preview}`} alt="" className="hidden aspect-video h-[4.5rem] shrink-0 rounded-md border object-cover md:block" />
        ) : null}
        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          <JobStatusBadge status={j.status} />
          {result ? (
            <Button asChild size="sm" variant="ghost" className="relative z-10 -mr-2 h-7 px-2 text-xs">
              <Link href={result.href}>
                {result.label}
                <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
