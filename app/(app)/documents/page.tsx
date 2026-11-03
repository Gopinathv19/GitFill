"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { DocumentLibrary } from "@/components/documents/document-library";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { usePageTitle } from "@/lib/client/use-page-title";
import type { DocumentSummary, WorkspaceSummary } from "@/lib/client/types";

export default function DocumentsPage() {
  usePageTitle("Documents");
  const [data, setData] = useState<{ documents: DocumentSummary[]; workspaces: WorkspaceSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api<DocumentSummary[]>("/api/documents"), api<WorkspaceSummary[]>("/api/workspaces").catch(() => [])]).then(
      ([documents, workspaces]) => setData({ documents, workspaces }),
      (e: Error) => setError(e.message),
    );
  }, []);
  const hasRepos = data?.workspaces.some((w) => w.repositories.length) ?? false;
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Handbooks, commit reports, implementation briefs and saved explanations, across workspaces. Every statement links to the lines that support it." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      )}
      {data && !data.documents.length && !hasRepos ? (
        <EmptyState icon={BookOpen} title="No documents yet" description="Open a workspace and ask GitFill for a handbook, a commit comparison or an implementation brief." />
      ) : data ? (
        <DocumentLibrary documents={data.documents} workspaces={data.workspaces} />
      ) : null}
    </div>
  );
}
