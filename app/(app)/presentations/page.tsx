"use client";

import { Presentation } from "lucide-react";
import { DeckGrid } from "@/components/presentation/deck-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/input";
import { useRecent } from "@/lib/client/use-recent";

export default function PresentationsPage() {
  const { data, error } = useRecent();
  return (
    <div className="space-y-6">
      <PageHeader title="Presentations" description="Every deck you've generated, across workspaces." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-video" />)}</div>}
      {data?.decks.length === 0 && <EmptyState icon={Presentation} title="No presentations yet" description="Open a workspace and ask GitFill to build one." />}
      {data && data.decks.length > 0 && <DeckGrid decks={data.decks} />}
    </div>
  );
}
