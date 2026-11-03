"use client";

import { useState } from "react";
import { ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/client/api";

/** The app's install link inside an "app not installed" error. */
const INSTALL_LINK = /https:\/\/github\.com\/apps\/[a-z0-9-]+\/installations\/new/;

interface PullRequestRecord {
  number: number;
  url: string;
  path: string;
  openedAt: string;
}

/** Where a document of this kind lands in the repository, as the button describes it. */
export function destinationLabel(kind: string): string {
  if (kind === "readme") return "README.md";
  if (kind === "brainstorm" || kind === "implementation_brief") return ".gitfill/knowledge/";
  return ".gitfill/docs/";
}

/**
 * Opens a pull request that adds the document to its repository, and lists the ones already opened.
 */
export function PullRequestButton({ documentId, kind, metadata }: { documentId: string; kind: string; metadata: Record<string, unknown> }) {
  const [prs, setPrs] = useState<PullRequestRecord[]>(() => (Array.isArray(metadata.pullRequests) ? (metadata.pullRequests as PullRequestRecord[]) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const pr = await api<PullRequestRecord & { existing?: boolean }>(`/api/documents/${documentId}/pull-request`, { method: "POST" });
      if (!pr.existing) setPrs((p) => [...p, pr]);
      window.open(pr.url, "_blank", "noopener");
    } catch (err) {
      setError(errorMessage(err, "Could not open the pull request."));
    } finally {
      setBusy(false);
    }
  }

  const latest = prs[prs.length - 1];
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {latest ? (
          <Button asChild variant="ghost" size="sm">
            <a href={latest.url} target="_blank" rel="noreferrer">
              PR #{latest.number} <ExternalLink />
            </a>
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void open()} disabled={busy} title={`Adds this to ${destinationLabel(kind)} on a new branch`}>
          {busy ? <Loader2 className="animate-spin" /> : <GitPullRequest />}
          {latest ? "Open PR" : `Open PR → ${destinationLabel(kind)}`}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="max-w-md text-right text-xs text-destructive">
          {error.replace(INSTALL_LINK, "").trim()}
          {INSTALL_LINK.exec(error) ? (
            <>
              {" "}
              <a href={INSTALL_LINK.exec(error)![0]} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                Install the GitFill app
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
