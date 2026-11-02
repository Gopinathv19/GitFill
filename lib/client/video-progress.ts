import type { JobEvent } from "@/components/jobs/activity-timeline";
import type { JobView } from "./use-job";

export interface PreviewStill {
  /** Path under the job's work directory, served by /api/jobs/:id/preview?still=… */
  file: string;
  /** Seconds into the video; null for the thumbnail. */
  t: number | null;
  /** Draft number of the document the still was rendered from. */
  version: number;
  thumbnail: boolean;
  score: number | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Every frame the video director has previewed so far, oldest first, read from the job's recorded events. */
export function videoStills(job: Pick<JobView, "events">): PreviewStill[] {
  const out: PreviewStill[] = [];
  for (const e of job.events as JobEvent[]) {
    if ((e.name !== "preview_video" && e.name !== "preview_thumbnail") || e.status !== "succeeded") continue;
    const output = obj(e.output);
    const stills = Array.isArray(output.stills) ? output.stills : [];
    for (const s of stills.map(obj)) {
      if (typeof s.file !== "string") continue;
      out.push({ file: s.file, t: typeof s.t === "number" ? s.t : null, version: typeof output.version === "number" ? output.version : 0, thumbnail: e.name === "preview_thumbnail", score: typeof s.score === "number" ? s.score : null });
    }
  }
  return out;
}
