"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { JOB_KIND_LABELS, JobStatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { useRecent } from "@/lib/client/use-recent";
import { timeAgo } from "@/lib/utils";

export default function ActivityPage() {
  const { data, error } = useRecent();
  return (
    <div className="space-y-6">
      <PageHeader title="Activity" description="Every job GitFill ran: handbooks, comparisons, briefs, presentations. Open one to see every recorded tool and model call." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.jobs.length === 0 && <EmptyState icon={Activity} title="No jobs yet" />}
      {data && data.jobs.length > 0 && (
        <Card className="divide-y">
          {data.jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-accent/50">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {JOB_KIND_LABELS[j.kind] ?? j.kind} · {j.repositoryUrl.replace("https://github.com/", "")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {j.workspaceName} · {timeAgo(j.createdAt)} · {j.prompt}
                </p>
              </div>
              <JobStatusBadge status={j.status} />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
