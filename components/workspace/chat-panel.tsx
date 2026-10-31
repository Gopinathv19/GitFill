"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, GitCompareArrows } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReuseDialog } from "./reuse-dialog";
import { type Activity, upsertActivity } from "@/lib/client/activity";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { postStream } from "@/lib/client/stream";
import { refreshSessions, takePendingMessage } from "@/lib/client/sessions-store";
import type { ChatMessage, RepoView } from "@/lib/client/types";
import { cn, getInitials } from "@/lib/utils";
import { AssistantMessage } from "./assistant-message";
import { JobCard } from "./job-card";
import { LiveTurn, TurnTrace } from "./live-turn";
import { useUser } from "@/components/layout/user-context";

/**
 * One chat session with GitFill's agent. Jobs it starts appear as live cards.
 * Mount with `key={sessionId}` so switching sessions starts from a clean state.
 */
export function ChatPanel({ workspaceId, sessionId, repositories, onActivity }: { workspaceId: string; sessionId: string; repositories: RepoView[]; onActivity: () => void }) {
  const user = useUser();
  const userName = user.name ?? user.login;
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The turn being streamed, and the steps of turns finished in this view (keyed by reply id).
  const [live, setLive] = useState<{ startedAt: number; activities: Activity[]; draft: string } | null>(null);
  const [traces, setTraces] = useState<Record<string, { seconds: number; activities: Activity[] }>>({});
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
  }, [live?.activities.length, live?.draft.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setText("");
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", content: trimmed, jobIds: [], createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), optimistic]);
    const startedAt = Date.now();
    setLive({ startedAt, activities: [], draft: "" });
    let activities: Activity[] = [];
    let stored: ChatMessage[] | null = null;
    let accepted = false;
    try {
      await postStream(`/api/sessions/${sessionId}/messages`, { message: trimmed }, (event, data) => {
        if (event === "user") accepted = true;
        else if (event === "activity") {
          activities = upsertActivity(activities, data as Activity);
          setLive((l) => l && { ...l, activities });
        } else if (event === "text") setLive((l) => l && { ...l, draft: l.draft + (data as { delta: string }).delta });
        else if (event === "text_reset") setLive((l) => l && { ...l, draft: "" });
        else if (event === "done") stored = (data as { messages: ChatMessage[] }).messages;
        else if (event === "error") throw new Error((data as { message: string }).message);
      });
      const final = stored as ChatMessage[] | null;
      if (!final) throw new Error("The connection closed before the answer arrived. Reload in a moment to see it.");
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== optimistic.id), ...final]);
      const reply = final.find((x) => x.role === "assistant");
      if (reply) setTraces((t) => ({ ...t, [reply.id]: { seconds: Math.round((Date.now() - startedAt) / 1000), activities } }));
      if (final.some((x) => x.jobIds.length)) onActivity();
      void refreshSessions();
    } catch (err) {
      // Once the server has the message it keeps working; only un-send when it never arrived.
      if (!accepted) {
        setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
        setText(trimmed);
      }
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : errorMessage(err, "Message failed to send."));
    } finally {
      setLive(null);
      setSending(false);
    }
  }

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
          {messages?.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <Avatar className="mt-0.5 size-7">
                <AvatarFallback className={cn("text-[11px]", m.role === "user" ? "bg-gradient-to-br from-indigo-500 to-violet-600 text-white" : "bg-primary text-primary-foreground")}>
                  {m.role === "user" ? getInitials(userName) : "G"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("flex max-w-[85%] flex-col gap-2", m.role === "user" ? "items-end" : "w-full")}>
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.content}</div>
                ) : (
                  <>
                    {traces[m.id] && <TurnTrace seconds={traces[m.id]!.seconds} activities={traces[m.id]!.activities} />}
                    <AssistantMessage content={m.content} onAsk={sending ? undefined : (q) => void send(q)} />
                  </>
                )}
                {m.jobIds.map((id) => (
                  <div key={id} className="w-full min-w-72">
                    <JobCard jobId={id} onFinished={onActivity} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {live && (
            <div className="flex gap-3">
              <Avatar className="mt-0.5 size-7">
                <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">G</AvatarFallback>
              </Avatar>
              <div className="flex w-full max-w-[85%] flex-col">
                <LiveTurn startedAt={live.startedAt} activities={live.activities} draft={live.draft} />
              </div>
            </div>
          )}
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2 rounded-lg border bg-background p-2 focus-within:ring-2 focus-within:ring-ring"
          >
            <textarea
              aria-label="Message GitFill"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              rows={1}
              placeholder="Ask a follow-up, or request a handbook, comparison or presentation…"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" size="icon" className="size-9 shrink-0" disabled={sending || !text.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          </form>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  );
}

