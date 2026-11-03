"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { ActivityTimeline } from "@/components/jobs/activity-timeline";
import { ArtifactImage } from "@/components/shared/artifact-image";
import { DictateButton } from "@/components/shared/dictate-button";
import { JobStatusBadge, STAGE_LABELS, TERMINAL } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader as UiCardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/workspace/segmented";
import { api, ApiError } from "@/lib/client/api";
import { revisionProgress } from "@/lib/client/revision-progress";
import { useJob, type JobView } from "@/lib/client/use-job";
import { isTemplateId, TEMPLATES, type TemplateId } from "@/lib/presentation/themes";
import { TemplateGallery } from "./template-gallery";
import { collectVideos, VideoPanel } from "./video-panel";
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
  type: "pptx" | "pdf" | "readme" | "slide_preview" | "evidence_report" | "illustration" | "video" | "thumbnail" | "video_source";
  filename: string;
  sizeBytes: number;
  slideIndex: number | null;
  jobId: string | null;
  createdAt: string;
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
  spec: { title: string; theme?: string; slides: Array<{ id: string; title: string; layout: string }> };
  validation: Validation | null;
  artifacts: Artifact[];
}

interface DeckView {
  id: string;
  workspaceId: string;
  title: string;
  latestJob: { id: string; status: string; kind: string } | null;
  repository: { url: string; owner: string; name: string; branch: string; commitSha: string; agent: { turns: number; toolCalls: number } | null };
  claims: Array<{ ref: string; claim: string; type: string; status: "verified" | "inferred" | "unverified"; filePath: string | null; startLine: number | null; endLine: number | null }>;
  versions: Version[];
}

export function PresentationView({ deckId }: { deckId: string }) {
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState<"validation" | "evidence">("validation");
  // The revision being followed on this page: started here, or already running when the page opened.
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const { job: live, now } = useJob(liveJobId);
  const running = live !== null && !TERMINAL.has(live.status);

  const load = useCallback(
    () =>
      api<DeckView>(`/api/presentations/${deckId}`)
        .then((d) => {
          setDeck(d);
          setSelected(d.versions[0]?.version ?? null);
          return d;
        })
        .catch((e: Error) => {
          setError(e.message);
          return null;
        }),
    [deckId],
  );

  useEffect(() => {
    void load().then((d) => {
      if (d?.latestJob && !TERMINAL.has(d.latestJob.status)) (d.latestJob.kind === "video" ? setVideoJobId : setLiveJobId)(d.latestJob.id);
    });
  }, [load]);

  // A finished revision becomes the latest version: reload and show it.
  useEffect(() => {
    if (live?.status !== "completed") return;
    void load().then(() => {
      setSlide(0);
      setLiveJobId(null);
    });
  }, [live?.status, load]);

  const version = useMemo(() => deck?.versions.find((v) => v.version === selected), [deck, selected]);
  const previews = useMemo(
    () => (version?.artifacts ?? []).filter((a) => a.type === "slide_preview").sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)),
    [version],
  );
  const videos = useMemo(() => collectVideos(deck?.versions ?? []), [deck]);
  const reload = useCallback(() => void load(), [load]);
  const progress = useMemo(() => (running && live ? revisionProgress(live) : null), [running, live]);
  // While a revision runs, the newest render round replaces the stored previews.
  const frames = useMemo<Frame[]>(() => {
    const titles = new Map((version?.spec.slides ?? []).map((s) => [s.id, plain(s.title)]));
    if (progress?.render && live) {
      const { round, slideIds } = progress.render;
      return slideIds.map((id, i) => ({ key: `${round}-${id}`, src: `/api/jobs/${live.id}/preview?round=${round}&slide=${i + 1}`, slideId: id, title: titles.get(id) ?? "New slide" }));
    }
    return previews.map((p, i) => {
      const id = version?.spec.slides[i]?.id ?? "";
      return { key: p.id, src: `/api/artifacts/${p.id}`, slideId: id, title: titles.get(id) ?? "" };
    });
  }, [previews, version, progress, live]);

  // Arrow keys page through the slides, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.key === "ArrowRight") setSlide((n) => Math.min(n + 1, Math.max(frames.length - 1, 0)));
      if (e.key === "ArrowLeft") setSlide((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!deck || !version) return <p className="text-sm text-muted-foreground">Loading presentation…</p>;

  const file = (type: Artifact["type"]) => version.artifacts.find((a) => a.type === type);
  const index = Math.min(slide, Math.max(frames.length - 1, 0));
  const current = frames[index];
  const repo = deck.repository;
  const unresolved = version.validation?.summary.unresolved ?? 0;
  const busy = (id: string) => progress?.busy.has(id) ?? false;
  const goTo = (i: number) => {
    setSlide(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
          <Select aria-label="Version" disabled={running} value={selected ?? undefined} onChange={(e) => { setSelected(Number(e.target.value)); setSlide(0); }} className="h-9 w-auto">
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

      <Card className="overflow-hidden">
        {running && live ? (
          <div className="flex items-center gap-2 border-b bg-brand/5 px-4 py-2 text-xs text-brand">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="font-medium">Revising live</span>
            <span className="text-muted-foreground">
              · {STAGE_LABELS[live.status] ?? live.status}
              {progress?.render ? ` · showing render round ${progress.render.round + 1}` : progress?.busy.size ? ` · rewriting ${progress.busy.size} slide${progress.busy.size === 1 ? "" : "s"}` : ""}
            </span>
          </div>
        ) : null}
        {current ? (
          <div className="group relative bg-black">
            <ArtifactImage
              key={current.key}
              src={current.src}
              alt={`Slide ${index + 1}: ${current.title}`}
              className={cx("aspect-video w-full object-contain transition-opacity", busy(current.slideId) && "opacity-50")}
              fallbackClassName="aspect-video w-full"
            />
            {busy(current.slideId) ? (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs text-white backdrop-blur">
                <Loader2 className="size-3.5 animate-spin" /> Rewriting this slide…
              </span>
            ) : null}
            <SlideArrow side="left" disabled={index === 0} onClick={() => setSlide(index - 1)} />
            <SlideArrow side="right" disabled={index >= frames.length - 1} onClick={() => setSlide(index + 1)} />
          </div>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">No previews were rendered.</p>
        )}
        <div className="flex items-center justify-between gap-4 border-t px-4 py-2.5 text-sm">
          <span className="min-w-0 truncate font-medium">{current?.title}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {frames.length ? index + 1 : 0} / {frames.length}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto border-t p-3">
          {frames.map((f, i) => (
            <button
              key={f.key}
              onClick={() => setSlide(i)}
              className={cx(
                "relative shrink-0 overflow-hidden rounded-md border-2 transition-opacity",
                i === index ? "border-primary" : "border-transparent opacity-60 hover:opacity-100",
                busy(f.slideId) && "border-brand opacity-100",
              )}
              aria-label={`Show slide ${i + 1}${busy(f.slideId) ? " (being rewritten)" : ""}`}
              aria-current={i === index}
            >
              <ArtifactImage src={f.src} className={cx("h-[4.5rem] w-32 object-cover", busy(f.slideId) && "opacity-40")} fallbackClassName="h-[4.5rem] w-32" />
              {busy(f.slideId) ? <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-white" /> : null}
            </button>
          ))}
        </div>
      </Card>

      {live && (running || live.status === "failed") ? (
        <RevisionProgress job={live} now={now} onDismiss={() => setLiveJobId(null)} />
      ) : (
        <RevisionBox deckId={deck.id} theme={version.spec.theme} onStarted={(jobId) => setLiveJobId(jobId)} />
      )}

      <VideoPanel deckId={deck.id} videos={videos} jobId={videoJobId} onJob={setVideoJobId} onDone={reload} />

      <div className="space-y-4">
        <div className="w-full sm:w-96">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "validation", label: `Validation${unresolved ? ` · ${unresolved} open` : ""}`, icon: FileCheck2 },
              { value: "evidence", label: `Evidence · ${deck.claims.length}`, icon: ShieldCheck },
            ]}
          />
        </div>
        {tab === "validation" ? (
          <ValidationPanel validation={version.validation} slides={version.spec.slides} onSlide={goTo} />
        ) : (
          <EvidencePanel claims={deck.claims} repoUrl={repo.url} commit={repo.commitSha} />
        )}
      </div>
    </div>
  );
}

function SlideArrow({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={cx(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/75 focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

function ValidationPanel({ validation, slides, onSlide }: { validation: Validation | null; slides: Version["spec"]["slides"]; onSlide: (index: number) => void }) {
  if (!validation) return <Card className="p-6 text-sm text-muted-foreground">No validation report for this version.</Card>;
  const s = validation.summary;
  const repairs = validation.rounds.flatMap((r) => r.repairs.map((x) => ({ ...x, round: r.round })));
  const order = { high: 0, medium: 1, low: 2 } as const;
  const open = [...validation.unresolved].sort((a, b) => order[a.severity] - order[b.severity] || a.slideIndex - b.slideIndex);
  const SlideRef = ({ id }: { id: string }) => {
    const i = slides.findIndex((x) => x.id === id);
    if (i < 0) return <span className="text-muted-foreground">{id}</span>;
    return (
      <button type="button" onClick={() => onSlide(i)} className="font-medium text-foreground underline-offset-4 hover:underline" title={slides[i]?.title}>
        Slide {i + 1}
      </button>
    );
  };
  return (
    <Card>
      <div className="grid grid-cols-2 gap-3 border-b p-4 sm:grid-cols-4">
        <Stat label="Render-and-check rounds" value={validation.rounds.length} />
        <Stat label="Issues found" value={s.detected} />
        <Stat label="Repairs applied" value={s.repairsApplied} />
        <Stat label="Still open" value={s.unresolved} tone={s.unresolved ? "warning" : "success"} />
      </div>
      {s.finalAverageScore !== null ? (
        <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
          Muse Spark visual review: <span className="font-medium text-foreground">{s.finalAverageScore}/10</span> average across the final slides
        </p>
      ) : null}
      <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <section className="p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Still open ({open.length})</h3>
          {open.length ? (
            <ul className="space-y-2.5 text-sm">
              {open.map((u, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge variant={u.severity === "high" ? "danger" : u.severity === "medium" ? "warning" : "outline"} className="mt-0.5 shrink-0">
                    {u.severity}
                  </Badge>
                  <span>
                    <SlideRef id={u.slideId} /> <span className="text-muted-foreground">·</span> {u.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Every check passed on the final render.</p>
          )}
        </section>
        <section className="p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Repairs ({repairs.length})</h3>
          {repairs.length ? (
            <ul className="space-y-2.5 text-sm">
              {repairs.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge variant="success" className="mt-0.5 shrink-0">
                    {r.kind === "model" ? "AI" : "Rule"}
                  </Badge>
                  <span>
                    <SlideRef id={r.slideId} /> <span className="text-muted-foreground">·</span> {r.description}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No repairs were needed.</p>
          )}
        </section>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "success" }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <div className={cx("text-lg font-semibold", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RevisionBox({ deckId, theme, onStarted }: { deckId: string; theme?: string; onStarted: (jobId: string) => void }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current: TemplateId = theme && isTemplateId(theme) ? theme : "midnight";
  const [template, setTemplate] = useState<TemplateId>(current);
  const [picking, setPicking] = useState(false);

  /** Switching template re-renders every slide in the new look; the content is not regenerated. */
  async function switchTemplate() {
    setSubmitting(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/presentations/${deckId}/revise`, { method: "POST", body: JSON.stringify({ instruction: `Switch to the ${TEMPLATES[template].name} template.`, theme: template }) });
      onStarted(jobId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not switch the template.");
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/presentations/${deckId}/revise`, { method: "POST", body: JSON.stringify({ instruction: text }) });
      onStarted(jobId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the revision.");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Revise this presentation" description="Describe the change. Slides you don't mention stay as they are, and the result becomes a new version." />
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Textarea
          aria-label="Revision request"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim().length >= 3) e.currentTarget.form?.requestSubmit();
          }}
          rows={2}
          placeholder="e.g. Make the architecture slide easier to understand and add a slide on the database design."
          className="min-h-[3.5rem] flex-1"
        />
        <DictateButton className="self-end" onText={(spoken) => setText((t) => (t.trim() ? `${t.trimEnd()} ${spoken}` : spoken))} />
        <Button type="submit" disabled={submitting || text.trim().length < 3} className="sm:w-44">
          {submitting ? <Spinner /> : null}
          Apply revision
        </Button>
      </form>
      <div className="border-t px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Template: <span className="font-medium">{TEMPLATES[current].name}</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => setPicking((p) => !p)}>
            {picking ? "Close" : "Change template"}
          </Button>
        </div>
        {picking ? (
          <div className="mt-3 space-y-3">
            <TemplateGallery compact value={template} onChange={setTemplate} />
            <div className="flex justify-end">
              <Button size="sm" disabled={submitting || template === current} onClick={() => void switchTemplate()}>
                {submitting ? <Spinner /> : null}
                Apply {TEMPLATES[template].name}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p role="alert" className="px-4 pb-4 text-xs text-destructive">{error}</p> : null}
    </Card>
  );
}

/** The running (or failed) revision under the slides: its request, status and every recorded step. */
function RevisionProgress({ job, now, onDismiss }: { job: JobView; now: number; onDismiss: () => void }) {
  const running = !TERMINAL.has(job.status);
  const started = job.startedAt ?? job.createdAt;
  const elapsed = Math.max(0, Math.round(((job.completedAt ? new Date(job.completedAt).getTime() : now) - new Date(started).getTime()) / 1000));
  return (
    <Card>
      <CardHeader
        title={running ? "Revising this presentation" : "The revision failed"}
        description={<span className="text-foreground/80">{job.prompt}</span>}
        action={
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}</span>
            <JobStatusBadge status={job.status} />
          </div>
        }
      />
      {job.status === "failed" ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-destructive/5 px-5 py-3 text-sm">
          <p className="text-destructive">{job.errorMessage ?? "The revision stopped."}</p>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Try another revision
          </Button>
        </div>
      ) : null}
      <div className="px-5 py-4">
        <ActivityTimeline events={job.events} running={running} currentStage={STAGE_LABELS[job.status]} />
      </div>
    </Card>
  );
}

interface Frame {
  key: string;
  src: string;
  slideId: string;
  title: string;
}

// Slide titles may carry *accent* marks for the rendered page; show them as plain text here.
const plain = (title: string) => title.replace(/\*+([^*]+)\*+/g, "$1");


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
