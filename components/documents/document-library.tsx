"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileSearch, FileText, GitBranch, GitCompareArrows, Lightbulb, MessageSquareText, Search, Sparkles } from "lucide-react";
import { DOCUMENT_KIND_LABELS } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HandbookDialog } from "@/components/workspace/handbook-dialog";
import { recentDocumentIds } from "@/lib/client/recent-documents";
import type { DocumentKind, DocumentSummary, RepoView, WorkspaceSummary } from "@/lib/client/types";
import { cn, timeAgo } from "@/lib/utils";

const KINDS: Record<DocumentKind, { icon: typeof BookOpen; tone: string; plural: string }> = {
  handbook: { icon: BookOpen, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", plural: "Handbooks" },
  commit_report: { icon: GitCompareArrows, tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400", plural: "Commit reports" },
  implementation_brief: { icon: FileSearch, tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400", plural: "Implementation briefs" },
  explanation: { icon: MessageSquareText, tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400", plural: "Explanations" },
  readme: { icon: FileText, tone: "bg-rose-500/10 text-rose-700 dark:text-rose-400", plural: "READMEs" },
  brainstorm: { icon: Lightbulb, tone: "bg-teal-500/10 text-teal-700 dark:text-teal-400", plural: "Brainstorm specs" },
};

type Filter = "all" | DocumentKind;

/**
 * The document library: search and type filters, recently opened documents, a card grid with
 * a preview and an evidence meter per document, and (across workspaces) the repositories that
 * have no handbook yet, each one click from generating it.
 */
export function DocumentLibrary({ documents, workspaces, showWorkspace = true }: { documents: DocumentSummary[]; workspaces?: WorkspaceSummary[]; showWorkspace?: boolean }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(recentDocumentIds()), []);

  const counts = useMemo(() => {
    const c: Partial<Record<DocumentKind, number>> = {};
    for (const d of documents) c[d.kind] = (c[d.kind] ?? 0) + 1;
    return c;
  }, [documents]);

  const q = query.trim().toLowerCase();
  const shown = documents.filter(
    (d) => (filter === "all" || d.kind === filter) && (!q || [d.title, d.repository, d.excerpt, d.workspaceName].some((v) => v?.toLowerCase().includes(q))),
  );
  const browsing = !q && filter === "all";
  const recentDocs = browsing ? recent.map((id) => documents.find((d) => d.id === id)).filter((d): d is DocumentSummary => Boolean(d)).slice(0, 3) : [];
  const missing = browsing && workspaces ? reposWithoutHandbook(workspaces, documents) : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Document type">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={documents.length} />
          {(Object.keys(KINDS) as DocumentKind[])
            .filter((k) => counts[k])
            .map((k) => (
              <Chip key={k} active={filter === k} onClick={() => setFilter(k)} label={KINDS[k].plural} count={counts[k]!} />
            ))}
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, repositories, content…" className="pl-9" />
        </div>
      </div>

      {recentDocs.length ? (
        <Section title="Recently viewed">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recentDocs.map((d) => (
              <DocumentCard key={d.id} doc={d} showWorkspace={showWorkspace} compact />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title={browsing ? "All documents" : `${shown.length} result${shown.length === 1 ? "" : "s"}`}>
        {shown.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {shown.map((d) => (
              <DocumentCard key={d.id} doc={d} showWorkspace={showWorkspace} />
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {documents.length ? `No documents match${q ? ` “${query.trim()}”` : " this filter"}.` : "No documents yet. Generate a handbook below, or ask GitFill a question in a workspace session."}
          </p>
        )}
      </Section>

      {missing.length ? (
        <Section title="Repositories without a handbook" hint="Generate one: GitFill reads the code and cites every statement.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {missing.map(({ repo, workspace }) => (
              <MissingRepoCard key={`${workspace.id}:${repo.id}`} repo={repo} workspace={workspace} showWorkspace={showWorkspace} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function reposWithoutHandbook(workspaces: WorkspaceSummary[], documents: DocumentSummary[]) {
  const covered = new Set(documents.filter((d) => d.kind === "handbook" && d.repository).map((d) => `${d.workspaceId}:${d.repository!.toLowerCase()}`));
  const seen = new Set<string>();
  return workspaces.flatMap((workspace) =>
    workspace.repositories
      .filter((repo) => {
        const name = repo.fullName.toLowerCase();
        // One entry per repository, even when several workspaces (or one, twice) include it.
        if (!repo.analyzable || seen.has(name) || covered.has(`${workspace.id}:${name}`)) return false;
        seen.add(name);
        return true;
      })
      .map((repo) => ({ repo, workspace })),
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("text-xs tabular-nums", active ? "text-background/70" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function DocumentCard({ doc, showWorkspace, compact = false }: { doc: DocumentSummary; showWorkspace: boolean; compact?: boolean }) {
  const kind = KINDS[doc.kind] ?? KINDS.handbook;
  const Icon = kind.icon;
  const total = doc.claims?.total ?? 0;
  const verified = doc.claims?.verified ?? 0;
  return (
    <Link href={`/documents/${doc.id}`} className="group block h-full">
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors group-hover:border-foreground/25 group-hover:bg-accent/30">
        <div className="flex items-start gap-3">
          <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", kind.tone)}>
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{doc.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {DOCUMENT_KIND_LABELS[doc.kind]} · {timeAgo(doc.createdAt)}
            </p>
          </div>
        </div>
        {!compact && doc.excerpt ? <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{doc.excerpt}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-1 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">
              {doc.repository ?? "repository"}
              {doc.commitSha ? <span className="font-mono"> @ {doc.commitSha.slice(0, 7)}</span> : null}
              {showWorkspace ? ` · ${doc.workspaceName}` : ""}
            </span>
          </span>
          {total ? <EvidenceMeter verified={verified} total={total} /> : null}
        </div>
      </Card>
    </Link>
  );
}

function EvidenceMeter({ verified, total }: { verified: number; total: number }) {
  const pct = Math.round((verified / total) * 100);
  return (
    <span className="flex shrink-0 items-center gap-2" title={`${verified} of ${total} claims verified against the source`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">
        {verified}/{total}
      </span>
    </span>
  );
}

function MissingRepoCard({ repo, workspace, showWorkspace }: { repo: RepoView; workspace: WorkspaceSummary; showWorkspace: boolean }) {
  const router = useRouter();
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <GitBranch className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{repo.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">{showWorkspace ? workspace.name : repo.description ?? repo.defaultBranch ?? "No handbook yet"}</p>
      </div>
      <HandbookDialog
        workspaceId={workspace.id}
        repo={repo}
        onStarted={(jobId) => router.push(`/jobs/${jobId}`)}
        trigger={
          <Button size="sm" variant="outline">
            <Sparkles />
            Generate
          </Button>
        }
      />
    </Card>
  );
}
