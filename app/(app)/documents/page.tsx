"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { DocumentList } from "@/components/documents/document-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { DocumentSummary } from "@/lib/client/types";

export default function DocumentsPage() {
  const [data, setData] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<DocumentSummary[]>("/api/documents").then(setData, (e: Error) => setError(e.message));
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Handbooks, commit reports, implementation briefs and saved explanations, across workspaces. Every statement links to the lines that support it." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
      {data?.length === 0 && <EmptyState icon={BookOpen} title="No documents yet" description="Open a workspace and ask GitFill for a handbook, a commit comparison or an implementation brief." />}
      {data && data.length > 0 && <DocumentList documents={data} />}
    </div>
  );
}
