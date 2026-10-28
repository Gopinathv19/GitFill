"use client";

import { BookOpen, ExternalLink, GitBranch, GitCompareArrows, Lock, MoreHorizontal, Presentation, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { RepoView } from "@/lib/client/types";
import { CompareDialog } from "./compare-dialog";
import { GenerateDialog } from "./generate-dialog";
import { HandbookDialog } from "./handbook-dialog";

export function RepoRow({ workspaceId, repo, compact = false, onRemove, onStarted }: { workspaceId: string; repo: RepoView; compact?: boolean; onRemove?: () => void; onStarted?: (jobId: string) => void }) {
  return (
    <div id={repo.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        {repo.source === "created" ? <Sparkles className="size-4" /> : <GitBranch className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{repo.fullName}</span>
          {repo.isPrivate && <Badge variant="outline" title="Private repository, read with your GitHub account"><Lock className="size-3" />Private</Badge>}
          {repo.source === "created" ? <Badge variant="warning">Draft</Badge> : !compact && repo.defaultBranch && <Badge variant="outline">{repo.defaultBranch}</Badge>}
        </div>
        {!compact && <p className="truncate text-xs text-muted-foreground">{repo.description || (repo.source === "created" ? "Created in this workspace" : "Imported from GitHub")}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {repo.repositoryUrl && !compact && (
          <Button asChild variant="ghost" size="icon" className="size-8" aria-label="Open on GitHub">
            <a href={repo.repositoryUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>
          </Button>
        )}
        {repo.analyzable && (
          <>
            <HandbookDialog
              workspaceId={workspaceId}
              repo={repo}
              onStarted={onStarted}
              trigger={
                <Button size="sm" variant={compact ? "outline" : "default"} className="h-8">
                  <BookOpen />
                  Handbook
                </Button>
              }
            />
            {!compact && (
              <CompareDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<Button size="sm" variant="outline" className="h-8"><GitCompareArrows />Compare commits</Button>} />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={`More actions for ${repo.fullName}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {compact && (
                  <CompareDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><GitCompareArrows className="size-4" />Compare commits</DropdownMenuItem>} />
                )}
                <GenerateDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><Presentation className="size-4" />Generate presentation</DropdownMenuItem>} />
                {onRemove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onRemove} className="text-destructive focus:text-destructive"><Trash2 className="size-4" />Remove from workspace</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        {!repo.analyzable && onRemove && (
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Remove ${repo.fullName}`} onClick={onRemove}><Trash2 /></Button>
        )}
      </div>
    </div>
  );
}
