/*
 * Runs inside the rendered deck page (Chromium) and describes every page as native drawing items
 * for the PowerPoint writer: boxes (background, border, corner radius), lines, text boxes with
 * styled runs, images, and diagram shapes read from the SVG. Coordinates are CSS px relative to
 * the page's top-left corner. The page background itself (gradients, dot grids) is captured
 * separately as an image, so it is skipped here.
 *
 * Plain browser JavaScript, evaluated as a string, so no build step can rewrite it.
 */
(async () => {
  const pages = Array.from(document.querySelectorAll(".page"));
  const out = [];

  const parseColor = (c) => {
    if (!c || c === "transparent") return null;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    if (a <= 0.01) return null;
    const hex = [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    return { hex, alpha: a };
  };
  const firstGradientColor = (img) => {
    const m = /rgba?\([^)]+\)/.exec(img || "");
    return m ? parseColor(m[0]) : null;
  };
  const visible = (cs) => cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.02;
  const hasBox = (el, cs) => {
    if (parseColor(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== "none")) return true;
    return ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && parseColor(cs[`border${s}Color`]));
  };
  const fontKind = (family) => (/mono/i.test(family) ? "mono" : /georgia|serif/i.test(family) && !/sans/i.test(family) ? "heading" : "sans");

  /** Rasterizes a small inline SVG (icons, the GitFill mark) to a PNG data URI at 4x. */
  const rasterize = async (svgEl, w, h) => {
    const clone = svgEl.cloneNode(true);
    const color = getComputedStyle(svgEl).color;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML.replace(/currentColor/g, color))}`;
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => null);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * 4));
    canvas.height = Math.max(1, Math.round(h * 4));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  };

  for (const page of pages) {
    const origin = page.getBoundingClientRect();
    const items = [];
    const rel = (r) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
    const consumed = new Set();

    /** Runs of styled text from inline content (text nodes and inline formatting elements). */
    const runsOf = (nodes, pre) => {
      const runs = [];
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          const cs = getComputedStyle(parent);
          let text = node.textContent || "";
          if (!pre) text = text.replace(/\s+/g, " ");
          if (!text) return;
          if (cs.textTransform === "uppercase") text = text.toUpperCase();
          // Outlined text (transparent fill + text stroke) keeps its stroke colour as an outline.
          const strokeW = parseFloat(cs.webkitTextStrokeWidth) || 0;
          const strokeC = strokeW > 0 ? parseColor(cs.webkitTextStrokeColor) : null;
          const fillC = parseColor(cs.color);
          const c = fillC || strokeC || { hex: "000000", alpha: 1 };
          runs.push({
            text,
            size: parseFloat(cs.fontSize),
            color: c.hex,
            ...(!fillC && strokeC ? { outline: strokeW } : {}),
            bold: Number(cs.fontWeight) >= 600,
            italic: cs.fontStyle === "italic",
            font: fontKind(cs.fontFamily),
            spacing: parseFloat(cs.letterSpacing) || 0,
          });
          return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          consumed.add(node);
          for (const child of Array.from(node.childNodes)) visit(child);
        }
      };
      nodes.forEach(visit);
      // Trim the outer whitespace of the segment.
      while (runs.length && !runs[0].text.trim()) runs.shift();
      while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
      if (runs.length) {
        runs[0].text = runs[0].text.replace(/^\s+/, "");
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
      }
      return runs;
    };

    const isInline = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return true;
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = node.tagName.toLowerCase();
      if (tag === "svg" || tag === "img" || tag === "br") return false;
      const cs = getComputedStyle(node);
      return cs.display === "inline" && !hasBox(node, cs);
    };

    const emitText = (el, nodes) => {
      if (!nodes.some((n) => (n.textContent || "").trim())) return;
      const cs = getComputedStyle(el);
      const pre = /pre/.test(cs.whiteSpace);
      const range = document.createRange();
      range.setStartBefore(nodes[0]);
      range.setEndAfter(nodes[nodes.length - 1]);
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      const runs = runsOf(nodes, pre);
      if (!runs.length) return;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      // A box that owns its text alignment (centred stat values, table cells) keeps it.
      const align = cs.textAlign === "center" ? "center" : cs.textAlign === "right" || cs.textAlign === "end" ? "right" : "left";
      items.push({ t: "text", ...rel(rect), runs, align, lineHeight: lh, lines: tops.size, pre });
    };

    const walk = (el) => {
      const cs = getComputedStyle(el);
      if (!visible(cs)) return;
      const tag = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      if (tag === "svg") return; // handled below
      if (tag === "img") {
        if (r.width && r.height && el.currentSrc) items.push({ t: "image", ...rel(r), src: el.currentSrc, fit: cs.objectFit === "cover" ? "cover" : "contain", nw: el.naturalWidth, nh: el.naturalHeight });
        return;
      }
      if (el !== page && r.width > 0.5 && r.height > 0.5 && hasBox(el, cs)) {
        const fill = parseColor(cs.backgroundColor) || firstGradientColor(cs.backgroundImage);
        const sides = ["Top", "Right", "Bottom", "Left"].map((s) => ({
          w: cs[`border${s}Style`] === "none" ? 0 : parseFloat(cs[`border${s}Width`]) || 0,
          c: parseColor(cs[`border${s}Color`]),
          dash: cs[`border${s}Style`] === "dashed" || cs[`border${s}Style`] === "dotted",
        }));
        const radius = parseFloat(cs.borderTopLeftRadius) || 0;
        const same = sides.every((s) => s.w === sides[0].w && (s.c?.hex ?? "") === (sides[0].c?.hex ?? ""));
        const box = rel(r);
        const round = radius >= Math.min(box.w, box.h) / 2 - 0.5 && radius > 0;
        items.push({
          t: round ? "ellipse" : "rect",
          ...box,
          fill: fill ? fill.hex : null,
          fillAlpha: fill ? fill.alpha : 0,
          line: same && sides[0].w > 0 && sides[0].c ? { color: sides[0].c.hex, width: sides[0].w, dash: sides[0].dash } : null,
          radius: round ? 0 : radius,
        });
        if (!same) {
          const [t, rgt, b, l] = sides;
          const seg = (s, x1, y1, x2, y2) => s.w > 0 && s.c && items.push({ t: "line", x1, y1, x2, y2, color: s.c.hex, width: s.w, dash: s.dash, arrow: false });
          seg(t, box.x, box.y, box.x + box.w, box.y);
          seg(rgt, box.x + box.w, box.y, box.x + box.w, box.y + box.h);
          seg(b, box.x, box.y + box.h, box.x + box.w, box.y + box.h);
          seg(l, box.x, box.y, box.x, box.y + box.h);
        }
      }
      // Text: contiguous inline content between boxed children becomes one text box.
      let segment = [];
      const flush = () => {
        if (segment.length) emitText(el, segment);
        segment = [];
      };
      for (const child of Array.from(el.childNodes)) {
        if (isInline(child)) segment.push(child);
        else {
          flush();
          if (child.nodeType === Node.ELEMENT_NODE && !consumed.has(child)) walk(child);
        }
      }
      flush();
    };
    walk(page);

    // Diagrams: native shapes from the SVG, in page coordinates.
    for (const svg of Array.from(page.querySelectorAll(".canvas svg"))) {
      const vb = svg.viewBox.baseVal;
      const sr = svg.getBoundingClientRect();
      const scale = vb && vb.width ? Math.min(sr.width / vb.width, sr.height / vb.height) : 1;
      const ctm = svg.getScreenCTM();
      const pt = svg.createSVGPoint();
      const map = (x, y) => {
        pt.x = x;
        pt.y = y;
        const p = pt.matrixTransform(ctm);
        return [p.x - origin.left, p.y - origin.top];
      };
      for (const node of Array.from(svg.querySelectorAll("*"))) {
        const cs = getComputedStyle(node);
        if (cs.display === "none") continue;
        const tag = node.tagName.toLowerCase();
        const fill = parseColor(cs.fill);
        const stroke = cs.stroke !== "none" ? parseColor(cs.stroke) : null;
        const sw = (parseFloat(cs.strokeWidth) || 1) * scale;
        const dash = cs.strokeDasharray && cs.strokeDasharray !== "none";
        if (tag === "rect") {
          const r = rel(node.getBoundingClientRect());
          const rx = (parseFloat(cs.rx) || parseFloat(node.getAttribute("rx") || "0") || 0) * scale;
          items.push({ t: "rect", ...r, fill: fill ? fill.hex : null, fillAlpha: fill ? fill.alpha : 0, line: stroke ? { color: stroke.hex, width: sw, dash } : null, radius: rx });
        } else if (tag === "polygon" && node.classList.contains("d-diamond")) {
          const r = rel(node.getBoundingClientRect());
          items.push({ t: "diamond", ...r, fill: fill ? fill.hex : null, fillAlpha: fill ? fill.alpha : 0, line: stroke ? { color: stroke.hex, width: sw, dash } : null });
        } else if (tag === "path" || tag === "line") {
          let pts = [];
          if (tag === "line") pts = [map(+node.getAttribute("x1"), +node.getAttribute("y1")), map(+node.getAttribute("x2"), +node.getAttribute("y2"))];
          else {
            const nums = (node.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g) || [];
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push(map(+nums[i], +nums[i + 1]));
          }
          const next = node.nextElementSibling;
          const arrow = Boolean(next && next.classList.contains("d-arrow"));
          const color = stroke ? stroke.hex : "888888";
          for (let i = 0; i + 1 < pts.length; i++) {
            items.push({ t: "line", x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], color, width: sw, dash, arrow: arrow && i === pts.length - 2 });
          }
        } else if (tag === "text") {
          const r = rel(node.getBoundingClientRect());
          const anchor = node.getAttribute("text-anchor") || "start";
          const c = fill || { hex: "000000" };
          const size = parseFloat(cs.fontSize) * scale;
          items.push({
            t: "text",
            ...r,
            runs: [{ text: cs.textTransform === "uppercase" ? (node.textContent || "").toUpperCase() : node.textContent || "", size, color: c.hex, bold: Number(cs.fontWeight) >= 600, italic: false, font: fontKind(cs.fontFamily), spacing: (parseFloat(cs.letterSpacing) || 0) * scale }],
            align: anchor === "middle" ? "center" : anchor === "end" ? "right" : "left",
            lineHeight: size * 1.2,
            lines: 1,
            pre: false,
            svg: true,
          });
        }
      }
    }

    // Icons and marks: small SVGs outside diagrams become images.
    for (const svg of Array.from(page.querySelectorAll("svg"))) {
      if (svg.closest(".canvas")) continue;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (!visible(getComputedStyle(svg))) continue;
      items.push({ t: "image", ...rel(r), src: await rasterize(svg, r.width, r.height), fit: "contain", nw: r.width * 4, nh: r.height * 4 });
    }

    out.push({ slideId: page.dataset.slide || "", width: origin.width, height: origin.height, items });
  }
  return out;
})()
