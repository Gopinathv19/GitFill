"use client";

import { use } from "react";
import { Presentation } from "lucide-react";
import { DeckGrid } from "@/components/presentation/deck-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { useWorkspace } from "@/lib/client/use-workspace";

export default function WorkspacePresentationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useWorkspace(id);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-6">
      <WorkspaceHeader id={data.id} name={data.name} description={data.description} />
      {data.presentations.length === 0 ? (
        <EmptyState icon={Presentation} title="No presentations yet" description="Ask in chat, or use Generate deck on a repository." />
      ) : (
        <DeckGrid decks={data.presentations} />
      )}
    </div>
  );
}
