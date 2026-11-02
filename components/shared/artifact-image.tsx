"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An image served by /api/artifacts. The row can outlive its bytes (storage cleared, or the job
 * ran on another machine), in which case the request is a 404 and a broken image icon would be
 * shown; this falls back to a neutral placeholder instead.
 */
export function ArtifactImage({ src, alt = "", className, fallbackClassName }: { src: string; alt?: string; className?: string; fallbackClassName?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={cn("grid place-items-center bg-muted", fallbackClassName ?? className)} role="img" aria-label={alt || "Preview unavailable"}>
        <FileText className="size-5 text-muted-foreground" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
