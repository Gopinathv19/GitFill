import Link from "next/link";
import { FileText } from "lucide-react";
import { ArtifactImage } from "@/components/shared/artifact-image";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";

export interface DeckCardData {
  id: string;
  title: string;
  latestVersion: number;
  updatedAt: string;
  previewArtifactId?: string | null;
  workspaceName?: string;
}

export function DeckGrid({ decks }: { decks: DeckCardData[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {decks.map((d) => (
        <Link key={d.id} href={`/presentations/${d.id}`} className="group">
          <Card className="overflow-hidden transition-shadow group-hover:shadow-md">
            {d.previewArtifactId ? (
              <ArtifactImage src={`/api/artifacts/${d.previewArtifactId}`} className="aspect-video w-full border-b object-cover" fallbackClassName="aspect-video w-full border-b" />
            ) : (
              <div className="grid aspect-video place-items-center border-b bg-muted"><FileText className="size-8 text-muted-foreground" /></div>
            )}
            <div className="space-y-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{d.title}</p>
                <Badge variant="outline">v{d.latestVersion}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {d.workspaceName ? `${d.workspaceName} · ` : ""}
                {timeAgo(d.updatedAt)}
              </p>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
