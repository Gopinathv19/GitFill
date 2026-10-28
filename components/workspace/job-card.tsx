"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Download, FileText } from "lucide-react";
import { JOB_KIND_LABELS, JobStatusBadge, TERMINAL } from "@/components/shared/status-badge";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface JobLite {
  id: string;
  kind: string;
  status: string;
  repositoryUrl: string;
  errorMessage: string | null;
  deckId: string | null;
  documentId: string | null;
  events: Array<{ type: string; name: string; status: string }>;
}

/** Live job card shown inside a chat message. Polls until the job finishes; shows only recorded events. */
export function JobCard({ jobId, onFinished }: { jobId: string; onFinished?: () => void }) {
  const [job, setJob] = useState<JobLite | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      try {
        const j = await api<JobLite>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(j);
        if (TERMINAL.has(j.status)) onFinished?.();
        else timer = setTimeout(poll, 2500);
      } catch {
        if (alive) timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (!job) return <div className="h-20 animate-pulse rounded-lg border bg-muted/40" />;
  const tools = job.events.filter((e) => e.type === "tool");
  const lastSteps = job.events.filter((e) => e.type !== "model").slice(-3);

  return (
    <div className="rounded-lg border bg-card p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {job.kind === "generate" || job.kind === "revise" ? <FileText className="size-4 shrink-0 text-muted-foreground" /> : <BookOpen className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium">
            {JOB_KIND_LABELS[job.kind] ?? job.kind} · {job.repositoryUrl.replace("https://github.com/", "")}
          </span>
        </div>
        <JobStatusBadge status={job.status} />
      </div>
      {lastSteps.length > 0 && job.status !== "completed" && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {lastSteps.map((e, i) => (
            <li key={i} className={cn(e.status === "failed" && "text-destructive")}>
              {e.status === "started" ? "…" : e.status === "failed" ? "✗" : "✓"} {e.name}
            </li>
          ))}
        </ul>
      )}
      {job.status === "failed" && job.errorMessage && <p className="mt-2 text-xs text-destructive">{job.errorMessage}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground">{tools.length} tool calls</span>
        <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
          Activity <ArrowRight className="size-3" />
        </Link>
        {job.status === "completed" && job.documentId && (
          <>
            <Link href={`/documents/${job.documentId}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              Open document <ArrowRight className="size-3" />
            </Link>
            <a href={`/api/documents/${job.documentId}/download?format=md`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              <Download className="size-3" /> .md
            </a>
          </>
        )}
        {job.status === "completed" && job.deckId && (
          <>
            <Link href={`/presentations/${job.deckId}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              Open presentation <ArrowRight className="size-3" />
            </Link>
            <a href={`/api/presentations/${job.deckId}/download?format=pptx`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
              <Download className="size-3" /> .pptx
            </a>
          </>
        )}
      </div>
    </div>
  );
}
