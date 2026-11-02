import type { Figure } from "../spec";

/**
 * SVG diagram kit. Primitives emit class names only (no colours) so the theme decides how
 * every box, edge and label looks; the figure functions lay out a spec'd figure on a
 * 1000-unit-wide canvas. Every box is wrapped in <g class="n"> so the renderer can verify
 * in the browser that its text really fits.
 */

export const esc = (s: unknown = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Pt = [number, number];
type Tone = "default" | "accent" | "ok" | "warn" | "danger" | "external";

const W = 1000;
/** Average glyph advance in viewBox units, by text class. Generous: the browser check is the real test. */
const CHAR = { t: 7.1, s: 5.9, m: 6.1, e: 5.6 } as const;
const LH = 14;

/** Greedy word wrap to at most `maxLines` lines of `maxChars`; the last line is never cut. */
export function wrap(text: string | undefined, maxChars: number, maxLines = 2): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars || lines.length === maxLines - 1) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const charsFor = (width: number, cls: keyof typeof CHAR) => Math.max(6, Math.floor(width / CHAR[cls]));

export function svg(w: number, h: number, inner: string, title = ""): string {
  return `<svg viewBox="0 0 ${round(w)} ${round(h)}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

const round = (n: number) => Math.round(n * 10) / 10;
const variant = (t: Tone | undefined) => (t && t !== "default" ? t : "");

interface BoxOpts {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string | string[];
  sub?: string[];
  mono?: string[];
  tone?: Tone;
  align?: "center" | "left";
  num?: string | number;
}

/** Height a box needs for its lines. */
export const boxHeight = (lines: number) => 18 + lines * LH;

export function box({ x, y, w, h, title, sub = [], mono = [], tone, align = "center", num }: BoxOpts): string {
  const titles = Array.isArray(title) ? title : title ? [title] : [];
  const total = titles.length + sub.length + mono.length;
  let ty = y + h / 2 - ((total - 1) * LH) / 2 + 4;
  const tx = align === "left" ? x + 12 : x + w / 2;
  const anchor = align === "left" ? "start" : "middle";
  let out = `<g class="n"><rect class="d-box ${variant(tone)}" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}"/>`;
  for (const t of titles) {
    out += `<text class="d-t" x="${round(tx)}" y="${round(ty)}" text-anchor="${anchor}">${esc(t)}</text>`;
    ty += LH;
  }
  for (const l of sub) {
    out += `<text class="d-s" x="${round(tx)}" y="${round(ty)}" text-anchor="${anchor}">${esc(l)}</text>`;
    ty += LH;
  }
  for (const l of mono) {
    out += `<text class="d-m" x="${round(tx)}" y="${round(ty)}" text-anchor="${anchor}">${esc(l)}</text>`;
    ty += LH;
  }
  out += "</g>";
  if (num != null) out += badgeNum(x, y, num);
  return out;
}

export function badgeNum(x: number, y: number, n: string | number): string {
  return `<rect class="d-num" x="${round(x - 9)}" y="${round(y - 9)}" width="18" height="18"/><text class="d-num-t" x="${round(x)}" y="${round(y + 3.5)}" text-anchor="middle">${esc(n)}</text>`;
}

export function diamond({ x, y, w, h, lines, sub = [] }: { x: number; y: number; w: number; h: number; lines: string[]; sub?: string[] }): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  let out = `<g class="n dia"><polygon class="d-diamond" points="${round(cx)},${round(y)} ${round(x + w)},${round(cy)} ${round(cx)},${round(y + h)} ${round(x)},${round(cy)}"/>`;
  const all = [...lines.map((l) => ["d-t", l]), ...sub.map((l) => ["d-s", l])];
  let ty = cy - ((all.length - 1) * 13) / 2 + 4;
  for (const [cls, l] of all) {
    out += `<text class="${cls}" x="${round(cx)}" y="${round(ty)}" text-anchor="middle">${esc(l)}</text>`;
    ty += 13;
  }
  return out + "</g>";
}

export function zone({ x, y, w, h, label, trust = false }: { x: number; y: number; w: number; h: number; label?: string; trust?: boolean }): string {
  return (
    `<rect class="d-zone ${trust ? "trust" : ""}" x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}"/>` +
    (label ? `<text class="d-zone-label" x="${round(x + 10)}" y="${round(y + 15)}">${esc(label)}</text>` : "")
  );
}

function arrowHead([x1, y1]: Pt, [x2, y2]: Pt, v: string): string {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 7;
  const p = (da: number) => `${round(x2 - s * Math.cos(a - da))},${round(y2 - s * Math.sin(a - da))}`;
  return `<polygon class="d-arrow ${v}" points="${round(x2)},${round(y2)} ${p(0.45)} ${p(-0.45)}"/>`;
}

/** A polyline edge with an arrowhead at the end. Labels get a halo so they read over lines. */
export function edge({ points, label, at, v = "", anchor = "middle" }: { points: Pt[]; label?: string[]; at?: Pt; v?: string; anchor?: "start" | "middle" | "end" }): string {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join(" ");
  let out = `<path class="d-edge ${v}" d="${d}"/>`;
  const n = points.length;
  out += arrowHead(points[n - 2]!, points[n - 1]!, v.replace("dash", "").trim());
  if (label?.length) {
    const [lx, ly] = at ?? [(points[0]![0] + points[n - 1]![0]) / 2, (points[0]![1] + points[n - 1]![1]) / 2 - 6];
    const top = ly - (label.length - 1) * 12;
    out += label.map((l, i) => `<text class="d-edge-label d-halo" x="${round(lx)}" y="${round(top + i * 12)}" text-anchor="${anchor}">${esc(l)}</text>`).join("");
  }
  return out;
}

const edgeVariant = (style: "solid" | "dashed" | "accent") => (style === "dashed" ? "dash" : style === "accent" ? "accent" : "");

/* ---------------------------------------------------------------- Figures */

/** `width` is the column's CSS width: a flow in a wide column runs left to right so it is not squeezed by height. */
export function renderFigure(f: Figure, width = 1200): string {
  switch (f.kind) {
    case "architecture":
      return architecture(f);
    case "flow":
      return width >= 900 && f.steps.length >= 3 ? flowHorizontal(f) : flow(f);
    case "decision":
      return decision(f);
    case "sequence":
      return sequence(f);
    case "states":
      return states(f);
  }
}

/** Lanes left → right, nodes stacked and centred in each lane, orthogonal edges through the gaps. */
function architecture(f: Extract<Figure, { kind: "architecture" }>): string {
  const L = f.lanes.length;
  const labelled = f.edges.some((e) => e.label);
  const G = labelled ? 92 : 56;
  const pad = 4;
  const laneW = (W - 2 * pad - (L - 1) * G) / L;
  const inset = 12;
  const boxW = laneW - 2 * inset;
  const top = f.lanes.some((l) => l.label || l.zone) ? 34 : 10;
  const vGap = 14;
  const laneX = (i: number) => pad + i * (laneW + G);

  const placed = new Map<string, { x: number; y: number; w: number; h: number; lane: number }>();
  const nodeLines = f.nodes.map((n) => ({
    n,
    sub: wrap(n.sub, charsFor(boxW - 12, "s"), 2),
    mono: wrap(n.mono, charsFor(boxW - 12, "m"), 1),
  }));
  const heights = new Map(nodeLines.map(({ n, sub, mono }) => [n.id, Math.max(40, boxHeight(1 + sub.length + mono.length))]));
  const stacks = f.lanes.map((l) => f.nodes.filter((n) => n.lane === l.id));
  const stackH = stacks.map((s) => s.reduce((a, n) => a + heights.get(n.id)!, 0) + Math.max(0, s.length - 1) * vGap);
  const contentH = Math.max(...stackH, 40);
  const H = top + contentH + 14;

  stacks.forEach((stack, li) => {
    let y = top + (contentH - stackH[li]!) / 2;
    for (const n of stack) {
      const h = heights.get(n.id)!;
      placed.set(n.id, { x: laneX(li) + inset, y, w: boxW, h, lane: li });
      y += h + vGap;
    }
  });

  let out = "";
  f.lanes.forEach((l, i) => {
    if (l.zone) out += zone({ x: laneX(i), y: 4, w: laneW, h: H - 8, label: l.label, trust: true });
    else if (l.label) out += `<text class="d-zone-label" x="${round(laneX(i) + laneW / 2)}" y="19" text-anchor="middle">${esc(l.label)}</text>`;
  });

  // Edges first so boxes sit on top. Labels collected and drawn last.
  let labels = "";
  const labelSlots = new Map<string, number>();
  for (const e of f.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue;
    const v = edgeVariant(e.style);
    const label = e.label ? wrap(e.label, charsFor(G + 30, "e"), 2) : undefined;
    let points: Pt[];
    let at: Pt | undefined;
    let anchor: "start" | "middle" | "end" = "middle";
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    if (a.lane === b.lane) {
      const x = a.x + a.w / 2;
      points = b.y > a.y ? [[x, a.y + a.h], [x, b.y]] : [[x, a.y], [x, b.y + b.h]];
      at = [x + 8, (points[0]![1] + points[1]![1]) / 2 + 4];
      anchor = "start";
    } else {
      const forward = b.lane > a.lane;
      const x1 = forward ? a.x + a.w : a.x;
      const x2 = forward ? b.x : b.x + b.w;
      const mx = forward ? laneX(b.lane) - G / 2 : laneX(b.lane) + laneW + G / 2;
      points = Math.abs(ay - by) < 1 ? [[x1, ay], [x2, by]] : [[x1, ay], [mx, ay], [mx, by], [x2, by]];
      // Label sits on the final segment, just before the target; stack labels that share it.
      const key = `${e.to}:${forward}`;
      const slot = labelSlots.get(key) ?? 0;
      labelSlots.set(key, slot + 1);
      at = [x2 + (forward ? -6 : 6), by - 6 - slot * 13 * (label?.length ?? 1)];
      anchor = forward ? "end" : "start";
    }
    out += edge({ points, v });
    if (label && at) labels += labelText(label, at[0], at[1], anchor);
  }
  for (const { n, sub, mono } of nodeLines) {
    const p = placed.get(n.id)!;
    out += box({ ...p, title: n.title, sub, mono, tone: n.tone });
  }
  return svg(W, H, out + labels, "Architecture diagram");
}

/** Vertical pipeline of numbered steps, with side exits and fanned-out outcomes. */
function flow(f: Extract<Figure, { kind: "flow" }>): string {
  const hasBranch = f.steps.some((s) => s.branch);
  const outcomes = f.outcomes ?? [];
  const stepW = 300;
  const branchW = 270;
  // The canvas is only as wide as the content, so the figure scales up in narrow columns.
  const FW = hasBranch ? 20 + stepW + 120 + branchW + 20 : Math.max(stepW + 40, outcomes.length * 210);
  const stepX = hasBranch ? 20 : (FW - stepW) / 2;
  const branchX = FW - 20 - branchW;
  const subChars = charsFor(stepW - 16, "s");
  const rows = f.steps.map((s, i) => {
    const sub = wrap(s.sub, subChars, 2);
    const bsub = s.branch ? wrap(s.branch.sub, charsFor(branchW - 16, "s"), 2) : [];
    return { s, i, sub, bsub, h: Math.max(boxHeight(1 + sub.length), s.branch ? boxHeight(1 + bsub.length) : 0) };
  });
  const gap = 16;
  let y = 8;
  let out = "";
  const centers: number[] = [];
  for (const r of rows) {
    if (r.i > 0) out += edge({ points: [[stepX + stepW / 2, y - gap], [stepX + stepW / 2, y - 1]], v: "accent" });
    out += box({ x: stepX, y, w: stepW, h: r.h, title: `${r.i + 1} · ${r.s.title}`, sub: r.sub, tone: "accent" });
    if (r.s.branch) {
      const cy = y + r.h / 2;
      const b = r.s.branch;
      const v = b.tone === "ok" ? "ok" : b.tone === "warn" || b.tone === "danger" ? "warn" : "";
      out += edge({ points: [[stepX + stepW, cy], [branchX, cy]], v, label: wrap(b.when, charsFor(branchX - stepX - stepW - 20, "e"), 1), at: [(stepX + stepW + branchX) / 2, cy - 6] });
      out += box({ x: branchX, y, w: branchW, h: r.h, title: b.title, sub: r.bsub, tone: b.tone });
    }
    centers.push(y + r.h / 2);
    y += r.h + gap;
  }
  if (outcomes.length) {
    const n = outcomes.length;
    const ow = (FW - 2 * 20 - (n - 1) * 16) / n;
    const busY = y + 4;
    const oy = busY + 22;
    const sx = stepX + stepW / 2;
    out += `<path class="d-edge" d="M${round(sx)} ${round(y - gap)} L${round(sx)} ${round(busY)}"/>`;
    const xs = outcomes.map((_, i) => 20 + i * (ow + 16) + ow / 2);
    out += `<path class="d-edge" d="M${round(Math.min(sx, ...xs))} ${round(busY)} L${round(Math.max(sx, ...xs))} ${round(busY)}"/>`;
    const subs = outcomes.map((o) => wrap(o.sub, charsFor(ow - 16, "s"), 2));
    const oh = Math.max(...subs.map((s) => boxHeight(1 + s.length)));
    outcomes.forEach((o, i) => {
      const v = o.tone === "ok" ? "ok" : o.tone === "warn" || o.tone === "danger" ? "warn" : "";
      out += edge({ points: [[xs[i]!, busY], [xs[i]!, oy - 1]], v });
      out += box({ x: 20 + i * (ow + 16), y: oy, w: ow, h: oh, title: o.title, sub: subs[i], tone: o.tone });
    });
    y = oy + oh + 8;
  }
  return svg(FW, y, out, "Flow diagram");
}

/** Steps left to right, side exits dropping below their step, outcomes stacked in a last column. */
function flowHorizontal(f: Extract<Figure, { kind: "flow" }>): string {
  const outcomes = f.outcomes ?? [];
  const n = f.steps.length;
  const cols = n + (outcomes.length ? 1 : 0);
  const pad = 6;
  const gap = 40;
  const colW = (W - 2 * pad - (cols - 1) * gap) / cols;
  const colX = (i: number) => pad + i * (colW + gap);
  const top = 6;
  const tChars = charsFor(colW - 14, "t");
  const sChars = charsFor(colW - 14, "s");
  const steps = f.steps.map((s, i) => ({ s, title: wrap(`${i + 1} · ${s.title}`, tChars, 2), sub: wrap(s.sub, sChars, 3) }));
  const h = Math.max(...steps.map((x) => boxHeight(x.title.length + x.sub.length)));
  const cy = top + h / 2;
  let out = "";
  steps.forEach((x, i) => {
    if (i > 0) out += edge({ points: [[colX(i) - gap + 2, cy], [colX(i) - 1, cy]], v: "accent" });
    out += box({ x: colX(i), y: top, w: colW, h, title: x.title, sub: x.sub, tone: "accent" });
  });
  let bottom = top + h;
  const branches = steps.map((x) => x.s.branch);
  if (branches.some(Boolean)) {
    const by = top + h + 44;
    const bLines = branches.map((b) => (b ? { title: wrap(b.title, tChars, 2), sub: wrap(b.sub, sChars, 3) } : null));
    const bh = Math.max(...bLines.map((l) => (l ? boxHeight(l.title.length + l.sub.length) : 0)));
    branches.forEach((b, i) => {
      if (!b) return;
      const cx = colX(i) + colW / 2;
      const v = b.tone === "ok" ? "ok" : b.tone === "warn" || b.tone === "danger" ? "warn" : "";
      out += edge({ points: [[cx, top + h], [cx, by - 1]], v });
      out += labelText(wrap(b.when, charsFor(colW / 2 + gap / 2 - 10, "e"), 2), cx + 7, top + h + 22, "start");
      out += box({ x: colX(i), y: by, w: colW, h: bh, title: bLines[i]!.title, sub: bLines[i]!.sub, tone: b.tone });
    });
    bottom = by + bh;
  }
  if (outcomes.length) {
    const ox = colX(n);
    const lines = outcomes.map((o) => ({ title: wrap(o.title, tChars, 2), sub: wrap(o.sub, sChars, 2) }));
    const oh = Math.max(...lines.map((l) => boxHeight(l.title.length + l.sub.length)));
    const total = outcomes.length * oh + (outcomes.length - 1) * 10;
    const oy = Math.max(top, cy - total / 2);
    const busX = ox - gap / 2;
    const lastX = colX(n - 1) + colW;
    out += `<path class="d-edge" d="M${round(lastX)} ${round(cy)} L${round(busX)} ${round(cy)}"/>`;
    outcomes.forEach((o, i) => {
      const y = oy + i * (oh + 10);
      const v = o.tone === "ok" ? "ok" : o.tone === "warn" || o.tone === "danger" ? "warn" : "";
      out += edge({ points: [[busX, cy], [busX, y + oh / 2], [ox - 1, y + oh / 2]], v });
      out += box({ x: ox, y, w: colW, h: oh, title: lines[i]!.title, sub: lines[i]!.sub, tone: o.tone });
    });
    bottom = Math.max(bottom, oy + total);
  }
  return svg(W, bottom + 6, out, "Flow diagram");
}

/** A chain of yes/no checks, left to right; each "yes" drops to its result. */
function decision(f: Extract<Figure, { kind: "decision" }>): string {
  const n = f.checks.length;
  const pad = 8;
  const colW = (W - 2 * pad) / (n + 1);
  const dw = Math.min(colW - 22, 190);
  const dh = 100;
  const dy = 10;
  const ry = dy + dh + 44;
  let out = "";
  const resultSubs = f.checks.map((c) => wrap(c.yes.sub, charsFor(colW - 30, "s"), 2));
  const rh = Math.max(...resultSubs.map((s) => boxHeight(1 + s.length)), boxHeight(1 + wrap(f.otherwise.sub, charsFor(colW - 30, "s"), 2).length));
  f.checks.forEach((c, i) => {
    const cx = pad + i * colW + colW / 2;
    const x = cx - dw / 2;
    out += diamond({ x, y: dy, w: dw, h: dh, lines: wrap(c.question, charsFor(dw * 0.62, "t"), 2), sub: wrap(c.sub, charsFor(dw * 0.66, "s"), 1) });
    const nextX = i < n - 1 ? pad + (i + 1) * colW + (colW - dw) / 2 : pad + n * colW + 10;
    out += edge({ points: [[x + dw, dy + dh / 2], [nextX - 1, dy + dh / 2]], label: ["no"], at: [(x + dw + nextX) / 2, dy + dh / 2 - 6] });
    out += edge({ points: [[cx, dy + dh], [cx, ry - 1]], label: ["yes"], at: [cx + 7, dy + dh + 25], anchor: "start" });
    out += box({ x: pad + i * colW + 8, y: ry, w: colW - 16, h: rh, title: c.yes.title, sub: resultSubs[i], tone: c.yes.tone });
  });
  const ox = pad + n * colW + 10;
  const osub = wrap(f.otherwise.sub, charsFor(colW - 30, "s"), 2);
  const oh = Math.max(boxHeight(1 + osub.length), 52);
  out += box({ x: ox, y: dy + dh / 2 - oh / 2, w: colW - 18, h: oh, title: f.otherwise.title, sub: osub, tone: "accent" });
  return svg(W, ry + rh + 8, out, "Decision diagram");
}

/** Auto-laid-out sequence diagram with optional groups (ported from the handbook kit). */
function sequence(f: Extract<Figure, { kind: "sequence" }>): string {
  const { actors } = f;
  const top = 46;
  const left = 70;
  const rowH = 23;
  const gap = (W - left * 2) / Math.max(1, actors.length - 1);
  const xOf = Object.fromEntries(actors.map((a, i) => [a.id, left + i * gap]));
  let y = top + 22;
  type Row = { from: string; to: string; label: string; reply: boolean; y: number };
  const rows: Row[] = [];
  const groups: Array<{ y0: number; y1: number; label: string }> = [];
  for (const s of f.steps) {
    if ("group" in s) {
      const y0 = y - 6;
      y += 18;
      for (const m of s.steps) {
        rows.push({ ...m, y });
        y += m.from === m.to ? rowH + 12 : rowH;
      }
      groups.push({ y0, y1: y - 8, label: s.group });
      y += 10;
    } else {
      rows.push({ ...s, y });
      y += s.from === s.to ? rowH + 12 : rowH;
    }
  }
  const h = y + 8;
  let body = "";
  for (const g of groups) {
    const x0 = left - 60;
    const x1 = left + gap * (actors.length - 1) + 60;
    body += `<rect class="d-group" x="${round(x0)}" y="${round(g.y0)}" width="${round(x1 - x0)}" height="${round(g.y1 - g.y0)}"/>`;
    body += `<text class="d-group-label" x="${round(x0 + 8)}" y="${round(g.y0 + 13)}">${esc(g.label)}</text>`;
  }
  let head = "";
  const actorW = Math.min(124, gap - 10);
  for (const a of actors) {
    const x = xOf[a.id]!;
    head += `<line class="d-life" x1="${round(x)}" y1="${top}" x2="${round(x)}" y2="${round(h)}"/>`;
    head += `<g class="n"><rect class="d-actor ${a.accent ? "accent" : ""}" x="${round(x - actorW / 2)}" y="4" width="${round(actorW)}" height="${a.sub ? 38 : 28}"/>`;
    head += `<text class="d-t" x="${round(x)}" y="${a.sub ? 20 : 22}" text-anchor="middle">${esc(a.label)}</text>`;
    if (a.sub) head += `<text class="d-m" x="${round(x)}" y="34" text-anchor="middle">${esc(a.sub)}</text>`;
    head += "</g>";
  }
  for (const r of rows) {
    const x1 = xOf[r.from]!;
    const x2 = xOf[r.to]!;
    const v = r.reply ? "dash" : "";
    if (x1 === x2) {
      body += edge({ points: [[x1, r.y], [x1 + 30, r.y], [x1 + 30, r.y + 12], [x1 + 4, r.y + 12]], v });
      body += `<text class="d-edge-label d-halo" x="${round(x1 + 38)}" y="${round(r.y + 10)}">${esc(r.label)}</text>`;
    } else {
      const dir = Math.sign(x2 - x1);
      body += edge({ points: [[x1 + dir * 3, r.y], [x2 - dir * 3, r.y]], v });
      body += `<text class="d-edge-label d-halo" x="${round((x1 + x2) / 2)}" y="${round(r.y - 5)}" text-anchor="middle">${esc(r.label)}</text>`;
    }
  }
  return svg(W, h, head + body, "Sequence diagram");
}

/** States in a row; adjacent forward transitions run straight, the rest route above (forward) or below (back). */
function states(f: Extract<Figure, { kind: "states" }>): string {
  const n = f.states.length;
  const pad = 10;
  const gapX = n <= 3 ? 150 : n === 4 ? 110 : 90;
  const bw = (W - 2 * pad - (n - 1) * gapX) / n;
  const index = new Map(f.states.map((s, i) => [s.id, i]));
  const straight: typeof f.transitions = [];
  const above: typeof f.transitions = [];
  const below: typeof f.transitions = [];
  const usedStraight = new Set<string>();
  for (const t of f.transitions) {
    const a = index.get(t.from)!;
    const b = index.get(t.to)!;
    if (b === a + 1 && !usedStraight.has(`${a}`)) {
      straight.push(t);
      usedStraight.add(`${a}`);
    } else if (b > a) above.push(t);
    else below.push(t);
  }
  const level = 26;
  const by = 20 + above.length * level + (above.length ? 14 : 0);
  const subs = f.states.map((s) => wrap(s.sub, charsFor(bw - 14, "s"), 2));
  const bh = Math.max(...subs.map((s) => boxHeight(1 + s.length)), 46);
  const xOf = (i: number) => pad + i * (bw + gapX);
  const cy = by + bh / 2;
  let out = "";
  let labels = "";
  const portCount = new Map<string, number>();
  const port = (i: number, side: "top" | "bottom") => {
    const key = `${i}${side}`;
    const k = portCount.get(key) ?? 0;
    portCount.set(key, k + 1);
    const offsets = [0, -22, 22, -44, 44];
    return xOf(i) + bw / 2 + (offsets[k] ?? 0);
  };
  for (const t of straight) {
    const a = index.get(t.from)!;
    const x1 = xOf(a) + bw;
    const x2 = xOf(a + 1);
    out += edge({ points: [[x1, cy], [x2 - 1, cy]] });
    labels += labelText(wrap(t.label, charsFor(gapX - 8, "e"), 3), (x1 + x2) / 2, cy - 8);
  }
  above.forEach((t, k) => {
    const a = index.get(t.from)!;
    const b = index.get(t.to)!;
    const ly = by - 14 - k * level;
    const xa = port(a, "top");
    const xb = port(b, "top");
    out += edge({ points: [[xa, by], [xa, ly], [xb, ly], [xb, by - 1]] });
    labels += labelText([t.label], (xa + xb) / 2, ly - 5);
  });
  below.forEach((t, k) => {
    const a = index.get(t.from)!;
    const b = index.get(t.to)!;
    const ly = by + bh + 14 + k * level;
    const xa = port(a, "bottom");
    const xb = port(b, "bottom");
    out += edge({ points: [[xa, by + bh], [xa, ly], [xb, ly], [xb, by + bh + 1]], v: "dash" });
    labels += labelText([t.label], (xa + xb) / 2, ly - 5);
  });
  f.states.forEach((s, i) => {
    out += box({ x: xOf(i), y: by, w: bw, h: bh, title: s.title, sub: subs[i], tone: s.tone === "default" ? (i === 0 ? "accent" : "default") : s.tone });
  });
  const H = by + bh + 14 + below.length * level + 6;
  return svg(W, H, out + labels, "State diagram");
}

function labelText(lines: string[], x: number, y: number, anchor: "start" | "middle" | "end" = "middle"): string {
  const top = y - (lines.length - 1) * 12;
  return lines.map((l, i) => `<text class="d-edge-label d-halo" x="${round(x)}" y="${round(top + i * 12)}" text-anchor="${anchor}">${esc(l)}</text>`).join("");
}
