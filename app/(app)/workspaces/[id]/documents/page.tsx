"use client";

import { use, useEffect, useState } from "react";
import { BookOpen, GitCompareArrows } from "lucide-react";
import { DocumentList } from "@/components/documents/document-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { ReuseDialog } from "@/components/workspace/reuse-dialog";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { api } from "@/lib/client/api";
import type { DocumentSummary } from "@/lib/client/types";
import { useWorkspace } from "@/lib/client/use-workspace";

export default function WorkspaceDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useWorkspace(id);
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  useEffect(() => {
    api<DocumentSummary[]>(`/api/documents?workspaceId=${id}`).then(setDocs, () => setDocs([]));
  }, [id, data?.documents.length]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const reuse = data.repositories.filter((r) => r.analyzable).length >= 2 && (
    <ReuseDialog workspaceId={id} repositories={data.repositories} onStarted={reload} trigger={<Button variant="outline"><GitCompareArrows />Reuse architecture</Button>} />
  );
  return (
    <div className="space-y-6">
      <WorkspaceHeader id={data.id} name={data.name} description={data.description} actions={reuse || undefined} />
      {docs?.length === 0 ? (
        <EmptyState icon={BookOpen} title="No documents yet" description="Use Handbook or Compare commits on a repository, ask a question in chat, or write an implementation brief between two repositories." action={reuse || undefined} />
      ) : docs ? (
        <DocumentList documents={docs} showWorkspace={false} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
