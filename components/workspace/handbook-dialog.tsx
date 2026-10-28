"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { RepoView } from "@/lib/client/types";

const AUDIENCES = [
  ["technical_handbook", "Complete technical handbook"],
  ["hackathon_pitch", "Hackathon presentation guide (5 minutes)"],
  ["new_developer", "New developer onboarding guide"],
  ["backend_deep_dive", "Backend deep dive"],
  ["frontend_deep_dive", "Frontend deep dive"],
] as const;

/** Starts a handbook job: whole repository, one module (directory) or one feature. */
export function HandbookDialog({ workspaceId, repo, trigger, onStarted }: { workspaceId: string; repo: RepoView; trigger: React.ReactNode; onStarted?: (jobId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"repository" | "module" | "feature">("repository");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/handbook`, {
        method: "POST",
        body: JSON.stringify({ repositoryId: repo.id, audience: String(f.get("audience")), scope, focus: String(f.get("focus") ?? ""), instructions: String(f.get("instructions") ?? "") }),
      });
      setOpen(false);
      onStarted?.(jobId);
    } catch (err) {
      setError(errorMessage(err, "Could not start the handbook."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate handbook</DialogTitle>
          <DialogDescription>
            GitFill explores <span className="font-medium text-foreground">{repo.fullName}</span>, records evidence for every statement, and writes a handbook with diagrams, workflows, a presentation guide and Q&amp;A.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <Label htmlFor="h-aud">Kind</Label>
            <Select id="h-aud" name="audience" defaultValue="technical_handbook">
              {AUDIENCES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="h-scope">Scope</Label>
            <Select id="h-scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="repository">Whole repository</option>
              <option value="module">One module</option>
              <option value="feature">One feature</option>
            </Select>
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="h-focus">{scope === "module" ? "Module path" : scope === "feature" ? "Feature" : "Focus (optional)"}</Label>
            <Input id="h-focus" name="focus" placeholder={scope === "module" ? "e.g. src/auth" : scope === "feature" ? "e.g. the payment request lifecycle" : "e.g. emphasize the data model"} required={scope !== "repository"} />
          </div>
          <div className="sm:col-span-6">
            <Label htmlFor="h-ins">Instructions <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="h-ins" name="instructions" className="min-h-16" placeholder="e.g. The audience are backend engineers new to Go." />
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-6">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Generate</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
