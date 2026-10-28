"use client";

import { GithubIcon } from "@/components/shared/github-icon";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import type { UserRepoView } from "@/lib/client/types";
import { refreshWorkspaces } from "@/lib/client/workspaces-store";
import { Segmented } from "./segmented";

/** Add a repository to a workspace: import from GitHub, or create a new one inside the workspace. */
export function AddRepositoryDialog({ workspaceId, trigger, onAdded }: { workspaceId: string; trigger: React.ReactNode; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"import" | "create">("import");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [mine, setMine] = useState<UserRepoView[] | null>(null);
  const [mineState, setMineState] = useState<"loading" | "ready" | "not_connected" | "error">("loading");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open || mine) return;
    api<{ repositories: UserRepoView[] }>("/api/github/repositories")
      .then((r) => {
        setMine(r.repositories);
        setMineState("ready");
      })
      .catch((e: unknown) => setMineState(e instanceof ApiError && e.code === "github_not_connected" ? "not_connected" : "error"));
  }, [open, mine]);

  const shown = (mine ?? []).filter((r) => !filter || r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body =
      mode === "import"
        ? { mode, url: url || String(f.get("url") ?? "") }
        : { mode, name: String(f.get("name") ?? ""), description: String(f.get("description") ?? "") || undefined };
    setBusy(true);
    setError(null);
    try {
      await api(`/api/workspaces/${workspaceId}/repositories`, { method: "POST", body: JSON.stringify(body) });
      await refreshWorkspaces();
      onAdded();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Could not add the repository."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add repository</DialogTitle>
          <DialogDescription>Bring in an existing GitHub repository, or start a new one in this workspace.</DialogDescription>
        </DialogHeader>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "import", label: "Import from GitHub", icon: GithubIcon },
            { value: "create", label: "Create new", icon: Sparkles },
          ]}
        />
        <form onSubmit={submit} className="space-y-4">
          {mode === "import" ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="repo-url">Repository URL</Label>
                <Input id="repo-url" name="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" autoComplete="off" />
              </div>
              <div>
                <Label htmlFor="repo-filter">Your repositories</Label>
                {mineState === "loading" && <p className="text-xs text-muted-foreground">Loading your GitHub repositories…</p>}
                {mineState === "not_connected" && (
                  <p className="text-xs text-muted-foreground">
                    <Link href="/settings" className="underline">Connect your GitHub account</Link> to pick from your own repositories, including private ones. Public URLs work without it.
                  </p>
                )}
                {mineState === "error" && <p className="text-xs text-muted-foreground">Could not load your repositories; paste a URL instead.</p>}
                {mineState === "ready" && (
                  <>
                    <Input id="repo-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="mb-1" autoComplete="off" />
                    <div className="max-h-44 overflow-y-auto rounded-md border text-sm">
                      {shown.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No matching repositories.</p>}
                      {shown.map((r) => (
                        <button type="button" key={r.fullName} onClick={() => setUrl(r.htmlUrl)} className={`flex w-full items-center gap-2 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-accent ${url === r.htmlUrl ? "bg-accent" : ""}`}>
                          {r.private && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                          <span className="truncate">{r.fullName}</span>
                          {r.language && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.language}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="repo-name">Repository name</Label>
                <Input id="repo-name" name="name" required pattern="[A-Za-z0-9._\-]{1,100}" placeholder="my-new-service" />
              </div>
              <div>
                <Label htmlFor="repo-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea id="repo-desc" name="description" maxLength={300} className="min-h-16" />
              </div>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                The repository is created in this workspace as a draft. Publishing it to GitHub needs GitHub write access, which isn&apos;t connected yet.
              </p>
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "import" ? "Import" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
