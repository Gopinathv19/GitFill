"use client";

import { use, useState } from "react";
import { FolderGit2, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AddRepositoryDialog } from "@/components/workspace/add-repository-dialog";
import { RepoRow } from "@/components/workspace/repo-row";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { api, errorMessage } from "@/lib/client/api";
import { useWorkspace } from "@/lib/client/use-workspace";
import { refreshWorkspaces } from "@/lib/client/workspaces-store";

export default function WorkspaceRepositoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useWorkspace(id);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(repoId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this workspace? Presentations already generated are kept.`)) return;
    try {
      await api(`/api/workspaces/${id}/repositories/${repoId}`, { method: "DELETE" });
      reload();
      void refreshWorkspaces();
    } catch (err) {
      setActionError(errorMessage(err, "Could not remove the repository."));
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const add = <AddRepositoryDialog workspaceId={id} onAdded={reload} trigger={<Button><Plus />Add repository</Button>} />;

  return (
    <div className="space-y-6">
      <WorkspaceHeader id={data.id} name={data.name} description={data.description} actions={add} />
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      {data.repositories.length === 0 ? (
        <EmptyState icon={FolderGit2} title="No repositories yet" description="Import a GitHub repository, or create a new one inside this workspace." action={add} />
      ) : (
        <div className="space-y-2">
          {data.repositories.map((r) => <RepoRow key={r.id} workspaceId={id} repo={r} onRemove={() => void remove(r.id, r.fullName)} />)}
        </div>
      )}
    </div>
  );
}
