"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

import type { DocumentSummary } from "./types";

export interface Recent {
  jobs: Array<{ id: string; kind: string; status: string; repositoryUrl: string; prompt: string; deckId: string | null; documentId: string | null; createdAt: string; errorMessage: string | null; workspaceId: string; workspaceName: string }>;
  documents: DocumentSummary[];
  decks: Array<{ id: string; title: string; latestVersion: number; updatedAt: string; workspaceId: string; workspaceName: string; previewArtifactId: string | null }>;
}

export function useRecent() {
  const [data, setData] = useState<Recent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Recent>("/api/presentations").then(setData, (e: Error) => setError(e.message));
  }, []);
  return { data, error };
}
