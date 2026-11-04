import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** GCP metadata server host; GCE_METADATA_HOST overrides it the same way Google's client libraries allow. */
export function metadataHost(): string {
  return process.env.GCE_METADATA_HOST || "metadata.google.internal";
}

/**
 * Second-level cache of whole bare repositories (tar files), shared by every instance of the repo
 * service. A new or restarted instance restores a repository from here instead of fetching it from
 * GitHub again. Keys are "<owner>/<repo>.tar".
 */
export interface ArchiveCache {
  readonly kind: string;
  /** Downloads the archive to `dest`; false when there is none. */
  get(key: string, dest: string): Promise<boolean>;
  put(key: string, src: string): Promise<void>;
}

/** A directory (local development, or a mounted volume). */
export class DirArchiveCache implements ArchiveCache {
  readonly kind = "dir";
  constructor(private readonly root: string) {}

  async get(key: string, dest: string) {
    const src = path.join(this.root, key);
    if (!(await stat(src).catch(() => null))) return false;
    await copyFile(src, dest);
    return true;
  }

  async put(key: string, src: string) {
    const dest = path.join(this.root, key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, `${dest}.tmp`);
    await rename(`${dest}.tmp`, dest);
  }
}

/**
 * Google Cloud Storage over its JSON API. On Cloud Run / GCE the access token comes from the metadata
 * server (the service's own identity); elsewhere set GCS_ACCESS_TOKEN (e.g. `gcloud auth print-access-token`).
 */
export class GcsArchiveCache implements ArchiveCache {
  readonly kind = "gcs";
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  async get(key: string, dest: string) {
    const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.object(key))}?alt=media`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`GCS download failed (${res.status})`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  }

  async put(key: string, src: string) {
    const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(this.object(key))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/x-tar" },
      body: await readFile(src),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`GCS upload failed (${res.status})`);
  }

  private object(key: string) {
    return this.prefix ? `${this.prefix.replace(/\/+$/, "")}/${key}` : key;
  }

  private async accessToken(): Promise<string> {
    if (process.env.GCS_ACCESS_TOKEN) return process.env.GCS_ACCESS_TOKEN;
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    // The GCP metadata server is link-local and only serves plain HTTP; the request never leaves the VM.
    const res = await fetch(`http://${metadataHost()}/computeMetadata/v1/instance/service-accounts/default/token`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`metadata token request failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }
}

/** "gs://bucket/prefix" → Cloud Storage; any other value → a local directory; unset → none. */
export function archiveCacheFrom(spec: string | undefined): ArchiveCache | undefined {
  if (!spec) return undefined;
  const gs = /^gs:\/\/([^/]+)\/?(.*)$/.exec(spec);
  return gs ? new GcsArchiveCache(gs[1]!, gs[2] ?? "") : new DirArchiveCache(spec);
}
