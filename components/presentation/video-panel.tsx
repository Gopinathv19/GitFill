"use client";

import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Download, Loader2 } from "lucide-react";
import { ActivityTimeline } from "@/components/jobs/activity-timeline";
import { JobStatusBadge, STAGE_LABELS, TERMINAL } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/client/api";
import { useJob } from "@/lib/client/use-job";
import { videoStills } from "@/lib/client/video-progress";
import { cn } from "@/lib/utils";

export interface VideoArtifact {
  id: string;
  type: string;
  jobId: string | null;
  createdAt: string;
}

interface MadeVideo {
  jobId: string;
  version: number;
  createdAt: string;
  video: VideoArtifact;
  thumbnail?: VideoArtifact;
  source?: VideoArtifact;
}

/** Videos made from any version of the deck, newest first, each with its thumbnail and HTML source. */
export function collectVideos(versions: Array<{ version: number; artifacts: VideoArtifact[] }>): MadeVideo[] {
  const out: MadeVideo[] = [];
  for (const v of versions) {
    for (const video of v.artifacts.filter((a) => a.type === "video" && a.jobId)) {
      const same = (type: string) => v.artifacts.find((a) => a.type === type && a.jobId === video.jobId);
      out.push({ jobId: video.jobId!, version: v.version, createdAt: video.createdAt, video, thumbnail: same("thumbnail"), source: same("video_source") });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The deck's videos: make one, follow it live (the frames the director previews, then rendering),
 * and play or download the results.
 */
export function VideoPanel({ deckId, videos, jobId, onJob, onDone }: { deckId: string; videos: MadeVideo[]; jobId: string | null; onJob: (jobId: string | null) => void; onDone: () => void }) {
  const { job, now } = useJob(jobId);
  const running = job !== null && !TERMINAL.has(job.status);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (job?.status !== "completed") return;
    onDone();
    onJob(null);
    setShown(0);
  }, [job?.status, onDone, onJob]);

  const current = videos[shown];
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 border-b px-5 py-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clapperboard className="size-4" /> Video
          </CardTitle>
          <CardDescription className="text-xs">An explainer video and thumbnail written from this deck and the code, checked frame by frame, rendered at 1080p with original music.</CardDescription>
        </div>
        {job ? <JobStatusBadge status={job.status} /> : null}
      </CardHeader>

      {job && (running || job.status === "failed") ? (
        <LiveVideo job={job} now={now} onDismiss={() => onJob(null)} />
      ) : current ? (
        <div className="space-y-3 p-4">
          <video key={current.video.id} controls preload="metadata" poster={current.thumbnail ? `/api/artifacts/${current.thumbnail.id}` : undefined} src={`/api/artifacts/${current.video.id}`} className="aspect-video w-full rounded-md bg-black" />
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <a href={`/api/artifacts/${current.video.id}?download=1`}>
                <Download /> MP4
              </a>
            </Button>
            {current.thumbnail ? (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/artifacts/${current.thumbnail.id}?download=1`}>Thumbnail</a>
              </Button>
            ) : null}
            {current.source ? (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/artifacts/${current.source.id}?download=1`}>HTML source</a>
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">Made from version {current.version}</span>
            {videos.length > 1 ? (
              <Select aria-label="Video" value={shown} onChange={(e) => setShown(Number(e.target.value))} className="ml-auto h-8 w-auto text-xs">
                {videos.map((v, i) => (
                  <option key={v.jobId} value={i}>
                    {new Date(v.createdAt).toLocaleString()} · v{v.version}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </div>
      ) : null}

      {!running ? <MakeVideo deckId={deckId} again={videos.length > 0} onStarted={onJob} /> : null}
    </Card>
  );
}

function MakeVideo({ deckId, again, onStarted }: { deckId: string; again: boolean; onStarted: (jobId: string) => void }) {
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/presentations/${deckId}/video`, { method: "POST", body: JSON.stringify({ instructions: text, seconds }) });
      onStarted(jobId);
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the video.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-end">
      <Textarea
        aria-label="What the video should show"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Optional: who it is for and what to show, e.g. a 60-second demo for hackathon judges that walks through a live chat."
        className="min-h-[3.5rem] flex-1"
      />
      <Select aria-label="Length" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="h-9 w-auto">
        {[30, 45, 60, 90, 120].map((s) => (
          <option key={s} value={s}>
            {s} seconds
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={submitting} className="sm:w-40">
        {submitting ? <Loader2 className="animate-spin" /> : null}
        {again ? "Make another" : "Make video"}
      </Button>
      {error ? <p role="alert" className="text-xs text-destructive sm:basis-full">{error}</p> : null}
    </form>
  );
}

/** A video job in progress: the newest previewed frame large, earlier ones as a strip, the log below. */
function LiveVideo({ job, now, onDismiss }: { job: NonNullable<ReturnType<typeof useJob>["job"]>; now: number; onDismiss: () => void }) {
  const stills = useMemo(() => videoStills(job), [job]);
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? stills.length - 1;
  const still = stills[index];
  const running = !TERMINAL.has(job.status);
  const started = job.startedAt ?? job.createdAt;
  const elapsed = Math.max(0, Math.round(((job.completedAt ? new Date(job.completedAt).getTime() : now) - new Date(started).getTime()) / 1000));
  const src = (file: string) => `/api/jobs/${job.id}/preview?still=${encodeURIComponent(file)}`;

  return (
    <div>
      <div className="flex items-center gap-2 border-b bg-brand/5 px-4 py-2 text-xs text-brand">
        {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
        <span className="font-medium">{STAGE_LABELS[job.status] ?? job.status}</span>
        <span className="text-muted-foreground">
          · {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}
          {job.status === "rendering_video" ? " · rendering every frame and the soundtrack" : stills.length ? ` · ${stills.length} frames previewed` : " · researching and writing the scenes"}
        </span>
      </div>
      {job.status === "failed" ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-destructive/5 px-5 py-3 text-sm">
          <p className="text-destructive">{job.errorMessage ?? "The video stopped."}</p>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            Try again
          </Button>
        </div>
      ) : null}
      {still ? (
        <div className="bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={still.file} src={src(still.file)} alt={still.thumbnail ? "Thumbnail draft" : `Frame at ${still.t?.toFixed(1)}s`} className="aspect-video w-full object-contain" />
          <p className="border-t border-white/10 px-4 py-2 font-mono text-xs text-white/70">
            {still.thumbnail ? "Thumbnail" : `Frame at ${still.t?.toFixed(1)}s`} · draft {still.version}
            {still.score !== null ? ` · reviewer ${still.score}/10` : ""}
          </p>
        </div>
      ) : null}
      {stills.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-b p-3">
          {stills.map((s, i) => (
            <button key={s.file} onClick={() => setPicked(i === stills.length - 1 ? null : i)} aria-label={s.thumbnail ? "Show thumbnail draft" : `Show frame at ${s.t?.toFixed(1)}s`} aria-current={i === index} className={cn("shrink-0 overflow-hidden rounded-md border-2 transition-opacity", i === index ? "border-primary" : "border-transparent opacity-60 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(s.file)} alt="" className="h-[4.5rem] w-32 object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="px-5 py-4">
        <ActivityTimeline events={job.events} running={running} currentStage={STAGE_LABELS[job.status]} />
      </div>
    </div>
  );
}
