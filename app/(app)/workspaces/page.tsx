"use client";

import { GithubIcon } from "@/components/shared/github-icon";
import Link from "next/link";
import { FolderGit2, FolderPlus, GitBranch, Plus, Presentation, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/input";
import { NewWorkspaceDialog } from "@/components/workspace/new-workspace-dialog";
import { useWorkspaces } from "@/lib/client/workspaces-store";
import { timeAgo } from "@/lib/utils";

export default function WorkspacesPage() {
  const { data, error } = useWorkspaces();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspaces"
        description="Each workspace groups repositories, a chat with GitFill, and the presentations made from them."
        actions={
          <>
            <NewWorkspaceDialog defaultMode="import" trigger={<Button variant="outline"><GithubIcon />Import repository</Button>} />
            <NewWorkspaceDialog trigger={<Button><Plus />New workspace</Button>} />
          </>
        }
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}
      {data?.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title="Create your first workspace"
          description="Start blank and add repositories later, or import a GitHub repository to begin right away."
          action={
            <div className="flex gap-2">
              <NewWorkspaceDialog trigger={<Button variant="outline"><FolderPlus />Start blank</Button>} />
              <NewWorkspaceDialog defaultMode="import" trigger={<Button><GithubIcon />Import repository</Button>} />
            </div>
          }
        />
      )}
      {data && data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((ws) => (
            <Link key={ws.id} href={`/workspaces/${ws.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <FolderGit2 className="size-5" />
                    </div>
                    <span className="text-xs text-muted-foreground">{timeAgo(ws.updatedAt)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{ws.name}</p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{ws.description || "No description"}</p>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {ws.repositories.slice(0, 3).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-muted-foreground">
                        {r.source === "created" ? <Sparkles className="size-3.5" /> : <GitBranch className="size-3.5" />}
                        <span className="truncate">{r.fullName}</span>
                      </li>
                    ))}
                    {ws.repositories.length === 0 && <li className="text-muted-foreground">No repositories yet</li>}
                    {ws.repositories.length > 3 && <li className="text-xs text-muted-foreground">+{ws.repositories.length - 3} more</li>}
                  </ul>
                  <div className="mt-auto flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><FolderGit2 className="size-3.5" />{ws.repositories.length} repos</span>
                    <span className="flex items-center gap-1.5"><Presentation className="size-3.5" />{ws.presentationCount} decks</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
