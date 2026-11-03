"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/client/api";
import { liveTranscribe, type LiveTranscript } from "@/lib/client/live-transcribe";
import { MAX_RECORDING_SECONDS, startRecording, voiceSupported, VoiceError, type Recording } from "@/lib/client/voice";
import { cn } from "@/lib/utils";

type State = { kind: "idle" } | { kind: "starting" } | { kind: "recording"; rec: Recording; live: LiveTranscript } | { kind: "transcribing" };

/**
 * Voice input with Muse Voice Transcribe, transcribed live: phrases appear above the mic as they are
 * spoken (lib/client/live-transcribe.ts). Click the mic and speak; while recording, ✓ puts the
 * text into the box for review and ↑ (when `onSend` is given) sends it straight away, like asking
 * out loud. Escape cancels. Workspace repository names are sent as keywords so they are spelled right.
 */
export function DictateButton({
  onText,
  onSend,
  workspaceId,
  disabled,
  className,
  size = "md",
}: {
  onText: (text: string) => void;
  onSend?: (text: string) => void;
  workspaceId?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [heard, setHeard] = useState("");
  const meter = useRef<HTMLSpanElement>(null);
  const finish = useRef<(mode: "insert" | "send") => Promise<void>>(async () => undefined);

  // Feature detection after mount, so server and client render the same button.
  useEffect(() => setSupported(voiceSupported()), []);

  useEffect(() => {
    if (state.kind !== "recording") return;
    let frame = 0;
    const tick = () => {
      setElapsed(Math.floor((Date.now() - state.rec.startedAt) / 1000));
      if (meter.current) meter.current.style.transform = `scaleX(${Math.max(0.06, state.rec.level())})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        state.live.cancel();
        setState({ kind: "idle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
  }, [state]);

  // Never leave the microphone on when the component goes away.
  const current = useRef(state);
  current.current = state;
  useEffect(() => () => (current.current.kind === "recording" ? current.current.live.cancel() : undefined), []);

  async function start() {
    setError(null);
    setState({ kind: "starting" });
    try {
      const rec = await startRecording({ onAutoStop: () => void finish.current("insert") });
      setElapsed(0);
      setHeard("");
      setState({ kind: "recording", rec, live: liveTranscribe(rec, { workspaceId, onText: setHeard }) });
    } catch (err) {
      setError(err instanceof VoiceError ? err.message : "The microphone could not be opened.");
      setState({ kind: "idle" });
    }
  }

  finish.current = async (mode) => {
    const s = current.current;
    if (s.kind !== "recording") return;
    setState({ kind: "transcribing" });
    try {
      const text = (await s.live.finish()).trim();
      if (!text) setError("No speech was recognised. Try again a little closer to the mic.");
      else if (mode === "send" && onSend) onSend(text);
      else onText(text);
    } catch (err) {
      setError(err instanceof VoiceError ? err.message : errorMessage(err, "Transcription failed; try again."));
    } finally {
      setHeard("");
      setState({ kind: "idle" });
    }
  };

  if (!supported) return null;
  const icon = size === "sm" ? "size-7" : "size-9";

  // What has been heard so far, above the mic while recording and while the last phrase finishes.
  const transcript = heard && (state.kind === "recording" || state.kind === "transcribing") && (
    <p aria-live="polite" className="absolute bottom-full left-0 z-20 mb-2 max-h-32 w-[min(32rem,80vw)] overflow-y-auto rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      {heard}
      {state.kind === "transcribing" && <Loader2 className="ml-1.5 inline size-3.5 animate-spin text-muted-foreground" />}
    </p>
  );

  if (state.kind === "recording") {
    const left = MAX_RECORDING_SECONDS - elapsed;
    return (
      <div className={cn("relative flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/5 py-0.5 pl-2.5 pr-0.5", className)} role="group" aria-label="Recording">
        {transcript}
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
        </span>
        <span className="w-10 text-center font-mono text-xs tabular-nums text-foreground" aria-live="off">
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
        <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
          <span ref={meter} className="block h-full origin-left rounded-full bg-destructive transition-transform duration-75" />
        </span>
        {left <= 30 && <span className="text-[11px] text-destructive">{left}s left</span>}
        <Button type="button" size="icon" variant="ghost" className="size-7 rounded-full" aria-label="Cancel recording" onClick={() => (state.live.cancel(), setState({ kind: "idle" }))}>
          <X className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-7 rounded-full" aria-label="Stop and insert the text" onClick={() => void finish.current("insert")}>
          <Check className="size-3.5" />
        </Button>
        {onSend && (
          <Button type="button" size="icon" className="size-7 rounded-full" aria-label="Stop and send" onClick={() => void finish.current("send")}>
            <ArrowUp className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative shrink-0", className)}>
      {transcript}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(icon, error && "text-destructive")}
            disabled={disabled || state.kind !== "idle"}
            aria-label={state.kind === "transcribing" ? "Transcribing" : "Speak instead of typing"}
            onClick={() => void start()}
          >
            {state.kind === "idle" ? <Mic /> : <Loader2 className="animate-spin" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-xs">
          {error ?? (state.kind === "transcribing" ? "Transcribing…" : onSend ? "Speak: ✓ puts the text in the box, ↑ sends it" : "Speak instead of typing")}
        </TooltipContent>
      </Tooltip>
      {error && (
        <p role="alert" className="absolute bottom-full right-0 mb-1 w-64 rounded-md border bg-background px-2 py-1 text-[11px] text-destructive shadow-sm">
          {error}
          <button type="button" className="ml-1 underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
