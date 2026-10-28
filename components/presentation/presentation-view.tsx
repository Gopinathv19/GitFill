"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader as UiCardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/client/api";
import { cn as cx } from "@/lib/utils";

/** Card header with title, description and an optional action, in SysOne style. */
function CardHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <UiCardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b px-5 py-4">
      <div className="space-y-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </div>
      {action}
    </UiCardHeader>
  );
}

function ButtonLink({ href, variant = "outline", children }: { href: string; variant?: "default" | "outline"; children: React.ReactNode }) {
  return (
    <Button asChild variant={variant} size="sm">
      <a href={href}>{children}</a>
    </Button>
  );
}

function Spinner() {
  return <Loader2 className="animate-spin" />;
}

interface Artifact {
  id: string;
  type: "pptx" | "pdf" | "readme" | "slide_preview" | "evidence_report" | "illustration";
  filename: string;
  sizeBytes: number;
  slideIndex: number | null;
}

interface Issue {
  slideId: string;
  slideIndex: number;
  source: "layout" | "render" | "visual_review";
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  suggestion?: string;
}

interface Validation {
  rounds: Array<{ round: number; issues: Issue[]; repairs: Array<{ slideId: string; kind: string; description: string }>; visualScores: Record<string, number> }>;
  unresolved: Issue[];
  summary: { detected: number; repairsApplied: number; unresolved: number; finalAverageScore: number | null };
}

interface Version {
  id: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
  spec: { title: string; slides: Array<{ id: string; title: string; layout: string }> };
  validation: Validation | null;
  artifacts: Artifact[];
}

interface DeckView {
  id: string;
  workspaceId: string;
  title: string;
  latestJob: { id: string; status: string } | null;
  repository: { url: string; owner: string; name: string; branch: string; commitSha: string; agent: { turns: number; toolCalls: number } | null };
  claims: Array<{ ref: string; claim: string; type: string; status: "verified" | "inferred" | "unverified"; filePath: string | null; startLine: number | null; endLine: number | null }>;
  versions: Version[];
}

export function PresentationView({ deckId }: { deckId: string }) {
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    api<DeckView>(`/api/presentations/${deckId}`)
      .then((d) => {
        setDeck(d);
        setSelected(d.versions[0]?.version ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [deckId]);

  const version = useMemo(() => deck?.versions.find((v) => v.version === selected), [deck, selected]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!deck || !version) return <p className="text-sm text-muted-foreground">Loading presentation…</p>;

  const previews = version.artifacts.filter((a) => a.type === "slide_preview").sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
  const file = (type: Artifact["type"]) => version.artifacts.find((a) => a.type === type);
  const current = previews[Math.min(slide, previews.length - 1)];
  const repo = deck.repository;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
        <Link href={`/workspaces/${deck.workspaceId}`}>
          <ArrowLeft /> Back to workspace
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{version.spec.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <a className="hover:text-foreground" href={repo.url} target="_blank" rel="noreferrer">
              {repo.owner}/{repo.name}
            </a>{" "}
            · {repo.branch} ·{" "}
            <a className="font-mono hover:text-foreground" href={`${repo.url}/tree/${repo.commitSha}`} target="_blank" rel="noreferrer">
              {repo.commitSha.slice(0, 7)}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Version" value={selected ?? undefined} onChange={(e) => { setSelected(Number(e.target.value)); setSlide(0); }} className="h-9 w-auto">
            {deck.versions.map((v) => (
              <option key={v.version} value={v.version}>
                Version {v.version}
                {v.version === deck.versions[0]?.version ? " (latest)" : ""}
              </option>
            ))}
          </Select>
          {file("pptx") ? <ButtonLink variant="default" href={`/api/artifacts/${file("pptx")!.id}?download=1`}><Download />Download .pptx</ButtonLink> : null}
          {file("pdf") ? <ButtonLink href={`/api/artifacts/${file("pdf")!.id}?download=1`}>PDF</ButtonLink> : null}
          {file("readme") ? <ButtonLink href={`/api/artifacts/${file("readme")!.id}?download=1`}>README.md</ButtonLink> : null}
          {file("evidence_report") ? <ButtonLink href={`/api/artifacts/${file("evidence_report")!.id}?download=1`}>Evidence</ButtonLink> : null}
        </div>
      </div>
      {version.changeSummary && version.version > 1 ? <p className="text-sm text-muted-foreground">Change in v{version.version}: {version.changeSummary}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/artifacts/${current.id}`} alt={`Slide ${(current.slideIndex ?? 0) + 1}: ${version.spec.slides[current.slideIndex ?? 0]?.title ?? ""}`} className="aspect-video w-full bg-black object-contain" />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No previews were rendered.</p>
          )}
          <div className="flex gap-2 overflow-x-auto border-t border-border p-3">
            {previews.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setSlide(i)}
                className={cx("shrink-0 overflow-hidden rounded-md border-2", i === slide ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}
                aria-label={`Show slide ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/artifacts/${p.id}`} alt="" className="h-16 w-28 object-cover" />
              </button>
            ))}
          </div>
        </Card>
        <div className="space-y-6">
          <ValidationPanel validation={version.validation} slides={version.spec.slides} />
          <RevisionBox deckId={deck.id} busyJob={deck.latestJob && !["completed", "failed"].includes(deck.latestJob.status) ? deck.latestJob.id : null} />
        </div>
      </div>

      <EvidencePanel claims={deck.claims} repoUrl={repo.url} commit={repo.commitSha} />
    </div>
  );
}

function ValidationPanel({ validation, slides }: { validation: Validation | null; slides: Version["spec"]["slides"] }) {
  if (!validation) return null;
  const s = validation.summary;
  const repairs = validation.rounds.flatMap((r) => r.repairs.map((x) => ({ ...x, round: r.round })));
  const titleOf = (id: string) => {
    const i = slides.findIndex((x) => x.id === id);
    return i >= 0 ? `Slide ${i + 1}` : id;
  };
  return (
    <Card>
      <CardHeader title="Validation" description={`${validation.rounds.length} render-and-check round(s)`} />
      <div className="grid grid-cols-3 gap-2 p-4 text-center">
        <Stat label="Issues found" value={s.detected} />
        <Stat label="Repairs" value={s.repairsApplied} />
        <Stat label="Unresolved" value={s.unresolved} tone={s.unresolved ? "warning" : "success"} />
      </div>
      {s.finalAverageScore !== null ? <p className="px-4 pb-3 text-xs text-muted-foreground">Muse Spark visual review score: {s.finalAverageScore}/10 average</p> : null}
      {repairs.length ? (
        <ul className="space-y-2 border-t border-border px-4 py-3 text-xs">
          {repairs.map((r, i) => (
            <li key={i}>
              <Badge variant="success">{r.kind === "model" ? "AI repair" : "Rule repair"}</Badge> <span className="text-muted-foreground">{titleOf(r.slideId)}:</span> {r.description}
            </li>
          ))}
        </ul>
      ) : null}
      {validation.unresolved.length ? (
        <ul className="space-y-2 border-t border-border px-4 py-3 text-xs">
          {validation.unresolved.map((u, i) => (
            <li key={i}>
              <Badge variant={u.severity === "high" ? "danger" : u.severity === "medium" ? "warning" : "outline"}>{u.severity}</Badge> <span className="text-muted-foreground">{titleOf(u.slideId)}:</span> {u.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "success" }) {
  return (
    <div className="rounded-lg bg-muted px-2 py-2">
      <div className={cx("text-lg font-semibold", tone === "warning" && "text-amber-600", tone === "success" && "text-emerald-600")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RevisionBox({ deckId, busyJob }: { deckId: string; busyJob: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/presentations/${deckId}/revise`, { method: "POST", body: JSON.stringify({ instruction: text }) });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the revision.");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Revise" description="Describe the change. Unaffected slides are kept as they are; the result becomes a new version." />
      {busyJob ? (
        <p className="p-4 text-sm">
          A revision is in progress.{" "}
          <a className="font-medium underline underline-offset-4" href={`/jobs/${busyJob}`}>
            Follow it
          </a>
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3 p-4">
          <Textarea aria-label="Revision request" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Make the architecture slide easier to understand and add a slide on the database design." />
          <Button type="submit" disabled={submitting || text.trim().length < 3} className="w-full">
            {submitting ? <Spinner /> : null}
            Apply revision
          </Button>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </form>
      )}
    </Card>
  );
}

function EvidencePanel({ claims, repoUrl, commit }: { claims: DeckView["claims"]; repoUrl: string; commit: string }) {
  const [filter, setFilter] = useState<"all" | "verified" | "inferred" | "unverified">("all");
  const shown = claims.filter((c) => filter === "all" || c.status === filter);
  const counts = { verified: 0, inferred: 0, unverified: 0 };
  for (const c of claims) counts[c.status]++;
  return (
    <Card>
      <CardHeader
        title="Evidence"
        description={`${claims.length} claims checked against the source at ${commit.slice(0, 7)}: ${counts.verified} verified, ${counts.inferred} inferred, ${counts.unverified} unverified`}
        action={
          <Select aria-label="Filter claims" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto py-1 text-xs">
            <option value="all">All</option>
            <option value="verified">Verified</option>
            <option value="inferred">Inferred</option>
            <option value="unverified">Unverified</option>
          </Select>
        }
      />
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Ref</th>
              <th className="px-4 py-2 font-medium">Claim</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-y">
            {shown.map((c) => (
              <tr key={c.ref}>
                <td className="px-4 py-2 font-mono text-muted-foreground">{c.ref}</td>
                <td className="px-4 py-2">{c.claim}</td>
                <td className="px-4 py-2 font-mono">
                  {c.filePath ? (
                    <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`${repoUrl}/blob/${commit}/${c.filePath}${c.startLine ? `#L${c.startLine}-L${c.endLine}` : ""}`}>
                      {c.filePath}
                      {c.startLine ? `:${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ""}` : ""}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">unavailable</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={c.status === "verified" ? "success" : c.status === "inferred" ? "info" : "warning"}>{c.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
