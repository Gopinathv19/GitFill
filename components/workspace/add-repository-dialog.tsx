"use client";

import { GithubIcon } from "@/components/shared/github-icon";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import { refreshWorkspaces, useWorkspaces } from "@/lib/client/workspaces-store";
import { GitHubRepoPicker } from "./github-repo-picker";
import { Segmented } from "./segmented";

/** Add a repository to a workspace: import from GitHub, or create a new one inside the workspace. */
export function AddRepositoryDialog({ workspaceId, trigger, onAdded }: { workspaceId: string; trigger: React.ReactNode; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"import" | "create">("import");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const workspaces = useWorkspaces();
  const existing = (workspaces.data?.find((w) => w.id === workspaceId)?.repositories ?? []).map((r) => r.fullName);

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
            <GitHubRepoPicker value={url} onChange={(u) => setUrl(u)} exclude={existing} />
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
