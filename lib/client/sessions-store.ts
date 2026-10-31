"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { ChatSession } from "./types";

/** Shared cache of the user's chat sessions so the sidebar and session pages stay in sync. */
let state: { data: ChatSession[] | null; error: string | null } = { data: null, error: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

export function refreshSessions(): Promise<void> {
  inflight ??= api<ChatSession[]>("/api/sessions")
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

export function useSessions() {
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }, []),
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!state.data && !inflight) void refreshSessions();
  }, []);
  return snapshot;
}

/**
 * First message typed on the new-session screen, handed to the session page after navigation so
 * the page can send it (and show progress) itself. Client-side navigation keeps module state.
 */
const pending = new Map<string, string>();

export function setPendingMessage(sessionId: string, message: string) {
  pending.set(sessionId, message);
}

export function takePendingMessage(sessionId: string): string | undefined {
  const message = pending.get(sessionId);
  pending.delete(sessionId);
  return message;
}
