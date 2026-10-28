"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FileJson, Trash2 } from "lucide-react";
import { Markdown } from "@/components/shared/markdown";
import { PageHeader } from "@/components/shared/page-header";
import { DOCUMENT_KIND_LABELS, JobStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client/api";
import type { DocumentView as DocumentViewData } from "@/lib/client/types";
import { cn } from "@/lib/utils";

/** A generated document: rendered Markdown with Mermaid, plus its evidence table and sources. */
export function DocumentView({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"document" | "evidence">("document");

  useEffect(() => {
    api<DocumentViewData>(`/api/documents/${documentId}`).then(setDoc, (e: Error) => setError(e.message));
  }, [documentId]);

  async function remove() {
    if (!doc || !window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/documents/${documentId}`, { method: "DELETE" });
      router.push(`/workspaces/${doc.workspaceId}/documents`);
    } catch (err) {
      setError(errorMessage(err, "Could not delete the document."));
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!doc) return <p className="text-sm text-muted-foreground">Loading document…</p>;

  const counts = doc.claimCounts;
  const primary = doc.snapshots.find((s) => s.role === "primary");
  const linkFor = (c: DocumentViewData["claims"][number]) => {
    const snap = doc.snapshots.find((s) => s.id === c.snapshotId);
    if (!snap || !c.filePath) return null;
    const anchor = c.startLine ? `#L${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-L${c.endLine}` : ""}` : "";
    return `${snap.repositoryUrl}/blob/${snap.commitSha}/${c.filePath}${anchor}`;
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push(`/workspaces/${doc.workspaceId}/documents`)}>
        <ArrowLeft /> {doc.workspaceName}
      </Button>
      <PageHeader
        title={doc.title}
        description={
          <>
            {DOCUMENT_KIND_LABELS[doc.kind]} · {doc.snapshots.map((s) => `${s.owner}/${s.name} @ ${s.commitSha.slice(0, 7)}`).join(" · ") || doc.repository}
            {counts?.total ? ` · ${counts.verified ?? 0} verified, ${counts.inferred ?? 0} inferred, ${counts.unverified ?? 0} unverified claims` : ""}
          </>
        }
        actions={
          <>
            {doc.job && doc.job.status !== "completed" && <JobStatusBadge status={doc.job.status} />}
            {doc.job && (
              <Button asChild variant="ghost" size="sm"><Link href={`/jobs/${doc.job.id}`}>Activity</Link></Button>
            )}
            <Button asChild variant="outline" size="sm"><a href={`/api/documents/${doc.id}/download?format=md`}><Download />Markdown</a></Button>
            <Button asChild variant="outline" size="sm"><a href={`/api/documents/${doc.id}/download?format=json`}><FileJson />JSON</a></Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label="Delete document" onClick={() => void remove()}><Trash2 /></Button>
          </>
        }
      />

      <div className="flex gap-1 border-b">
        {(["document", "evidence"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize", tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t === "evidence" ? `Evidence (${doc.claims.length})` : "Document"}
          </button>
        ))}
      </div>

      {tab === "document" && (
        <Card>
          <CardContent className="p-6 sm:p-8">
            <Markdown>{doc.markdown}</Markdown>
          </CardContent>
        </Card>
      )}

      {tab === "evidence" && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Recorded claims</CardTitle>
            <CardDescription>Every claim the agent recorded while reading {primary ? `${primary.owner}/${primary.name}` : "the repository"}. GitFill verified each one against the cited lines; the model never assigns a status.</CardDescription>
          </CardHeader>
          <ul className="divide-y text-sm">
            {doc.claims.length === 0 && <li className="px-6 py-4 text-muted-foreground">No claims were recorded for this document.</li>}
            {doc.claims.map((c) => {
              const href = linkFor(c);
              return (
                <li key={`${c.snapshotId}-${c.ref}`} className="grid grid-cols-[3.5rem_1fr] gap-3 px-6 py-3 sm:grid-cols-[3.5rem_1fr_auto]">
                  <span className="font-mono text-xs text-muted-foreground">{c.ref}</span>
                  <div className="min-w-0">
                    <p>{c.claim}</p>
                    {c.filePath && (
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:underline">{c.filePath}{c.startLine ? `:${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-${c.endLine}` : ""}` : ""}</a> : c.filePath}
                      </p>
                    )}
                  </div>
                  <Badge variant={c.status === "verified" ? "success" : c.status === "inferred" ? "info" : "warning"} className="h-fit self-start">{c.status}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
