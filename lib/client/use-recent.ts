"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

import type { DocumentSummary } from "./types";

export interface Recent {
  jobs: Array<{ id: string; kind: string; status: string; repositoryUrl: string; prompt: string; deckId: string | null; documentId: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; errorMessage: string | null; workspaceId: string; workspaceName: string }>;
  documents: DocumentSummary[];
  decks: Array<{ id: string; title: string; latestVersion: number; updatedAt: string; workspaceId: string; workspaceName: string; previewArtifactId: string | null }>;
}

const TERMINAL = new Set(["completed", "failed"]);

/** Recent jobs, decks and documents. With `live`, refreshes every few seconds while any job is still running. */
export function useRecent({ live = false }: { live?: boolean } = {}) {
  const [data, setData] = useState<Recent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api<Recent>("/api/presentations").then(
        (d) => {
          if (!alive) return;
          setData(d);
          if (live && d.jobs.some((j) => !TERMINAL.has(j.status))) timer = setTimeout(load, 4000);
        },
        (e: Error) => alive && setError(e.message),
      );
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [live]);
  return { data, error };
}
