"use client";

import Link from "next/link";
import { BookOpen, FileText, PanelRightClose, Plus } from "lucide-react";
import { JOB_KIND_LABELS, JobStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { AddRepositoryDialog } from "@/components/workspace/add-repository-dialog";
import { RepoRow } from "@/components/workspace/repo-row";
import type { WorkspaceDetail } from "@/lib/client/types";

/** Right-hand panel of a session: the workspace's repositories, documents, presentations and jobs. */
export function WorkspacePanel({ data, reload, onActivity, onClose }: { data: WorkspaceDetail; reload: () => void; onActivity: () => void; onClose: () => void }) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-sidebar/40">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <Link href={`/workspaces/${data.id}/repositories`} className="truncate text-sm font-semibold hover:underline">
          {data.name}
        </Link>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onClose} aria-label="Hide workspace panel">
          <PanelRightClose className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Repositories</h2>
            <AddRepositoryDialog workspaceId={data.id} onAdded={reload} trigger={<Button variant="ghost" size="icon" className="size-7" aria-label="Add repository"><Plus /></Button>} />
          </div>
          {data.repositories.length === 0 && <p className="text-sm text-muted-foreground">No repositories yet. Add one to start.</p>}
          {data.repositories.map((r) => <RepoRow key={r.id} workspaceId={data.id} repo={r} compact onStarted={onActivity} />)}
        </section>
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Documents</h2>
          {data.documents.length === 0 && <p className="text-sm text-muted-foreground">Handbooks, commit reports and briefs appear here.</p>}
          {data.documents.slice(0, 5).map((d) => (
            <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent">
              <div className="grid size-9 w-10 shrink-0 place-items-center rounded border bg-muted"><BookOpen className="size-4 text-muted-foreground" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">{d.kind.replace(/_/g, " ")}{d.repository ? ` · ${d.repository}` : ""}</p>
              </div>
            </Link>
          ))}
          {data.documents.length > 5 && <Link href={`/workspaces/${data.id}/documents`} className="block text-xs text-muted-foreground hover:underline">All {data.documents.length} documents</Link>}
        </section>
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Presentations</h2>
          {data.presentations.length === 0 && <p className="text-sm text-muted-foreground">Presentations you generate appear here.</p>}
          {data.presentations.slice(0, 5).map((p) => (
            <Link key={p.id} href={`/presentations/${p.id}`} className="flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:bg-accent">
              {p.previewArtifactId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/artifacts/${p.previewArtifactId}`} alt="" className="h-9 w-16 shrink-0 rounded border object-cover" />
              ) : (
                <div className="grid h-9 w-16 shrink-0 place-items-center rounded border bg-muted"><FileText className="size-4 text-muted-foreground" /></div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-xs text-muted-foreground">v{p.latestVersion}</p>
              </div>
            </Link>
          ))}
          {data.presentations.length > 5 && <Link href={`/workspaces/${data.id}/presentations`} className="block text-xs text-muted-foreground hover:underline">All {data.presentations.length} presentations</Link>}
        </section>
        {data.jobs.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recent jobs</h2>
            {data.jobs.slice(0, 5).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <span className="truncate text-muted-foreground">{JOB_KIND_LABELS[j.kind] ?? j.kind}</span>
                <JobStatusBadge status={j.status} />
              </Link>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
