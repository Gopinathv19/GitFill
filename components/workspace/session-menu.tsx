"use client";

import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import { refreshSessions } from "@/lib/client/sessions-store";
import type { ChatSession } from "@/lib/client/types";
import { cn } from "@/lib/utils";

/** Rename / delete actions for a session, used in the sidebar and the session header. */
export function SessionMenu({ session, active, className }: { session: Pick<ChatSession, "id" | "title" | "workspaceId">; active?: boolean; className?: string }) {
  const router = useRouter();

  async function rename() {
    const title = window.prompt("Rename session", session.title)?.trim();
    if (!title || title === session.title) return;
    await api(`/api/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ title }) }).catch(() => window.alert("Could not rename the session."));
    await refreshSessions();
  }

  async function remove() {
    if (!window.confirm(`Delete "${session.title}"? Its messages are removed; documents and presentations it created are kept.`)) return;
    try {
      await api(`/api/sessions/${session.id}`, { method: "DELETE" });
    } catch {
      window.alert("Could not delete the session.");
      return;
    }
    await refreshSessions();
    if (active) router.push(`/workspaces/${session.workspaceId}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("size-6", className)} aria-label={`Actions for ${session.title}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => void rename()}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void remove()} className="text-destructive focus:text-destructive">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
