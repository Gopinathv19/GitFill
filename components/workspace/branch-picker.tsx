"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/client/api";
import type { RepoView } from "@/lib/client/types";
import { cn } from "@/lib/utils";

/**
 * The branch GitFill works on for one repository, switchable. Branches are fetched from GitHub when
 * the menu opens; picking one saves it, and later questions and documents read that branch.
 */
export function BranchPicker({ workspaceId, repo, onChanged, className }: { workspaceId: string; repo: RepoView; onChanged?: (repo: RepoView) => void; className?: string }) {
  const [branches, setBranches] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = repo.defaultBranch;
  if (!repo.analyzable) return null;

  const load = async () => {
    if (branches) return;
    setBusy("loading");
    setError(null);
    try {
      setBranches((await api<{ branches: string[] }>(`/api/workspaces/${workspaceId}/repositories/${repo.id}/branches`)).branches);
    } catch (e) {
      setError(errorMessage(e, "Could not load branches."));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (branch: string) => {
    if (branch === current) return;
    setBusy("saving");
    setError(null);
    try {
      onChanged?.(await api<RepoView>(`/api/workspaces/${workspaceId}/repositories/${repo.id}`, { method: "PATCH", body: JSON.stringify({ branch }) }));
    } catch (e) {
      setError(errorMessage(e, "Could not switch the branch."));
    } finally {
      setBusy(null);
    }
  };

  const shown = (branches ?? []).filter((b) => b.toLowerCase().includes(filter.trim().toLowerCase()));
  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Switch the branch GitFill reads"
          aria-label={`Branch of ${repo.fullName}: ${current ?? "default"}. Switch branch`}
          className={cn("inline-flex items-center gap-0.5 rounded px-1 text-muted-foreground/80 hover:bg-accent hover:text-foreground", className)}
        >
          {busy === "saving" ? <Loader2 className="size-3 animate-spin" /> : null}
          {current ?? "default"}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs">Branch for {repo.fullName}</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            // Typing must not trigger the menu's type-ahead.
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Find a branch…"
            aria-label="Find a branch"
            className="w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto">
          {busy === "loading" && (
            <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Loading branches…</p>
          )}
          {error && <p role="alert" className="px-2 py-1.5 text-xs text-destructive">{error}</p>}
          {branches && !shown.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No branch matches.</p>}
          {shown.map((b) => (
            <DropdownMenuItem key={b} onSelect={() => void pick(b)} className="text-xs">
              <span className="truncate">{b}</span>
              {b === current && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
