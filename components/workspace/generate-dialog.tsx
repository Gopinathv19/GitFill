"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { RepoView } from "@/lib/client/types";

/** Starts a presentation for a repository without going through chat. */
export function GenerateDialog({ workspaceId, repo, trigger, onStarted }: { workspaceId: string; repo: RepoView; trigger: React.ReactNode; onStarted?: (jobId: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          repositoryId: repo.id,
          audience: String(f.get("audience")),
          purpose: String(f.get("purpose")),
          slideCount: Number(f.get("slideCount")),
          theme: String(f.get("theme")),
          instructions: String(f.get("instructions") ?? ""),
          outputs: { pdf: f.get("pdf") === "on", readme: f.get("readme") === "on", illustrations: f.get("illustrations") === "on" },
        }),
      });
      setOpen(false);
      if (onStarted) onStarted(jobId);
      else router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(errorMessage(err, "Could not start the job."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate presentation</DialogTitle>
          <DialogDescription>
            From <span className="font-medium text-foreground">{repo.fullName}</span> at the latest commit of {repo.defaultBranch ?? "the default branch"}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Label htmlFor="g-aud">Audience</Label>
            <Input id="g-aud" name="audience" defaultValue="Engineering managers" required />
          </div>
          <div className="sm:col-span-1">
            <Label htmlFor="g-n">Slides</Label>
            <Input id="g-n" name="slideCount" type="number" min={4} max={16} defaultValue={8} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="g-theme">Theme</Label>
            <Select id="g-theme" name="theme" defaultValue="midnight">
              <option value="midnight">Midnight</option>
              <option value="daylight">Daylight</option>
            </Select>
          </div>
          <div className="sm:col-span-6">
            <Label htmlFor="g-purpose">Purpose</Label>
            <Input id="g-purpose" name="purpose" defaultValue="Explain the architecture, key components, data flow, technology stack and deployment." />
          </div>
          <div className="sm:col-span-6">
            <Label htmlFor="g-ins">Additional instructions <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="g-ins" name="instructions" className="min-h-16" placeholder="e.g. Emphasize the database design." />
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:col-span-6">
            <legend className="mb-2 text-sm font-medium">Also produce</legend>
            {[["pdf", "PDF"], ["readme", "README.md"], ["illustrations", "Muse Image artwork"]].map(([name, label]) => (
              <label key={name} className="inline-flex items-center gap-2">
                <input type="checkbox" name={name} defaultChecked className="size-4 accent-[hsl(var(--primary))]" />
                {label}
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-6">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Generate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
