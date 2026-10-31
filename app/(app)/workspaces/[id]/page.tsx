"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ArrowUp, Check, ChevronDown, FolderGit2, GitBranch, Loader2, MessageSquare, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddRepositoryDialog } from "@/components/workspace/add-repository-dialog";
import { api, errorMessage } from "@/lib/client/api";
import { refreshSessions, setPendingMessage, useSessions } from "@/lib/client/sessions-store";
import type { ChatSession } from "@/lib/client/types";
import { useWorkspace } from "@/lib/client/use-workspace";
import { refreshWorkspaces, useWorkspaces } from "@/lib/client/workspaces-store";
import { timeAgo } from "@/lib/utils";

/** New-session screen for a workspace: one composer; sending creates a session and opens it. */
export default function NewSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, reload } = useWorkspace(id);
  const workspaces = useWorkspaces();
  const sessions = useSessions();
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const recent = (sessions.data ?? []).filter((s) => s.workspaceId === id).slice(0, 5);

  async function start(message: string) {
    const trimmed = message.trim();
    if (!trimmed || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const session = await api<ChatSession>(`/api/workspaces/${id}/sessions`, { method: "POST", body: JSON.stringify({ title: trimmed }) });
      setPendingMessage(session.id, trimmed);
      void refreshSessions();
      router.push(`/workspaces/${id}/sessions/${session.id}`);
    } catch (err) {
      setStartError(errorMessage(err, "Could not start the session."));
      setStarting(false);
    }
  }

  if (error) return <p className="p-8 text-sm text-destructive">{error}</p>;

  const analyzable = data?.repositories.filter((r) => r.analyzable) ?? [];
  const first = analyzable[0]?.fullName;
  const suggestions = first
    ? [`How does the request lifecycle work in ${first}? Show a sequence diagram`, `What are the main modules of ${first} and how do they depend on each other?`, `Explain the architecture of ${first} to a new developer`, `Generate a hackathon presentation guide for ${first}`]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <span className="truncate text-sm font-medium">{data?.name ?? "Workspace"}</span>
        <span className="text-sm text-muted-foreground">· New session</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-10 pt-[12vh]">
          <h1 className="mb-5 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            GitFill <span className="text-primary">Ask</span>
          </h1>

          <div className="rounded-xl border bg-muted/40 p-1.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void start(text);
              }}
              className="rounded-lg border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring"
            >
              <textarea
                aria-label="Ask GitFill"
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void start(text);
                  }
                }}
                rows={3}
                placeholder={data?.repositories.length ? "Ask how the code works, or request a handbook, comparison, brief or presentation…" : "Add a repository below, then ask about its code…"}
                className="block max-h-60 min-h-20 w-full resize-none bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-8 max-w-[60%] gap-1.5 text-muted-foreground">
                      <FolderGit2 className="size-4 shrink-0" />
                      <span className="truncate">{data?.name ?? "Workspace"}</span>
                      <ChevronDown className="size-3.5 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    {(workspaces.data ?? []).map((w) => (
                      <DropdownMenuItem key={w.id} onSelect={() => router.push(`/workspaces/${w.id}`)}>
                        <FolderGit2 />
                        <span className="truncate">{w.name}</span>
                        {w.id === id && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/workspaces">Manage workspaces</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="submit" size="icon" className="size-8 shrink-0 rounded-full" disabled={starting || !text.trim()} aria-label="Start session">
                  {starting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </Button>
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 pb-1 pt-2 text-xs text-muted-foreground">
              {!data && <span>Loading repositories…</span>}
              {data?.repositories.map((r) => (
                <Link key={r.id} href={`/workspaces/${id}/repositories#${r.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  {r.source === "created" ? <Sparkles className="size-3.5" /> : <GitBranch className="size-3.5" />}
                  {r.fullName}
                  {r.defaultBranch && <span className="text-muted-foreground/70">({r.defaultBranch})</span>}
                </Link>
              ))}
              {data && (
                <AddRepositoryDialog
                  workspaceId={id}
                  onAdded={() => {
                    reload();
                    void refreshWorkspaces();
                  }}
                  trigger={
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground">
                      <Plus className="size-3.5" />
                      Add repository
                    </button>
                  }
                />
              )}
            </div>
          </div>
          {startError && <p role="alert" className="mt-2 text-xs text-destructive">{startError}</p>}

          {suggestions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void start(s)} disabled={starting} className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-2 text-sm font-semibold">Recent sessions</h2>
              <div className="divide-y rounded-lg border">
                {recent.map((s) => (
                  <Link key={s.id} href={`/workspaces/${id}/sessions/${s.id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent">
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(s.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
