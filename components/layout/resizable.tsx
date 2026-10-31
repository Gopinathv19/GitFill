"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the panel still works for this page view.
  }
}

/** Panel width remembered per browser. `commit` persists; `set` only updates while dragging. */
export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((w: number) => Math.round(Math.min(max, Math.max(min, w))), [min, max]);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const saved = Number(read(key));
    if (saved) setWidth(clamp(saved));
  }, [key, clamp]);
  const set = useCallback((w: number) => setWidth(clamp(w)), [clamp]);
  const commit = useCallback((w: number) => write(key, String(clamp(w))), [key, clamp]);
  return { width, set, commit, reset: useCallback(() => (setWidth(initial), write(key, String(initial))), [key, initial]) };
}

/** Open/closed flag remembered per browser. */
export function usePanelOpen(key: string, initial: boolean) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const saved = read(key);
    if (saved !== null) setOpen(saved === "1");
  }, [key]);
  const toggle = useCallback(
    (next?: boolean) =>
      setOpen((o) => {
        const value = next ?? !o;
        write(key, value ? "1" : "0");
        return value;
      }),
    [key],
  );
  return [open, toggle] as const;
}

/**
 * Vertical drag handle on a panel edge. `edge="right"` sits on the right edge of a left panel
 * (drag right to widen); `edge="left"` on the left edge of a right panel (drag left to widen).
 * Double-click resets the width; arrow keys resize when focused.
 */
export function ResizeHandle({
  width,
  edge,
  onResize,
  onCommit,
  onReset,
  label,
}: {
  width: number;
  edge: "left" | "right";
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
  label: string;
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const delta = e.clientX - drag.current.x;
    drag.current.last = drag.current.w + (edge === "right" ? delta : -delta);
    onResize(drag.current.last);
  }
  function onPointerUp() {
    if (!drag.current) return;
    onCommit(drag.current.last);
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const grow = (e.key === "ArrowRight") === (edge === "right");
        const next = width + (grow ? 16 : -16);
        onResize(next);
        onCommit(next);
      }}
      className={cn(
        "group absolute inset-y-0 z-20 w-2 cursor-col-resize outline-none",
        edge === "right" ? "-right-1" : "-left-1",
      )}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}
