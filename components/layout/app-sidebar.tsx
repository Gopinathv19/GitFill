"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Activity, BookOpen, ChevronRight, FolderGit2, LayoutGrid, LogOut, PanelLeftClose, Plus, Presentation, Settings } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NewWorkspaceDialog } from "@/components/workspace/new-workspace-dialog";
import { SessionMenu } from "@/components/workspace/session-menu";
import { useSessions } from "@/lib/client/sessions-store";
import type { ChatSession, SessionUser } from "@/lib/client/types";
import { useWorkspaces } from "@/lib/client/workspaces-store";
import { cn, getInitials, timeAgo } from "@/lib/utils";

const NAV = [
  { href: "/workspaces", icon: LayoutGrid, label: "Workspaces" },
  { href: "/documents", icon: BookOpen, label: "Documents" },
  { href: "/presentations", icon: Presentation, label: "Presentations" },
  { href: "/activity", icon: Activity, label: "Activity" },
];

/** Sessions shown per workspace before "Show more". */
const SESSIONS_PER_GROUP = 6;

/**
 * Single navigation column: new session, app sections, then every workspace as a folder of its
 * chat sessions (most recently active first), and the account at the bottom.
 */
export function AppSidebar({ user, stub, onCollapse }: { user: SessionUser; stub: boolean; onCollapse?: () => void }) {
  const pathname = usePathname();
  const workspaces = useWorkspaces();
  const sessions = useSessions();
  const currentWorkspace = /^\/workspaces\/([^/]+)/.exec(pathname)?.[1];
  const currentSession = /^\/workspaces\/[^/]+\/sessions\/([^/]+)/.exec(pathname)?.[1];

  const groups = useMemo(() => {
    const byWs = new Map<string, ChatSession[]>();
    for (const s of sessions.data ?? []) byWs.set(s.workspaceId, [...(byWs.get(s.workspaceId) ?? []), s]);
    const latest = (id: string, fallback: string) => byWs.get(id)?.[0]?.updatedAt ?? fallback;
    return [...(workspaces.data ?? [])]
      .sort((a, b) => latest(b.id, b.updatedAt).localeCompare(latest(a.id, a.updatedAt)))
      .map((ws) => ({ ws, sessions: byWs.get(ws.id) ?? [] }));
  }, [workspaces.data, sessions.data]);

  // New session goes to the workspace in view, else the most recently active one.
  const newSessionHref = currentWorkspace ? `/workspaces/${currentWorkspace}` : groups[0] ? `/workspaces/${groups[0].ws.id}` : "/workspaces";
  const navActive = (href: string) => pathname === href || (href !== "/workspaces" && pathname.startsWith(`${href}/`)) || (href === "/presentations" && pathname.startsWith("/jobs"));

  return (
    <div className="flex h-full min-w-0 flex-col bg-sidebar">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <Link href="/workspaces" aria-label="GitFill home" className="min-w-0 flex-1">
          <Logo className="[&>span:first-child]:size-7 [&>span:first-child]:text-xs" />
        </Link>
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onCollapse} aria-label="Hide sidebar">
                <PanelLeftClose className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">Hide sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pb-2">
        <Link href={newSessionHref} className={navItem(false)}>
          <Plus className="size-4" />
          New session
        </Link>
        {NAV.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={navItem(navActive(href))}>
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <span className="text-[13px] font-semibold text-foreground">Sessions</span>
        <div className="flex items-center gap-0.5">
          <NewWorkspaceDialog
            trigger={
              <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="New workspace">
                <FolderGit2 className="size-3.5" />
              </Button>
            }
          />
          <Button asChild variant="ghost" size="icon" className="size-6 text-muted-foreground">
            <Link href={newSessionHref} aria-label="New session">
              <Plus className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!workspaces.data && !workspaces.error && [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 my-1.5 h-7" />)}
        {(workspaces.error || sessions.error) && <p className="px-2 py-1 text-xs text-destructive">{workspaces.error ?? sessions.error}</p>}
        {workspaces.data?.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Create a workspace to start a session.</p>}
        {groups.map(({ ws, sessions: list }) => (
          <WorkspaceGroup key={ws.id} id={ws.id} name={ws.name} sessions={list} loading={!sessions.data} active={ws.id === currentWorkspace} currentSession={currentSession} />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent">
              <Avatar className="size-6">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} referrerPolicy="no-referrer" />}
                <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-[10px] text-white">{getInitials(user.name ?? user.login)}</AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-medium">{user.name ?? user.login}</span>
              {stub && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">demo</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold">{user.name ?? user.login}</p>
              <p className="truncate text-xs text-muted-foreground">@{user.login}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action="/api/auth/logout" method="post">
              <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
                <button type="submit" className="w-full">
                  <LogOut />
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
      </div>
    </div>
  );
}

function WorkspaceGroup({ id, name, sessions, loading, active, currentSession }: { id: string; name: string; sessions: ChatSession[]; loading: boolean; active: boolean; currentSession?: string }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Folders start open when they are in view or have sessions; the user's toggle wins afterwards.
  const expanded = open ?? (active || sessions.length > 0);
  const visible = showAll ? sessions : sessions.slice(0, SESSIONS_PER_GROUP);

  return (
    <div className="mt-0.5">
      <div className={cn("group flex items-center rounded-md pr-1 transition-colors hover:bg-sidebar-accent/60", active && !currentSession && "bg-sidebar-accent")}>
        <button onClick={() => setOpen(!expanded)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground" aria-expanded={expanded}>
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
          <span className="truncate">{name}</span>
          {sessions.length > 0 && <span className="shrink-0 text-[11px] text-muted-foreground/70">{sessions.length}</span>}
        </button>
        <Button asChild variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
          <Link href={`/workspaces/${id}`} aria-label={`New session in ${name}`}>
            <Plus className="size-3.5" />
          </Link>
        </Button>
      </div>
      {expanded && (
        <div className="ml-3 border-l pl-1.5">
          {loading && <Skeleton className="my-1 ml-1 h-8" />}
          {!loading && sessions.length === 0 && (
            <Link href={`/workspaces/${id}`} className="block px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              No sessions yet — start one
            </Link>
          )}
          {visible.map((s) => {
            const isActive = s.id === currentSession;
            return (
              <div key={s.id} className={cn("group relative rounded-md transition-colors", isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60")}>
                <Link href={`/workspaces/${id}/sessions/${s.id}`} className="block min-w-0 px-2 py-1.5 pr-7" aria-current={isActive ? "page" : undefined}>
                  <span className={cn("block truncate text-[13px]", isActive ? "font-medium text-foreground" : "text-foreground/90")}>{s.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{timeAgo(s.updatedAt)}</span>
                </Link>
                <SessionMenu session={s} active={isActive} className="absolute right-1 top-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100" />
              </div>
            );
          })}
          {sessions.length > SESSIONS_PER_GROUP && (
            <button onClick={() => setShowAll(!showAll)} className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              {showAll ? "Show less" : `Show all ${sessions.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function navItem(active: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
    active ? "bg-sidebar-accent font-medium text-foreground" : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
  );
}
