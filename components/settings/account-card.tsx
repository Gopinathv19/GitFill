"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GithubIcon } from "@/components/shared/github-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client/api";
import type { GitHubConnection, SessionUser } from "@/lib/client/types";
import { getInitials, timeAgo } from "@/lib/utils";

/** The signed-in account and its GitHub connection (repositories are read as this account). */
export function AccountCard({ user, oauthConfigured }: { user: SessionUser; oauthConfigured: boolean }) {
  const [state, setState] = useState<GitHubConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api<{ github: GitHubConnection }>("/api/auth/me").then((r) => setState(r.github), (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    const flag = new URLSearchParams(window.location.search).get("github");
    if (flag === "connected") setNotice("GitHub connected.");
    else if (flag) setNotice(`GitHub connection failed (${flag.replace(/_/g, " ")}). Please try again.`);
  }, []);

  async function disconnect() {
    if (!window.confirm("Disconnect GitHub? Private repositories in your workspaces will stop working until you reconnect.")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/github/disconnect", { method: "POST" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not disconnect."));
    } finally {
      setBusy(false);
    }
  }

  const name = user.name ?? user.login;
  return (
    <Card className="divide-y">
      <div className="flex items-center gap-4 p-5">
        <Avatar className="size-12">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white">{getInitials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">@{user.login}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <GithubIcon className="size-5 shrink-0" />
          <div className="min-w-0 text-sm">
            {!state ? (
              <p className="text-muted-foreground">{error ? "GitHub" : "Loading…"}</p>
            ) : state.connected ? (
              <>
                <p className="font-medium">Connected as @{state.login}</p>
                {state.connectedAt ? <p className="text-xs text-muted-foreground">Connected {timeAgo(state.connectedAt)}</p> : null}
              </>
            ) : (
              <p className="font-medium">GitHub not connected</p>
            )}
          </div>
        </div>
        {state && (
          <div className="flex items-center gap-2">
            {oauthConfigured && (
              <Button asChild variant={state.connected ? "outline" : "default"} size="sm">
                <a href="/api/auth/github?mode=connect&next=%2Fsettings">
                  <GithubIcon />
                  {state.connected ? "Reconnect" : "Connect GitHub"}
                </a>
              </Button>
            )}
            {state.connected && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                {busy && <Loader2 className="animate-spin" />}
                Disconnect
              </Button>
            )}
          </div>
        )}
        {(notice || error) && <p className={`w-full text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ?? notice}</p>}
      </div>
    </Card>
  );
}
