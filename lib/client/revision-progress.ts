import type { JobEvent } from "@/components/jobs/activity-timeline";
import type { JobView } from "./use-job";

const outputOf = (e: JobEvent) => (e.output && typeof e.output === "object" ? (e.output as Record<string, unknown>) : {});
const inputOf = (e: JobEvent) => (e.input && typeof e.input === "object" ? (e.input as Record<string, unknown>) : {});

/**
 * What a running revision is doing to the slides, read from its recorded events: the newest render
 * round (images to show) and the slides being rewritten or repaired right now.
 */
export function revisionProgress(job: Pick<JobView, "events">): { render: { round: number; slideIds: string[] } | null; busy: Set<string> } {
  let render: { round: number; slideIds: string[] } | null = null;
  let targets: string[] = [];
  const working = new Set<string>();
  for (const e of job.events) {
    const out = outputOf(e);
    if (e.name === "render_slides" && e.status === "succeeded" && Array.isArray(out.slideIds) && typeof out.round === "number") {
      render = { round: out.round, slideIds: out.slideIds as string[] };
      working.clear();
    }
    if (e.name === "plan_revision" && e.status === "succeeded" && Array.isArray(out.targets)) targets = out.targets as string[];
    const slideId = inputOf(e).slide;
    if ((e.name === "compose_slide" || e.name === "repair_slide") && typeof slideId === "string") {
      if (e.status === "started") working.add(slideId);
      else working.delete(slideId);
    }
  }
  // Until the first render, every targeted slide is being rewritten.
  return { render, busy: render ? working : new Set([...targets, ...working]) };
}
