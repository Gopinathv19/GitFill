"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { WorkspaceSummary } from "./types";

/** Tiny shared cache of the user's workspaces so the sidebar and pages stay in sync. */
let state: { data: WorkspaceSummary[] | null; error: string | null } = { data: null, error: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

export function refreshWorkspaces(): Promise<void> {
  inflight ??= api<WorkspaceSummary[]>("/api/workspaces")
    .then((data) => {
      state = { data, error: null };
    })
    .catch((e: Error) => {
      state = { ...state, error: e.message };
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

export function useWorkspaces() {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }, []),
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!state.data && !inflight) void refreshWorkspaces();
  }, []);
  return snapshot;
}
