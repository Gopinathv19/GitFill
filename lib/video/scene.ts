import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { embeddedFontCss } from "@/lib/presentation/html/render";
import { browser } from "@/lib/render/browser";

/**
 * Rendering primitives for videos and thumbnails. A video is one self-contained HTML document that
 * defines `window.DURATION` (seconds) and `window.render(t)`, which sets every element's state for
 * time t. Because frames depend only on t, any moment can be rendered alone (stills to check) and
 * the full video is just render(f / fps) for every frame, screenshotted and piped into ffmpeg.
 */

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;
export const THUMBNAIL = { width: 1280, height: 720 } as const;
export const MIN_DURATION = 10;
export const MAX_DURATION = 180;

export class SceneError extends Error {
  override name = "SceneError";
}

interface OpenScene {
  page: Page;
  context: BrowserContext;
  errors: string[];
}

/** The Geist fonts go first in <head>, so scenes render identically on any machine without the network. */
function withFonts(html: string): string {
  const style = `<style>${embeddedFontCss()}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${style}`) : `${style}${html}`;
}

/**
 * Opens model-written HTML in an isolated context. Every request except data: URLs is blocked, so a
 * scene can neither fetch anything nor reach the network, whatever the repository text asked for.
 */
async function openScene(html: string, size: { width: number; height: number }): Promise<OpenScene> {
  const context = await (await browser()).newContext({ viewport: size, deviceScaleFactor: 1, javaScriptEnabled: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.setDefaultTimeout(15_000);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("data:") || url === "about:blank" ? route.continue() : route.abort();
  });
  try {
    await page.setContent(withFonts(html), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
  } catch (err) {
    await context.close();
    throw new SceneError(`The page did not load: ${(err as Error).message.slice(0, 300)}`);
  }
  return { page, context, errors };
}

async function renderAt(page: Page, t: number): Promise<void> {
  await page.evaluate((time) => (window as unknown as { render: (t: number) => void }).render(time), t);
}

export interface SceneCheck {
  /** window.DURATION, when it is a usable number. */
  duration: number | null;
  /** Contract violations; empty means the scene can be rendered. */
  problems: string[];
}

/** Checks the render contract: render(t) and DURATION exist, rendering throws nothing, and the same t gives the same frame. */
export async function checkScene(html: string): Promise<SceneCheck> {
  const problems: string[] = [];
  const scene = await openScene(html, VIDEO);
  try {
    const shape = await scene.page.evaluate(() => {
      const w = window as unknown as { render?: unknown; DURATION?: unknown };
      return { render: typeof w.render === "function", duration: typeof w.DURATION === "number" ? w.DURATION : null };
    });
    if (!shape.render) problems.push("window.render(t) is not defined as a function.");
    let duration = shape.duration;
    if (duration === null || !Number.isFinite(duration)) {
      problems.push("window.DURATION is not set to a number of seconds.");
      duration = null;
    } else if (duration < MIN_DURATION || duration > MAX_DURATION) {
      problems.push(`window.DURATION is ${duration}s; keep it between ${MIN_DURATION} and ${MAX_DURATION} seconds.`);
    }
    if (shape.render && duration) {
      try {
        for (const t of [0, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.05)]) await renderAt(scene.page, t);
        // Determinism: render a moment, move away, come back; the two images must match.
        const probe = Math.min(1.37, duration / 3);
        await renderAt(scene.page, probe);
        const a = await scene.page.screenshot({ type: "png" });
        await renderAt(scene.page, duration * 0.8);
        await renderAt(scene.page, probe);
        const b = await scene.page.screenshot({ type: "png" });
        if (!a.equals(b)) problems.push("render(t) is not deterministic: the same t produced two different frames. Remove timers, Date, Math.random, requestAnimationFrame and anything that depends on the previous frame.");
        const running = await scene.page.evaluate(() => document.getAnimations().length);
        if (running > 0) problems.push(`${running} CSS animations or transitions are running. They follow the browser clock, not t: remove them (no transition/animation CSS) and set every style from render(t).`);
      } catch (err) {
        problems.push(`render(t) threw: ${(err as Error).message.slice(0, 300)}`);
      }
    }
    problems.push(...[...new Set(scene.errors)].slice(0, 5).map((e) => `Page error: ${e}`));
    return { duration, problems };
  } finally {
    await scene.context.close();
  }
}

export interface Still {
  t: number;
  pngPath: string;
  /** Measured layout defects at this moment. */
  problems: string[];
}

/** Renders the given moments to PNGs and measures each frame: text cut off at the edge, clipped or too small. */
export async function renderStills(html: string, times: number[], outDir: string, size: { width: number; height: number } = VIDEO): Promise<Still[]> {
  await mkdir(outDir, { recursive: true });
  const scene = await openScene(html, size);
  try {
    const hasRender = await scene.page.evaluate(() => typeof (window as unknown as { render?: unknown }).render === "function");
    const out: Still[] = [];
    for (const t of times) {
      if (hasRender) await renderAt(scene.page, t);
      const problems = await scene.page.evaluate(measureFrame, size);
      const pngPath = path.join(outDir, `${stillName(t)}.png`);
      await scene.page.screenshot({ path: pngPath, type: "png" });
      out.push({ t, pngPath, problems });
    }
    return out;
  } finally {
    await scene.context.close();
  }
}

/** File-safe name for a moment, e.g. 12.5 → "t0012.5". */
export function stillName(t: number): string {
  return `t${t.toFixed(1).padStart(6, "0")}`;
}

/**
 * Renders every frame and encodes an H.264 MP4 with ffmpeg (yuv420p, +faststart so it streams).
 * Frames are JPEG screenshots piped to ffmpeg's stdin, so nothing is written per frame.
 */
export async function renderVideo(html: string, opts: { duration: number; outPath: string; fps?: number; onProgress?: (frame: number, total: number) => void }): Promise<void> {
  const fps = opts.fps ?? VIDEO.fps;
  const total = Math.round(opts.duration * fps);
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  const scene = await openScene(html, VIDEO);
  const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", opts.outPath], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
  const exited = once(ffmpeg, "close") as Promise<[number | null]>;
  try {
    for (let f = 0; f < total; f++) {
      await renderAt(scene.page, f / fps);
      const jpeg = await scene.page.screenshot({ type: "jpeg", quality: 92 });
      if (!ffmpeg.stdin.write(jpeg)) await once(ffmpeg.stdin, "drain");
      if (f % fps === 0) opts.onProgress?.(f, total);
    }
    ffmpeg.stdin.end();
    const [code] = await exited;
    if (code !== 0) throw new SceneError(`ffmpeg failed (${code}): ${stderr.trim().slice(-500)}`);
  } catch (err) {
    ffmpeg.kill("SIGKILL");
    throw err instanceof SceneError ? err : new SceneError(`Video rendering failed: ${(err as Error).message.slice(0, 300)}`);
  } finally {
    await scene.context.close();
  }
}

/**
 * Stretches where nothing on screen changes: samples every half second and compares the visible
 * text and its layout (the moving background is ignored). Long holds read as slides, not video.
 */
export async function findHolds(html: string, duration: number, minSeconds = 6): Promise<Array<{ from: number; to: number }>> {
  const scene = await openScene(html, VIDEO);
  try {
    const prints: string[] = [];
    const step = 0.5;
    for (let t = 0; t < duration; t += step) {
      await renderAt(scene.page, t);
      prints.push(await scene.page.evaluate(fingerprintFrame, VIDEO));
    }
    const holds: Array<{ from: number; to: number }> = [];
    let start = 0;
    for (let i = 1; i <= prints.length; i++) {
      if (i < prints.length && prints[i] === prints[start]) continue;
      const from = start * step;
      const to = i * step;
      // An empty frame holding still is a fade, not a frozen scene.
      if (to - from >= minSeconds && prints[start]) holds.push({ from, to: Math.min(to, duration) });
      start = i;
    }
    return holds;
  } finally {
    await scene.context.close();
  }
}

/** Runs in the page: visible text with its rounded position, size and opacity. No named inner functions (see measureFrame). */
function fingerprintFrame(size: { width: number; height: number }): string {
  const parts: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    let text = "";
    for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
    text = text.trim();
    if (!text) continue;
    let opacity = 1;
    for (let e: Element | null = el; e && e instanceof HTMLElement; e = e.parentElement) {
      const ecs = getComputedStyle(e);
      opacity = ecs.display === "none" || ecs.visibility === "hidden" ? 0 : opacity * parseFloat(ecs.opacity || "1");
    }
    if (opacity < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.bottom < 0 || r.left > size.width || r.top > size.height) continue;
    parts.push(`${text}@${Math.round(r.left / 4)},${Math.round(r.top / 4)},${Math.round(r.width / 4)}x${Math.round(r.height / 4)}:${Math.round(opacity * 10)}`);
  }
  return parts.join("|");
}

/** Renders a static page (the thumbnail) to one PNG and measures it. */
export async function renderThumbnail(html: string, outPath: string): Promise<Still> {
  const [still] = await renderStills(html, [0], path.dirname(outPath), THUMBNAIL);
  if (path.resolve(still!.pngPath) !== path.resolve(outPath)) {
    const { rename } = await import("node:fs/promises");
    await rename(still!.pngPath, outPath);
  }
  return { ...still!, pngPath: outPath };
}

/**
 * Runs in the page: visible text that is cut off at the frame edge, clipped by its box, or too small to read.
 * No named inner functions: the bundler would wrap them in a helper that does not exist in the page.
 */
function measureFrame(size: { width: number; height: number }): string[] {
  const problems = new Set<string>();
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    let text = "";
    for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
    text = text.trim();
    if (!text) continue;
    let opacity = 1;
    for (let e: Element | null = el; e && e instanceof HTMLElement; e = e.parentElement) {
      const ecs = getComputedStyle(e);
      opacity = ecs.display === "none" || ecs.visibility === "hidden" ? 0 : opacity * parseFloat(ecs.opacity || "1");
    }
    if (opacity < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const label = `"${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`;
    if (r.left < -2 || r.top < -2 || r.right > size.width + 2 || r.bottom > size.height + 2) problems.add(`Text cut off at the frame edge: ${label}`);
    const cs = getComputedStyle(el);
    const he = el as HTMLElement;
    if (cs.overflow !== "visible" && (he.scrollWidth > he.clientWidth + 2 || he.scrollHeight > he.clientHeight + 2)) problems.add(`Text clipped by its box: ${label}`);
    const px = parseFloat(cs.fontSize);
    if (px < (size.width >= 1920 ? 22 : 16)) problems.add(`Text too small to read on video (${Math.round(px)}px): ${label}`);
  }
  return [...problems].slice(0, 10);
}

/** Writes a scene to disk for inspection (the job keeps the source next to its stills). */
export async function saveScene(html: string, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, html);
}
