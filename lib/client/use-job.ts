"use client";

import { useEffect, useState } from "react";
import type { JobEvent } from "@/components/jobs/activity-timeline";
import { TERMINAL } from "@/components/shared/status-badge";
import { api } from "./api";

export interface JobView {
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
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  events: JobEvent[];
}

/** Polls a job every 2 s until it finishes; `null` jobId polls nothing. */
export function useJob(jobId: string | null): { job: JobView | null; error: string | null; now: number } {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setJob(null);
    if (!jobId) return;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      try {
        const data = await api<JobView>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(data);
        setNow(Date.now());
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

  return { job, error, now };
}
