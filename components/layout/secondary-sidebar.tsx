"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderGit2, GitBranch, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/input";
import { useWorkspaces } from "@/lib/client/workspaces-store";
import { cn } from "@/lib/utils";
import { NewWorkspaceDialog } from "@/components/workspace/new-workspace-dialog";

/** Workspaces panel (~208px) beside the icon rail: each workspace with its repositories. */
export function SecondarySidebar() {
  const pathname = usePathname();
  const { data, error } = useWorkspaces();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r bg-sidebar">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Workspaces</span>
        <NewWorkspaceDialog
          trigger={
            <Button variant="ghost" size="icon" className="size-7" aria-label="New workspace">
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="mx-1 my-1 h-9" />)}
        {error && <p className="px-3 py-2 text-xs text-destructive">{error}</p>}
        {data?.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No workspaces yet.</p>}
        {data?.map((ws) => {
          const base = `/workspaces/${ws.id}`;
          const inWs = pathname === base || pathname.startsWith(`${base}/`);
          return (
            <div key={ws.id}>
              <Link
                href={base}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md px-3 py-2.5 transition-colors",
                  inWs ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <FolderGit2 className="size-4 shrink-0" />
                  <span className="truncate text-sm font-medium leading-none">{ws.name}</span>
                </span>
                <span className="ml-6 line-clamp-1 text-[11px] text-muted-foreground">
                  {ws.repositories.length} repo{ws.repositories.length === 1 ? "" : "s"} · {ws.documentCount} doc{ws.documentCount === 1 ? "" : "s"} · {ws.presentationCount} deck{ws.presentationCount === 1 ? "" : "s"}
                </span>
              </Link>
              {inWs &&
                ws.repositories.map((r) => (
                  <Link
                    key={r.id}
                    href={`${base}/repositories#${r.id}`}
                    className="ml-4 flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                  >
                    {r.source === "created" ? <Sparkles className="size-3.5 shrink-0" /> : <GitBranch className="size-3.5 shrink-0" />}
                    <span className="truncate">{r.fullName}</span>
                  </Link>
                ))}
            </div>
          );
        })}
      </nav>
      <div className="mt-auto px-4 py-3">
        <p className="text-[10px] text-muted-foreground/50">GitFill · understand, explain, reuse</p>
      </div>
    </aside>
  );
}
