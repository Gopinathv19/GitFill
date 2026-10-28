"use client";

import Link from "next/link";
import { BookOpen, FileSearch, GitCompareArrows, MessageSquareText } from "lucide-react";
import { DOCUMENT_KIND_LABELS } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DocumentKind, DocumentSummary } from "@/lib/client/types";
import { timeAgo } from "@/lib/utils";

const ICONS: Record<DocumentKind, typeof BookOpen> = { handbook: BookOpen, commit_report: GitCompareArrows, implementation_brief: FileSearch, explanation: MessageSquareText };

export function DocumentList({ documents, showWorkspace = true }: { documents: DocumentSummary[]; showWorkspace?: boolean }) {
  return (
    <Card className="divide-y">
      {documents.map((d) => {
        const Icon = ICONS[d.kind] ?? BookOpen;
        return (
          <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/50">
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {DOCUMENT_KIND_LABELS[d.kind]} · {d.repository ?? "repository"}{d.commitSha ? ` @ ${d.commitSha.slice(0, 7)}` : ""} · {timeAgo(d.createdAt)}{showWorkspace ? ` · ${d.workspaceName}` : ""}
              </p>
            </div>
            {d.claims?.total ? (
              <Badge variant="outline" className="shrink-0">{d.claims.verified ?? 0}/{d.claims.total} verified</Badge>
            ) : null}
          </Link>
        );
      })}
    </Card>
  );
}
