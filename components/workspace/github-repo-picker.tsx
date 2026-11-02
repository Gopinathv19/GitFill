"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { api, ApiError } from "@/lib/client/api";
import type { UserRepoView } from "@/lib/client/types";

/** The signed-in user's GitHub repositories, fetched once per page load and shared by every picker. */
let cache: Promise<UserRepoView[]> | null = null;
function loadMine(): Promise<UserRepoView[]> {
  cache ??= api<{ repositories: UserRepoView[] }>("/api/github/repositories").then(
    (r) => r.repositories,
    (e) => {
      cache = null;
      throw e;
    },
  );
  return cache;
}

/**
 * Choose a GitHub repository: pick one of your own (private ones included) or paste any URL.
 * Every "import from GitHub" flow uses this, so they all behave the same.
 */
export function GitHubRepoPicker({ value, onChange, id = "repo-url", exclude = [] }: { value: string; onChange: (url: string, repo?: UserRepoView) => void; id?: string; exclude?: string[] }) {
  const [mine, setMine] = useState<UserRepoView[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_connected" | "error">("loading");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let alive = true;
    loadMine().then(
      (r) => {
        if (!alive) return;
        setMine(r);
        setState("ready");
      },
      (e: unknown) => alive && setState(e instanceof ApiError && e.code === "github_not_connected" ? "not_connected" : "error"),
    );
    return () => {
      alive = false;
    };
  }, []);

  const taken = new Set(exclude.map((x) => x.toLowerCase()));
  const shown = (mine ?? []).filter((r) => !filter || r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={id}>Repository URL</Label>
        <Input id={id} name="url" required value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://github.com/owner/repo" autoComplete="off" />
      </div>
      <div>
        <Label htmlFor={`${id}-filter`}>Your repositories</Label>
        {state === "loading" && <p className="text-xs text-muted-foreground">Loading your GitHub repositories…</p>}
        {state === "not_connected" && (
          <p className="text-xs text-muted-foreground">
            <Link href="/settings" className="underline">Connect your GitHub account</Link> to pick from your own repositories, including private ones. Public URLs work without it.
          </p>
        )}
        {state === "error" && <p className="text-xs text-muted-foreground">Could not load your repositories; paste a URL instead.</p>}
        {state === "ready" && (
          <>
            <Input id={`${id}-filter`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="mb-1" autoComplete="off" />
            <div className="max-h-44 overflow-y-auto rounded-md border text-sm">
              {shown.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No matching repositories.</p>}
              {shown.map((r) => {
                const added = taken.has(r.fullName.toLowerCase());
                return (
                  <button
                    type="button"
                    key={r.fullName}
                    disabled={added}
                    onClick={() => onChange(r.htmlUrl, r)}
                    className={`flex w-full items-center gap-2 border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${value === r.htmlUrl ? "bg-accent" : ""}`}
                  >
                    {r.private && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{r.fullName}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{added ? "Already added" : r.language ?? ""}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
