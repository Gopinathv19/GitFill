"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, GitCompareArrows, Loader2 } from "lucide-react";
import { Markdown } from "@/components/shared/markdown";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReuseDialog } from "./reuse-dialog";
import { api, errorMessage } from "@/lib/client/api";
import type { ChatMessage, RepoView } from "@/lib/client/types";
import { cn, getInitials } from "@/lib/utils";
import { JobCard } from "./job-card";
import { useUser } from "@/components/layout/user-context";

/** The workspace conversation with GitFill's agent. Jobs it starts appear as live cards. */
export function ChatPanel({ workspaceId, repositories, onActivity }: { workspaceId: string; repositories: RepoView[]; onActivity: () => void }) {
  const user = useUser();
  const userName = user.name ?? user.login;
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ChatMessage[]>(`/api/workspaces/${workspaceId}/chat`)
      .then(setMessages)
      .catch((e: Error) => setError(e.message));
  }, [workspaceId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length, sending]);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setText("");
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", content: trimmed, jobIds: [], createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), optimistic]);
    try {
      const res = await api<{ messages: ChatMessage[] }>(`/api/workspaces/${workspaceId}/chat`, { method: "POST", body: JSON.stringify({ message: trimmed }) });
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== optimistic.id), ...res.messages]);
      if (res.messages.some((x) => x.jobIds.length)) onActivity();
    } catch (err) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
      setText(trimmed);
      setError(errorMessage(err, "Message failed to send."));
    } finally {
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
              <div className={cn("flex max-w-[85%] flex-col gap-2", m.role === "user" && "items-end")}>
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.content}</div>
                ) : (
                  <div className="rounded-lg bg-muted px-3.5 py-2 text-sm"><Markdown className="text-sm">{m.content}</Markdown></div>
                )}
                {m.jobIds.map((id) => (
                  <div key={id} className="w-full min-w-72">
                    <JobCard jobId={id} onFinished={onActivity} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> GitFill is working…
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
              placeholder="Ask how the code works, or request a handbook, commit comparison, implementation brief or presentation…"
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

