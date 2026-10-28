"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { GithubIcon } from "@/components/shared/github-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client/api";
import type { GitHubConnection } from "@/lib/client/types";
import { timeAgo } from "@/lib/utils";

/** Connect, reconnect or disconnect the user's GitHub account. Repositories are read as this account. */
export function GitHubConnectionCard({ oauthConfigured, scopes }: { oauthConfigured: boolean; scopes: string }) {
  const [state, setState] = useState<GitHubConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api<{ github: GitHubConnection }>("/api/auth/me").then((r) => setState(r.github), (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    const flag = new URLSearchParams(window.location.search).get("github");
    if (flag === "connected") setNotice("GitHub connected. Your repositories are now read with your own account.");
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

  const connectHref = "/api/auth/github?mode=connect&next=%2Fsettings";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><GithubIcon className="size-4" />GitHub access</CardTitle>
        <CardDescription>
          GitFill reads repositories as you: your permissions, your rate limit, your private repositories. The token is stored encrypted and used for nothing else. Requested scopes: <span className="font-mono text-foreground">{scopes}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && <p className="rounded-md border bg-muted px-3 py-2 text-sm">{notice}</p>}
        {!state && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex items-start gap-3">
              {state.connected ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-5 text-amber-500" />}
              <div className="text-sm">
                {state.connected ? (
                  <>
                    <p className="font-medium">Connected as @{state.login}</p>
                    <p className="text-xs text-muted-foreground">
                      {state.privateAccess ? "Public and private repositories" : "Public repositories only (no repo scope granted)"} · scopes: {state.scopes.join(", ") || "none"}
                      {state.connectedAt ? ` · connected ${timeAgo(state.connectedAt)}` : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Not connected</p>
                    <p className="text-xs text-muted-foreground">Public repositories are read with the server&apos;s shared token (60 requests/hour without GITHUB_TOKEN). Connect to use your own account and private repositories.</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {oauthConfigured ? (
                <Button asChild variant={state.connected ? "outline" : "default"} size="sm">
                  <a href={connectHref}><GithubIcon />{state.connected ? "Reconnect" : "Connect GitHub"}</a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the server to enable this.</p>
              )}
              {state.connected && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>{busy && <Loader2 className="animate-spin" />}Disconnect</Button>
              )}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
