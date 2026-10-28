"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label, Select, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { RepoView } from "@/lib/client/types";

const KINDS = [
  ["architectural", "Architecture", "Reproduce structure and conventions, not code"],
  ["component", "Component", "Adapt a specific module or component"],
  ["implementation", "Implementation", "Copy or adapt actual code where appropriate"],
  ["design", "Design", "UI patterns, layouts, component conventions"],
  ["dependency", "Dependencies", "Libraries, configuration and infrastructure"],
] as const;

/** Starts an implementation brief: reference repo → target repo, with the kinds of reuse requested. */
export function ReuseDialog({ workspaceId, repositories, trigger, onStarted, defaultTargetId }: { workspaceId: string; repositories: RepoView[]; trigger: React.ReactNode; onStarted?: (jobId: string) => void; defaultTargetId?: string }) {
  const analyzable = repositories.filter((r) => r.analyzable);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reuseKinds = KINDS.map(([k]) => k).filter((k) => f.get(`kind-${k}`) === "on");
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/reuse`, {
        method: "POST",
        body: JSON.stringify({ referenceRepositoryId: String(f.get("reference")), targetRepositoryId: String(f.get("target")), request: String(f.get("request")), reuseKinds: reuseKinds.length ? reuseKinds : ["architectural"] }),
      });
      setOpen(false);
      onStarted?.(jobId);
    } catch (err) {
      setError(errorMessage(err, "Could not start the brief."));
    } finally {
      setBusy(false);
    }
  }

  const defaultReference = analyzable.find((r) => r.id !== defaultTargetId)?.id;
  const defaultTarget = defaultTargetId ?? analyzable.find((r) => r.id !== defaultReference)?.id;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reuse architecture between repositories</DialogTitle>
          <DialogDescription>GitFill extracts the patterns you name from the reference, maps them onto the target, and writes a file-by-file implementation brief you can hand to a coding agent.</DialogDescription>
        </DialogHeader>
        {analyzable.length < 2 ? (
          <p className="text-sm text-muted-foreground">Add at least two GitHub repositories to this workspace first.</p>
        ) : (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="r-ref">Reference (patterns come from)</Label>
              <Select id="r-ref" name="reference" defaultValue={defaultReference}>
                {analyzable.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="r-tgt">Target (where the work happens)</Label>
              <Select id="r-tgt" name="target" defaultValue={defaultTarget}>
                {analyzable.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="r-req">What to reuse, and what to keep</Label>
              <Textarea id="r-req" name="request" required minLength={10} className="min-h-24" placeholder="e.g. Follow the reference's service and repository layering and error handling, but keep the target's existing business logic, database models and authentication." />
            </div>
            <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Kinds of reuse</legend>
              {KINDS.map(([k, label, desc]) => (
                <label key={k} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <input type="checkbox" name={`kind-${k}`} defaultChecked={k === "architectural"} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
                  <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{desc}</span></span>
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Write brief</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
