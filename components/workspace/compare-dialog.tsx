"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { CommitLite, RepoView } from "@/lib/client/types";

/** Starts a commit comparison. Recent commits are listed for picking; any ref (sha, branch, tag) can be typed. */
export function CompareDialog({ workspaceId, repo, trigger, onStarted }: { workspaceId: string; repo: RepoView; trigger: React.ReactNode; onStarted?: (jobId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commits, setCommits] = useState<CommitLite[] | null>(null);
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || commits) return;
    api<{ commits: CommitLite[] }>(`/api/workspaces/${workspaceId}/repositories/${repo.id}/commits`)
      .then((r) => {
        setCommits(r.commits);
        if (r.commits[0]) setHead((h) => h || r.commits[0]!.sha);
        if (r.commits[1]) setBase((b) => b || r.commits[Math.min(5, r.commits.length - 1)]!.sha);
      })
      .catch((e: Error) => setError(e.message));
  }, [open, commits, workspaceId, repo.id]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/compare`, {
        method: "POST",
        body: JSON.stringify({ repositoryId: repo.id, base: base.trim(), head: head.trim(), focus: String(f.get("focus") ?? "") || undefined }),
      });
      setOpen(false);
      onStarted?.(jobId);
    } catch (err) {
      setError(errorMessage(err, "Could not start the comparison."));
    } finally {
      setBusy(false);
    }
  }

  const pick = (sha: string) => {
    if (!head) setHead(sha);
    else if (!base) setBase(sha);
    else setBase(sha);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare commits</DialogTitle>
          <DialogDescription>
            Explains what changed between two points of <span className="font-medium text-foreground">{repo.fullName}</span>: moved responsibilities, new layers, changed interfaces, affected tests. Facts are measured; intent is labelled as hypothesis.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="c-base">Base (older)</Label>
            <Input id="c-base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="sha, branch or tag" required className="font-mono text-xs" />
          </div>
          <div>
            <Label htmlFor="c-head">Head (newer)</Label>
            <Input id="c-head" value={head} onChange={(e) => setHead(e.target.value)} placeholder="sha, branch or tag" required className="font-mono text-xs" />
          </div>
          <div className="sm:col-span-2">
            <Label>Recent commits on {repo.defaultBranch ?? "the default branch"} <span className="font-normal text-muted-foreground">(click to fill head, then base)</span></Label>
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border text-xs">
              {!commits && !error && <p className="p-3 text-muted-foreground">Loading commits…</p>}
              {commits?.map((c) => (
                <button type="button" key={c.sha} onClick={() => pick(c.sha)} className="flex w-full items-center gap-3 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-accent">
                  <span className={`font-mono ${c.sha === head ? "text-emerald-600" : c.sha === base ? "text-sky-600" : "text-muted-foreground"}`}>{c.sha.slice(0, 7)}</span>
                  <span className="truncate">{c.message}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{c.author ?? ""}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="c-focus">Focus <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="c-focus" name="focus" className="min-h-14" placeholder="e.g. Focus on the service layer refactor and what it means for the API." />
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !base || !head}>{busy && <Loader2 className="animate-spin" />}Compare</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
