"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { JOB_KIND_LABELS, JobStatusBadge, STAGE_LABELS, TERMINAL } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface JobEvent {
  id: string;
  type: "tool" | "model" | "step";
  name: string;
  status: "started" | "succeeded" | "failed";
  model: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number | null;
}

interface JobView {
  id: string;
  kind: "generate" | "revise" | "handbook" | "compare" | "reuse";
  status: string;
  repositoryUrl: string;
  branch: string | null;
  commitSha: string | null;
  prompt: string;
  errorMessage: string | null;
  deckId: string | null;
  documentId: string | null;
  workspaceId: string;
  usage: { inputTokens: number; outputTokens: number };
  events: JobEvent[];
}

const PIPELINES: Record<JobView["kind"], string[]> = {
  generate: ["analyzing_repository", "planning_presentation", "generating_presentation", "rendering_slides", "validating_presentation", "generating_documents", "completed"],
  revise: ["analyzing_repository", "planning_presentation", "generating_presentation", "rendering_slides", "validating_presentation", "generating_documents", "completed"],
  handbook: ["analyzing_repository", "composing_document", "completed"],
  reuse: ["analyzing_repository", "composing_document", "completed"],
  compare: ["analyzing_repository", "comparing_commits", "composing_document", "completed"],
};

/** Live view of one job. Every row comes from recorded agent_events; nothing is simulated. */
export function JobWorkspace({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      try {
        const data = await api<JobView>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(data);
        setError(null);
        if (!TERMINAL.has(data.status)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        timer = setTimeout(poll, 4000);
      }
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (!job) return <p className="text-sm text-muted-foreground">{error ?? "Loading job…"}</p>;

  const PIPELINE = PIPELINES[job.kind] ?? PIPELINES.handbook;
  const stageIndex = PIPELINE.indexOf(job.status === "repairing_presentation" ? "validating_presentation" : job.status);
  const events = job.events.filter((e) => showModel || e.type !== "model");
  const modelCalls = job.events.filter((e) => e.type === "model").length;
  const toolCalls = job.events.filter((e) => e.type === "tool").length;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/workspaces/${job.workspaceId}`)}>
        <ArrowLeft /> Back to workspace
      </Button>
      <PageHeader
        title={job.repositoryUrl.replace("https://github.com/", "")}
        description={
          <>
            {JOB_KIND_LABELS[job.kind] ?? job.kind} · {job.branch ?? "default branch"} ·{" "}
            {job.commitSha ? <span className="font-mono">{job.commitSha.slice(0, 7)}</span> : "resolving commit…"}
          </>
        }
        actions={
          <>
            <JobStatusBadge status={job.status} />
            {job.deckId && job.status === "completed" && (
              <Button asChild>
                <Link href={`/presentations/${job.deckId}`}>Open presentation</Link>
              </Button>
            )}
            {job.documentId && job.status === "completed" && (
              <Button asChild>
                <Link href={`/documents/${job.documentId}`}>Open document</Link>
              </Button>
            )}
          </>
        }
      />
      <p className="max-w-3xl text-sm">{job.prompt}</p>

      {job.status === "failed" && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">The job failed.</p>
          <p className="mt-1 text-muted-foreground">{job.errorMessage}</p>
        </Card>
      )}

      <ol className={cn("grid gap-2", PIPELINE.length > 4 ? "sm:grid-cols-4 lg:grid-cols-7" : "sm:grid-cols-4")} aria-label="Pipeline stages">
        {PIPELINE.map((stage, i) => {
          const done = job.status === "completed" || (stageIndex > i && job.status !== "failed");
          const active = stageIndex === i && !TERMINAL.has(job.status);
          return (
            <li
              key={stage}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs",
                done && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
                active && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-400",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : null}
              {stage === "validating_presentation" && job.status === "repairing_presentation" ? "Repairing" : STAGE_LABELS[stage]}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b">
          <div className="space-y-1.5">
            <CardTitle>Agent activity</CardTitle>
            <CardDescription>
              {toolCalls} tool calls · {modelCalls} model calls · {(job.usage.inputTokens / 1000).toFixed(1)}k in / {(job.usage.outputTokens / 1000).toFixed(1)}k out tokens
            </CardDescription>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showModel} onChange={(e) => setShowModel(e.target.checked)} />
            Show model calls
          </label>
        </CardHeader>
        <ul className="max-h-[32rem] divide-y overflow-y-auto font-mono text-xs">
          {events.length === 0 && <li className="px-6 py-4 text-muted-foreground">Waiting for the worker to pick up this job…</li>}
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-6 py-2.5">
              <span
                className={cn(
                  "mt-0.5 rounded px-1.5 py-0.5 text-[10px] uppercase",
                  e.type === "tool" && "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400",
                  e.type === "step" && "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
                  e.type === "model" && "bg-muted text-muted-foreground",
                )}
              >
                {e.type}
              </span>
              <span className="min-w-0">
                <span>{e.name}</span>
                {e.model && <span className="text-muted-foreground"> · {e.model}</span>}
                <Detail value={e.status === "failed" ? e.error : e.output ?? e.input} failed={e.status === "failed"} />
              </span>
              <span className={cn("whitespace-nowrap", e.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {e.status === "started" ? <Loader2 className="size-3 animate-spin" /> : e.status === "failed" ? <X className="size-3.5" /> : e.durationMs !== null ? `${(e.durationMs / 1000).toFixed(1)}s` : "ok"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Detail({ value, failed }: { value: unknown; failed: boolean }) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <span className={cn("mt-0.5 block truncate", failed ? "text-destructive" : "text-muted-foreground")} title={text}>
      {text}
    </span>
  );
}
