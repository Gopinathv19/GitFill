"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { ActivityTimeline } from "@/components/jobs/activity-timeline";
import { PageHeader } from "@/components/shared/page-header";
import { JOB_KIND_LABELS, JobStatusBadge, STAGE_LABELS, TERMINAL } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useJob, type JobView } from "@/lib/client/use-job";
import { usePageTitle } from "@/lib/client/use-page-title";
import { cn } from "@/lib/utils";

export const PIPELINES: Record<JobView["kind"], string[]> = {
  generate: ["analyzing_repository", "planning_presentation", "generating_presentation", "rendering_slides", "validating_presentation", "generating_documents", "completed"],
  revise: ["analyzing_repository", "planning_presentation", "generating_presentation", "rendering_slides", "validating_presentation", "generating_documents", "completed"],
  handbook: ["analyzing_repository", "composing_document", "completed"],
  reuse: ["analyzing_repository", "composing_document", "completed"],
  compare: ["analyzing_repository", "comparing_commits", "composing_document", "completed"],
  video: ["composing_video", "rendering_video", "completed"],
  readme: ["analyzing_repository", "composing_document", "completed"],
  brainstorm: ["analyzing_repository", "composing_document", "completed"],
};

/** Live view of one job. Every row comes from recorded agent_events; nothing is simulated. */
export function JobWorkspace({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { job, error, now } = useJob(jobId);
  // The tab shows the job's state, so progress is visible from another tab.
  const kindLabel = job ? (JOB_KIND_LABELS[job.kind] ?? job.kind) : null;
  usePageTitle(!job ? null : !TERMINAL.has(job.status) ? `● Working · ${kindLabel}` : job.status === "completed" ? `✓ Done · ${kindLabel}` : `✕ Failed · ${kindLabel}`);

  if (!job) return <p className="text-sm text-muted-foreground">{error ?? "Loading job…"}</p>;

  const PIPELINE = PIPELINES[job.kind] ?? PIPELINES.handbook;
  const stageIndex = PIPELINE.indexOf(job.status === "repairing_presentation" ? "validating_presentation" : job.status);
  const running = !TERMINAL.has(job.status);
  const started = job.startedAt ?? job.createdAt;
  const elapsedMs = started ? (job.completedAt ? new Date(job.completedAt).getTime() : now) - new Date(started).getTime() : 0;
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
                done && "border-success/25 bg-success/10 text-success",
                active && "border-brand/40 bg-brand/5 text-brand",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : active ? <Loader2 className="size-3 animate-spin" /> : null}
              {stage === "validating_presentation" && job.status === "repairing_presentation" ? "Repairing" : STAGE_LABELS[stage]}
            </li>
          );
        })}
      </ol>

      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
          <h2 className="text-sm font-semibold">{running ? "GitFill is working" : job.status === "failed" ? "Stopped" : "Done"}</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {elapsedMs > 0 ? `${formatElapsed(elapsedMs)} · ` : ""}
            {toolCalls} tool calls · {modelCalls} model calls · {(job.usage.inputTokens / 1000).toFixed(1)}k in / {(job.usage.outputTokens / 1000).toFixed(1)}k out tokens
          </p>
        </div>
        <ActivityTimeline events={job.events} running={running} currentStage={STAGE_LABELS[job.status]} />
      </Card>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
