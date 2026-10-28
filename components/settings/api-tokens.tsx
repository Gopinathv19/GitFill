"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { ApiTokenView } from "@/lib/client/types";
import { timeAgo } from "@/lib/utils";

/** Personal API tokens for the VS Code extension. The secret is shown once, right after creation. */
export function ApiTokens({ serverUrl }: { serverUrl: string }) {
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [name, setName] = useState("VS Code");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<ApiTokenView[]>("/api/tokens").then(setTokens, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; name: string }>("/api/tokens", { method: "POST", body: JSON.stringify({ name }) });
      setCreated(res);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not create the token."));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, label: string) {
    if (!window.confirm(`Revoke "${label}"? Any editor using it will stop working.`)) return;
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not revoke the token."));
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" />VS Code extension</CardTitle>
        <CardDescription>
          Create a token, then in VS Code run <span className="font-mono text-foreground">GitFill: Sign in</span> and paste it. The extension sends only the files relevant to each request to <span className="font-mono text-foreground">{serverUrl}</span>; nothing from your workspace is stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {created && (
          <div className="rounded-md border border-emerald-300/60 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">Token &quot;{created.name}&quot; created. Copy it now; it will not be shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 font-mono text-xs">{created.token}</code>
              <Button size="sm" variant="outline" onClick={() => void copy(created.token)}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
            </div>
          </div>
        )}
        <form onSubmit={create} className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" className="max-w-xs" required maxLength={80} />
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Create token</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="divide-y rounded-md border text-sm">
          {tokens === null && <li className="px-3 py-2 text-muted-foreground">Loading…</li>}
          {tokens?.length === 0 && <li className="px-3 py-2 text-muted-foreground">No tokens yet.</li>}
          {tokens?.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span></p>
                <p className="text-xs text-muted-foreground">Created {timeAgo(t.createdAt)}{t.lastUsedAt ? ` · last used ${timeAgo(t.lastUsedAt)}` : " · never used"}</p>
              </div>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Revoke ${t.name}`} onClick={() => void revoke(t.id, t.name)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
