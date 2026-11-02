import JSZip from "jszip";
import type { Brand } from "@/lib/presentation/themes";

/**
 * What GitFill accepts as an upload, decided from the bytes (never the browser's MIME type), and
 * the text or facts it can read from each file. No uploaded file is ever executed or rendered as
 * HTML: images become data URIs inside <img>, documents become plain text.
 */

export class UploadError extends Error {
  override name = "UploadError";
}

export type DetectedKind = "image" | "document" | "pptx";

export interface DetectedFile {
  kind: DetectedKind;
  mime: string;
  ext: string;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

const TEXT_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
};

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Identifies an upload from its content; throws UploadError with a user-facing message otherwise. */
export function detectFile(filename: string, bytes: Buffer): DetectedFile {
  const ext = extOf(filename);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png", ext: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "pptx") return { kind: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext };
    if (ext === "docx") return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext };
    throw new UploadError("Zip files are only accepted as .pptx (a template or slides) or .docx (a document).");
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) throw new UploadError("PDFs are not read yet. Upload the text as Markdown, .txt or .docx, or the pages as images.");
  if (ext === "svg") throw new UploadError("SVG images are not accepted; upload a PNG or JPEG instead.");
  if (TEXT_EXT[ext]) {
    if (bytes.includes(0)) throw new UploadError("This does not look like a text file.");
    return { kind: "document", mime: TEXT_EXT[ext]!, ext };
  }
  throw new UploadError("Unsupported file. Upload images (PNG, JPEG, WebP, GIF), documents (Markdown, .txt, .csv, .json, .yaml, .docx) or a .pptx template.");
}

/** Pixel size of a PNG, JPEG, GIF or WebP, read from its header. */
export function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === "image/gif") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (mime === "image/webp") {
      const chunk = bytes.toString("ascii", 12, 16);
      if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (chunk === "VP8L") {
        const b = bytes.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      return null;
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1]!;
        const len = bytes.readUInt16BE(i + 2);
        // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

async function openZip(bytes: Buffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new UploadError("The file could not be opened; it may be damaged.");
  }
}

/** Plain text of a .docx: one line per paragraph. */
export async function docxText(bytes: Buffer): Promise<string> {
  const zip = await openZip(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new UploadError("This .docx has no document body.");
  return xml
    .split(/<\/w:p>/)
    .map((p) => decodeXml([...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")))
    .filter((l) => l.trim())
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
}

export function plainText(bytes: Buffer): string {
  return bytes.toString("utf8").replace(/\r\n/g, "\n").slice(0, MAX_TEXT_CHARS);
}

export interface PptxInfo {
  slides: number;
  /** Slide text, one "Slide n:" section per slide. */
  text: string;
  /** Colours and fonts from the first theme, as a GitFill brand. */
  brand: Brand;
  /** The theme's raw colour scheme, for display. */
  colors: Record<string, string>;
}

/** Reads a .pptx: its theme (colours and fonts) and the text on its slides. */
export async function readPptx(bytes: Buffer): Promise<PptxInfo> {
  const zip = await openZip(bytes);
  const themeFile = Object.keys(zip.files)
    .filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))[0];
  const theme = themeFile ? await zip.file(themeFile)!.async("string") : "";
  const colors = themeColors(theme);
  const fonts = themeFonts(theme);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const parts: string[] = [];
  for (const [i, name] of slideFiles.entries()) {
    const xml = await zip.file(name)!.async("string");
    const paras = xml
      .split(/<\/a:p>/)
      .map((p) => decodeXml([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("")).trim())
      .filter(Boolean);
    if (paras.length) parts.push(`Slide ${i + 1}:\n${paras.join("\n")}`);
  }
  return { slides: slideFiles.length, text: parts.join("\n\n").slice(0, MAX_TEXT_CHARS), brand: brandFromTheme(colors, fonts), colors };
}

/** dk1/lt1/dk2/lt2/accent1-6 from <a:clrScheme>, as #rrggbb. */
export function themeColors(xml: string): Record<string, string> {
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
  const out: Record<string, string> = {};
  for (const name of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]) {
    const el = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(scheme)?.[1] ?? "";
    const hex = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(el)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(el)?.[1];
    if (hex) out[name] = `#${hex.toLowerCase()}`;
  }
  return out;
}

export function themeFonts(xml: string): { heading?: string; body?: string } {
  const latin = (tag: string) => new RegExp(`<a:${tag}>[\\s\\S]*?<a:latin typeface="([^"]+)"`).exec(xml)?.[1];
  const clean = (f: string | undefined) => (f && /^[A-Za-z0-9 \-]{2,40}$/.test(f) && !f.startsWith("+") ? f : undefined);
  return { heading: clean(latin("majorFont")), body: clean(latin("minorFont")) };
}

/** A brand from a theme: accent1/2 as accents, lt1/dk1 as background and text. */
export function brandFromTheme(colors: Record<string, string>, fonts: { heading?: string; body?: string }): Brand {
  const brand: Brand = {};
  if (colors.accent1) brand.accent = colors.accent1;
  if (colors.accent2) brand.accent2 = colors.accent2;
  if (colors.lt1) brand.background = colors.lt1;
  if (colors.dk1) brand.text = colors.dk1;
  if (fonts.heading) brand.headingFont = fonts.heading;
  if (fonts.body) brand.bodyFont = fonts.body;
  return brand;
}
