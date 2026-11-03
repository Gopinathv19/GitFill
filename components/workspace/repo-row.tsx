"use client";

import { BookOpen, ExternalLink, FileText, GitBranch, GitCompareArrows, Lock, MoreHorizontal, Presentation, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { RepoView } from "@/lib/client/types";
import { BranchPicker } from "./branch-picker";
import { CompareDialog } from "./compare-dialog";
import { GenerateDialog } from "./generate-dialog";
import { HandbookDialog } from "./handbook-dialog";
import { ReadmeDialog } from "./readme-dialog";

export function RepoRow({
  workspaceId,
  repo,
  compact = false,
  onRemove,
  onStarted,
  onChanged,
}: {
  workspaceId: string;
  repo: RepoView;
  compact?: boolean;
  onRemove?: () => void;
  onStarted?: (jobId: string) => void;
  /** Called after the user switches the repository's branch. */
  onChanged?: () => void;
}) {
  const icon = repo.source === "created" ? <Sparkles className="size-4" /> : <GitBranch className="size-4" />;
  const branch = repo.source === "created" ? <Badge variant="warning">Draft</Badge> : <BranchPicker workspaceId={workspaceId} repo={repo} onChanged={onChanged} className="rounded-md border text-xs" />;
  const handbook = repo.analyzable ? (
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
  ) : null;
  const menu = repo.analyzable ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`More actions for ${repo.fullName}`}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {compact && (
          <CompareDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><GitCompareArrows className="size-4" />Compare commits</DropdownMenuItem>} />
        )}
        <GenerateDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><Presentation className="size-4" />Generate presentation</DropdownMenuItem>} />
        <ReadmeDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><FileText className="size-4" />Write README</DropdownMenuItem>} />
        {repo.repositoryUrl && compact && (
          <DropdownMenuItem asChild>
            <a href={repo.repositoryUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Open on GitHub</a>
          </DropdownMenuItem>
        )}
        {onRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="text-destructive focus:text-destructive"><Trash2 className="size-4" />Remove from workspace</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : onRemove ? (
    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${repo.fullName}`} onClick={onRemove}><Trash2 /></Button>
  ) : null;

  // Narrow panels: the name gets its own line, the branch and the main action go underneath.
  if (compact) {
    return (
      <div id={repo.id} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={repo.fullName}>{repo.fullName}</span>
          {repo.isPrivate && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Private repository" />}
          {menu}
        </div>
        <div className="flex items-center justify-between gap-2 pl-9">
          <div className="min-w-0">{branch}</div>
          {handbook}
        </div>
      </div>
    );
  }

  return (
    <div id={repo.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{repo.fullName}</span>
          {repo.isPrivate && <Badge variant="outline" className="shrink-0" title="Private repository, read with your GitHub account"><Lock className="size-3" />Private</Badge>}
          <span className="shrink-0">{branch}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{repo.description || (repo.source === "created" ? "Created in this workspace" : "Imported from GitHub")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {repo.repositoryUrl && (
          <Button asChild variant="ghost" size="icon" className="size-8" aria-label="Open on GitHub">
            <a href={repo.repositoryUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>
          </Button>
        )}
        {handbook}
        {repo.analyzable && <CompareDialog workspaceId={workspaceId} repo={repo} onStarted={onStarted} trigger={<Button size="sm" variant="outline" className="h-8"><GitCompareArrows />Compare commits</Button>} />}
        {menu}
      </div>
    </div>
  );
}
