"use client";

import Link from "next/link";
import { use } from "react";
import { PanelRightOpen } from "lucide-react";
import { ResizeHandle, usePanelOpen, usePanelWidth } from "@/components/layout/resizable";
import { PageHeader } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/workspace/chat-panel";
import { SessionMenu } from "@/components/workspace/session-menu";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { useSessions } from "@/lib/client/sessions-store";
import { useWorkspace } from "@/lib/client/use-workspace";
import { refreshWorkspaces } from "@/lib/client/workspaces-store";

const PANEL = { initial: 320, min: 260, max: 560 };

/** A chat session: the conversation in the middle, the workspace panel on the right (resizable, collapsible). */
export default function SessionPage({ params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = use(params);
  const { data, error, reload } = useWorkspace(id);
  const sessions = useSessions();
  const session = sessions.data?.find((s) => s.id === sessionId);
  const [panelOpen, togglePanel] = usePanelOpen("gitfill.panel.open", true);
  const panel = usePanelWidth("gitfill.panel.width", PANEL.initial, PANEL.min, PANEL.max);
  const onActivity = () => {
    reload();
    void refreshWorkspaces();
  };

  if (error) return <p className="p-8 text-sm text-destructive">{error}</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium">{session?.title ?? "Session"}</h1>
          {data && (
            <Link href={`/workspaces/${id}`} className="hidden shrink-0 text-xs text-muted-foreground hover:text-foreground sm:inline">
              {data.name}
            </Link>
          )}
        </div>
        {session && <SessionMenu session={session} active className="size-8" />}
        {!panelOpen && (
          <Button variant="ghost" size="icon" className="hidden size-8 text-muted-foreground lg:inline-flex" onClick={() => togglePanel(true)} aria-label="Show workspace panel">
            <PanelRightOpen className="size-4" />
          </Button>
        )}
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        {data ? (
          <ChatPanel key={sessionId} workspaceId={id} sessionId={sessionId} repositories={data.repositories} onActivity={onActivity} />
        ) : (
          <p className="flex-1 p-8 text-sm text-muted-foreground">Loading session…</p>
        )}
        {data && panelOpen && (
          <aside className="relative hidden h-full shrink-0 border-l lg:block" style={{ width: panel.width }}>
            <ResizeHandle edge="left" label="Resize workspace panel" width={panel.width} onResize={panel.set} onCommit={panel.commit} onReset={panel.reset} />
            <WorkspacePanel data={data} reload={reload} onActivity={onActivity} onClose={() => togglePanel(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}
