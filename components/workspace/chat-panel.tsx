"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, FileText, GitCompareArrows, Paperclip } from "lucide-react";
import { UploadZone } from "@/components/shared/upload-zone";
import { Button } from "@/components/ui/button";
import { ReuseDialog } from "./reuse-dialog";
import type { Activity } from "@/lib/client/activity";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { formatAttachments, parseAttachments } from "@/lib/client/attachments";
import { toAttachment, type UploadView } from "@/lib/client/uploads";
import { postStream } from "@/lib/client/stream";
import { refreshSessions, takePendingMessage } from "@/lib/client/sessions-store";
import { finishTurn, newTurn, reduceTurn, stepCount, type Turn, type TurnEvent } from "@/lib/client/turn";
import type { ChatMessage, RepoView } from "@/lib/client/types";
import { AgentTurn } from "./agent-turn";
import { AssistantMessage } from "./assistant-message";
import { JobCard } from "./job-card";

/**
 * One chat session with GitFill's agent. Jobs it starts appear as live cards.
 * Mount with `key={sessionId}` so switching sessions starts from a clean state.
 */
export function ChatPanel({ workspaceId, sessionId, repositories, onActivity }: { workspaceId: string; sessionId: string; repositories: RepoView[]; onActivity: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The turn being streamed, and the turns finished in this view (keyed by reply id).
  const [live, setLive] = useState<Turn | null>(null);
  const [traces, setTraces] = useState<Record<string, Turn>>({});
  const bottom = useRef<HTMLDivElement>(null);
  // Guards against React's dev-mode double effect sending the first message twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const first = takePendingMessage(sessionId);
    if (first) {
      // A brand-new session from the new-session screen: nothing to load, send right away.
      setMessages([]);
      void send(first);
      return;
    }
    api<{ messages: ChatMessage[] }>(`/api/sessions/${sessionId}`)
      .then((r) => setMessages(r.messages))
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted session
  }, [sessionId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, sending]);

  // Follow the live turn as steps and text arrive (instant scroll avoids jitter while streaming).
  useEffect(() => {
    if (live) bottom.current?.scrollIntoView({ block: "end" });
  }, [live]);

  /** Sends a message; resolves false when it never reached the server (the composer then restores the text). */
  async function send(message: string): Promise<boolean> {
    const trimmed = message.trim();
    if (!trimmed || sending) return true;
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", content: trimmed, jobIds: [], createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), optimistic]);
    let turn = newTurn(Date.now());
    setLive(turn);
    const apply = (e: TurnEvent) => {
      turn = reduceTurn(turn, e, Date.now());
      setLive(turn);
    };
    let stored: ChatMessage[] | null = null;
    let accepted = false;
    try {
      await postStream(`/api/sessions/${sessionId}/messages`, { message: trimmed }, (event, data) => {
        if (event === "user") accepted = true;
        else if (event === "activity") apply({ event: "activity", data: data as Activity });
        else if (event === "text") apply({ event: "text", delta: (data as { delta: string }).delta });
        else if (event === "text_reset") apply({ event: "text_reset" });
        else if (event === "done") stored = (data as { messages: ChatMessage[] }).messages;
        else if (event === "error") throw new Error((data as { message: string }).message);
      });
      const final = stored as ChatMessage[] | null;
      if (!final) throw new Error("The connection closed before the answer arrived. Reload in a moment to see it.");
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== optimistic.id), ...final]);
      const reply = final.find((x) => x.role === "assistant");
      const done = finishTurn(turn, Date.now());
      if (reply && (done.segments.length || stepCount(done))) setTraces((t) => ({ ...t, [reply.id]: done }));
      if (final.some((x) => x.jobIds.length)) onActivity();
      void refreshSessions();
    } catch (err) {
      // Once the server has the message it keeps working; only un-send when it never arrived.
      if (!accepted) setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : errorMessage(err, "Message failed to send."));
      return accepted;
    } finally {
      setLive(null);
      setSending(false);
    }
    return true;
  }

  // Stable callbacks so memoized answers and the composer don't re-render on unrelated updates.
  const latestSend = useRef(send);
  latestSend.current = send;
  const submit = useCallback((q: string) => latestSend.current(q), []);
  const ask = useCallback((q: string) => void latestSend.current(q), []);

  const analyzable = repositories.filter((r) => r.analyzable);
  const suggestions = analyzable.length
    ? [
        `How does the request lifecycle work in ${analyzable[0]!.fullName}? Show a sequence diagram`,
        `Generate a hackathon presentation guide for ${analyzable[0]!.fullName}`,
        `What are the main modules of ${analyzable[0]!.fullName} and how do they depend on each other?`,
        `Explain the architecture of ${analyzable[0]!.fullName} to a new developer`,
      ]
    : ["What can you do?", "How do I add a repository?"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {messages === null && !error && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
          {messages?.length === 0 && (
            <div className="py-10 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Bot className="size-6" />
              </div>
              <p className="mt-3 text-sm font-semibold">Understand, explain and reuse this workspace&apos;s code</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Ask how anything works and get an answer with sources and diagrams. Request handbooks, commit comparisons, implementation briefs or presentations; every statement cites the lines it comes from.
              </p>
            </div>
          )}
          {messages?.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={m.id} content={m.content} />
            ) : (
              <div key={m.id} className="flex flex-col gap-3">
                {traces[m.id] ? <AgentTurn turn={traces[m.id]!} /> : null}
                <AssistantMessage content={m.content} onAsk={sending ? undefined : ask} answerable={i === messages.length - 1} workspaceId={workspaceId} />
                {m.jobIds.map((id) => (
                  <div key={id} className="w-full min-w-72">
                    <JobCard jobId={id} onFinished={onActivity} />
                  </div>
                ))}
              </div>
            ),
          )}
          {live && <AgentTurn turn={live} live />}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t bg-background">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {messages?.length === 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {s}
                </button>
              ))}
              {analyzable.length >= 2 && (
                <ReuseDialog workspaceId={workspaceId} repositories={repositories} onStarted={onActivity} trigger={<button className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><GitCompareArrows className="size-3" />Reuse architecture between two repositories…</button>} />
              )}
            </div>
          )}
          {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
          <Composer onSend={submit} sending={sending} workspaceId={workspaceId} />
        </div>
      </div>
    </div>
  );
}

/**
 * The message box. It owns the text it is typing, so a keystroke re-renders only this component,
 * not the whole conversation (which re-parsed every answer's Markdown on each key).
 */
const Composer = memo(function Composer({ onSend, sending, workspaceId }: { onSend: (text: string) => Promise<boolean>; sending: boolean; workspaceId: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadView[]>([]);
  const [attaching, setAttaching] = useState(false);
  async function submit() {
    const value = text;
    if ((!value.trim() && !files.length) || sending) return;
    const attached = files;
    setText("");
    setFiles([]);
    setAttaching(false);
    const message = (value.trim() || "I attached these files.") + formatAttachments(attached.map(toAttachment));
    if (!(await onSend(message))) {
      setText(value);
      setFiles(attached);
    }
  }
  return (
    <>
      {attaching && (
        <div className="mb-2 rounded-lg border bg-muted/20 p-2">
          <UploadZone compact workspaceId={workspaceId} uploads={files} onChange={setFiles} hint="Screenshots, a logo, a .pptx template or documents for GitFill to use" />
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex items-end gap-2 rounded-lg border bg-background p-2 focus-within:ring-2 focus-within:ring-ring"
      >
        <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" aria-label="Attach files" aria-pressed={attaching} onClick={() => setAttaching((a) => !a)}>
          <Paperclip />
        </Button>
        <textarea
          aria-label="Message GitFill"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="Ask a follow-up, or request a handbook, comparison or presentation…"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" className="size-9 shrink-0" disabled={sending || (!text.trim() && !files.length)} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
    </>
  );
});

/** A user message; attached files show as chips (images as thumbnails) under the text. */
const UserMessage = memo(function UserMessage({ content }: { content: string }) {
  const { text, attachments } = parseAttachments(content);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2 text-sm">{text}</div>
      {attachments.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <a key={a.id} href={`/api/uploads/${a.id}`} target="_blank" rel="noreferrer" title={a.description || a.filename} className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-1 text-xs hover:bg-accent">
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated API route
                <img src={`/api/uploads/${a.id}`} alt="" className="size-6 rounded object-cover" />
              ) : (
                <FileText className="size-4 text-muted-foreground" />
              )}
              <span className="max-w-40 truncate">{a.filename}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
});
