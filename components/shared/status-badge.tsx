import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const STAGE_LABELS: Record<string, string> = {
  pending: "Queued",
  analyzing_repository: "Analyzing repository",
  planning_presentation: "Planning slides",
  generating_presentation: "Building slides",
  rendering_slides: "Rendering slides",
  validating_presentation: "Validating",
  repairing_presentation: "Repairing slides",
  generating_documents: "Writing documents",
  comparing_commits: "Comparing commits",
  composing_document: "Composing document",
  composing_video: "Writing the video",
  rendering_video: "Rendering video",
  completed: "Completed",
  failed: "Failed",
};

export const TERMINAL = new Set(["completed", "failed"]);

export function JobStatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge variant="success">Completed</Badge>;
  if (status === "failed") return <Badge variant="danger">Failed</Badge>;
  return (
    <Badge variant="info">
      <Loader2 className="size-3 animate-spin" />
      {STAGE_LABELS[status] ?? status}
    </Badge>
  );
}

export const JOB_KIND_LABELS: Record<string, string> = {
  generate: "Presentation",
  revise: "Revision",
  handbook: "Handbook",
  compare: "Commit comparison",
  reuse: "Implementation brief",
  video: "Video",
  readme: "README",
  brainstorm: "Brainstorm spec",
};

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  handbook: "Handbook",
  commit_report: "Commit report",
  implementation_brief: "Implementation brief",
  explanation: "Explanation",
  readme: "README",
  brainstorm: "Brainstorm spec",
};
