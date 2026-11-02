"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Presentation, Upload, X } from "lucide-react";
import { errorMessage } from "@/lib/client/api";
import { ACCEPT, deleteUpload, setCaption, uploadFile, type UploadPurpose, type UploadView } from "@/lib/client/uploads";
import { cn } from "@/lib/utils";

/**
 * Drop or pick files for GitFill to use: screenshots and photos shown on slides, documents it can
 * quote, or a .pptx whose theme becomes the deck's brand. Each upload shows what GitFill read from
 * it (the image description, the document's first line) and the caption can be corrected.
 */
export function UploadZone({
  workspaceId,
  uploads,
  onChange,
  purpose = "material",
  accept = ACCEPT,
  compact = false,
  hint,
}: {
  workspaceId: string;
  uploads: UploadView[];
  onChange: (next: UploadView[]) => void;
  purpose?: UploadPurpose;
  accept?: string;
  compact?: boolean;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // The latest list, so uploads finishing in parallel do not overwrite each other.
  const current = useRef(uploads);
  current.current = uploads;

  async function add(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files).slice(0, 12)) {
      setBusy((n) => n + 1);
      try {
        const u = await uploadFile(workspaceId, file, { purpose });
        current.current = [...current.current, u];
        onChange(current.current);
      } catch (err) {
        setError(`${file.name}: ${errorMessage(err, "upload failed")}`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  async function remove(u: UploadView) {
    onChange(current.current.filter((x) => x.id !== u.id));
    await deleteUpload(u.id).catch(() => undefined);
  }

  async function caption(u: UploadView, description: string) {
    if (description === u.description) return;
    const next = await setCaption(u.id, description).catch(() => null);
    if (next) onChange(current.current.map((x) => (x.id === u.id ? next : x)));
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          compact ? "py-2.5" : "py-6",
          over && "border-primary bg-primary/5 text-foreground",
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        <span>{busy ? `Uploading${busy > 1 ? ` ${busy} files` : ""}… images are described as they arrive` : (hint ?? "Drop files here or click to choose")}</span>
      </button>
      <input ref={input} type="file" multiple={purpose === "material"} accept={accept} className="hidden" onChange={(e) => e.target.files && void add(e.target.files).finally(() => (e.target.value = ""))} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {uploads.length > 0 && (
        <ul className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          {uploads.map((u) => (
            <li key={u.id} className="flex gap-2.5 rounded-md border bg-background p-2">
              <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded bg-muted">
                {u.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated API route, not a static asset
                  <img src={u.url} alt="" className="size-full object-cover" />
                ) : u.kind === "template" ? (
                  <Presentation className="size-5 text-muted-foreground" />
                ) : (
                  <FileText className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {u.kind === "image" ? <ImageIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
                  <span className="truncate text-xs font-medium">{u.filename}</span>
                  <button type="button" aria-label={`Remove ${u.filename}`} onClick={() => void remove(u)} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
                {u.kind === "template" && u.brand ? (
                  <div className="mt-1 flex items-center gap-1">
                    {Object.entries(u.brand)
                      .filter(([k, v]) => typeof v === "string" && v.startsWith("#") && k !== "text")
                      .map(([k, v]) => (
                        <span key={k} title={`${k} ${v}`} className="size-3.5 rounded-sm border" style={{ background: v }} />
                      ))}
                    <span className="text-[11px] text-muted-foreground">{[u.brand.headingFont, u.brand.bodyFont].filter(Boolean).join(" / ") || "theme colours"}</span>
                  </div>
                ) : (
                  <input
                    defaultValue={u.description}
                    onBlur={(e) => void caption(u, e.target.value)}
                    placeholder={u.kind === "image" ? "What does it show?" : "What is it?"}
                    aria-label={`Caption for ${u.filename}`}
                    className="mt-0.5 w-full truncate bg-transparent text-[11px] text-muted-foreground outline-none focus:text-foreground"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
