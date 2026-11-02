"use client";

import { GithubIcon } from "@/components/shared/github-icon";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import { refreshWorkspaces } from "@/lib/client/workspaces-store";
import type { UserRepoView } from "@/lib/client/types";
import { GitHubRepoPicker } from "./github-repo-picker";
import { Segmented } from "./segmented";

/** Create a workspace blank, or seeded by importing a GitHub repository. */
export function NewWorkspaceDialog({ trigger, defaultMode = "blank" }: { trigger: React.ReactNode; defaultMode?: "blank" | "import" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"blank" | "import">(defaultMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<UserRepoView | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const repoUrl = url.trim();
    const name = String(f.get("name") ?? "").trim() || (mode === "import" ? picked?.fullName ?? repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/(\.git)?\/?$/, "") : "");
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name, description: String(f.get("description") ?? "") || undefined, importUrl: mode === "import" ? repoUrl : undefined }),
      });
      await refreshWorkspaces();
      setOpen(false);
      router.push(`/workspaces/${id}`);
    } catch (err) {
      setError(errorMessage(err, "Could not create the workspace."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); if (o) { setMode(defaultMode); setUrl(""); setPicked(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>A workspace holds repositories, a chat with the agent, and everything generated from them.</DialogDescription>
        </DialogHeader>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "blank", label: "Start blank", icon: FolderPlus },
            { value: "import", label: "Import repository", icon: GithubIcon },
          ]}
        />
        <form onSubmit={submit} className="space-y-4">
          {mode === "import" && (
            <GitHubRepoPicker
              id="ws-url"
              value={url}
              onChange={(u, repo) => {
                setUrl(u);
                setPicked(repo ?? null);
              }}
            />
          )}
          <div>
            <Label htmlFor="ws-name">Name{mode === "import" && <span className="font-normal text-muted-foreground"> (defaults to the repo name)</span>}</Label>
            <Input id="ws-name" name="name" required={mode === "blank"} maxLength={80} placeholder={mode === "blank" ? "e.g. Platform architecture" : picked?.fullName ?? "owner/repo"} />
          </div>
          <div>
            <Label htmlFor="ws-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="ws-desc" name="description" maxLength={300} className="min-h-16" placeholder={mode === "import" && picked?.description ? picked.description : undefined} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "import" ? "Import and create" : "Create workspace"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
