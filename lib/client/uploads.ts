import type { UploadPurpose, UploadView } from "@/lib/uploads/service";
import { api, ApiError } from "./api";
import type { Attachment } from "./attachments";

export type { UploadView, UploadPurpose };

/** Uploads one file to a workspace (multipart; the JSON helper would set the wrong content type). */
export async function uploadFile(workspaceId: string, file: File, opts: { purpose?: UploadPurpose; caption?: string } = {}): Promise<UploadView> {
  const form = new FormData();
  form.set("file", file);
  if (opts.purpose) form.set("purpose", opts.purpose);
  if (opts.caption) form.set("caption", opts.caption);
  const res = await fetch(`/api/workspaces/${workspaceId}/uploads`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { data?: { upload: UploadView }; error?: { code: string; message: string } };
  if (!res.ok || !body.data) throw new ApiError(body.error?.message ?? `Upload failed (${res.status})`, body.error?.code ?? "error", res.status);
  return body.data.upload;
}

export async function listUploads(workspaceId: string): Promise<UploadView[]> {
  return (await api<{ uploads: UploadView[] }>(`/api/workspaces/${workspaceId}/uploads`)).uploads;
}

export async function deleteUpload(id: string): Promise<void> {
  await api(`/api/uploads/${id}`, { method: "DELETE" });
}

export async function setCaption(id: string, description: string): Promise<UploadView> {
  return (await api<{ upload: UploadView }>(`/api/uploads/${id}`, { method: "PATCH", body: JSON.stringify({ description }) })).upload;
}

export function toAttachment(u: UploadView): Attachment {
  return { id: u.id, filename: u.filename, kind: u.kind, description: u.description };
}

export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.md,.markdown,.txt,.csv,.json,.yaml,.yml,.docx,.pptx";
