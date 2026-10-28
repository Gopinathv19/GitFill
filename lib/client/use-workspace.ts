"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { WorkspaceDetail } from "./types";

export function useWorkspace(id: string) {
  const [data, setData] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<WorkspaceDetail>(`/api/workspaces/${id}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
