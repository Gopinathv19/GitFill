import { deckSpecSchema, type DeckSpec } from "./spec";

/**
 * Reads a stored deck spec. Decks generated before the page-and-block format (one layout per
 * slide: bullets, architecture, flow…) are converted block by block, so revising an old deck
 * still works; the first render after conversion is validated and repaired like any other.
 */
export function parseDeckSpec(raw: unknown): DeckSpec {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.format === 2) return deckSpecSchema.parse(raw);
  return deckSpecSchema.parse(upgradeLegacy(obj));
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Old fields may be longer than the new limits; cut on a word boundary. */
function clip(v: unknown, max: number): string | undefined {
  if (v == null || v === "") return undefined;
  const t = String(v).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max / 2 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

function upgradeLegacy(old: Any): Any {
  const slides = (old.slides ?? []) as Any[];
  let section = "Overview";
  const out = slides.map((s, i) => {
    const base = { id: s.id ?? `s${i + 1}`, notes: s.notes ?? "", claimRefs: s.claimRefs ?? [] };
    const bullets = (list: Any[] = []) => list.slice(0, 7).map((b) => ({ text: clip(b.text, 200), claimRefs: b.claimRefs ?? [] }));
    const page = (main: Any[], side: Any[] = [], arrangement = side.length ? "split" : "stack") => ({ ...base, layout: "page", section, title: clip(s.title, 80), arrangement, main, side });
    switch (s.layout) {
      case "title":
        return {
          ...base,
          layout: "cover",
          title: clip(s.title, 110),
          subtitle: clip(s.subtitle ?? old.subtitle ?? s.title, 220),
          tag: clip(s.meta, 30),
          visual: { type: "art" },
          illustrationPrompt: clip(s.illustrationPrompt, 400),
        };
      case "section":
        section = clip(s.title, 36)!;
        return page([{ type: "callout", tone: "note", label: "Section", text: clip(s.subtitle || s.title, 260) }]);
      case "bullets":
        return page([
          { type: "list", title: clip(s.title, 48), items: bullets(s.bullets) },
          ...(s.keyMessage ? [{ type: "callout", tone: "takeaway", text: clip(s.keyMessage, 260) }] : []),
        ]);
      case "two_column":
        return page(
          [{ type: "list", title: clip(s.left.heading, 48), items: bullets(s.left.bullets) }],
          [{ type: "list", title: clip(s.right.heading, 48), items: bullets(s.right.bullets) }],
          "split_even",
        );
      case "architecture": {
        const tiers = [...new Set<number>((s.nodes as Any[]).map((n) => n.tier))].sort();
        return page([
          {
            type: "diagram",
            title: clip(s.title, 60),
            figure: {
              kind: "architecture",
              lanes: tiers.map((t) => ({ id: `t${t}` })),
              nodes: (s.nodes as Any[]).map((n) => ({ id: n.id, lane: `t${n.tier}`, title: clip(n.label, 28), sub: clip(n.detail, 44) })),
              edges: (s.edges as Any[]).map((e) => ({ from: e.from, to: e.to, label: clip(e.label, 22) })),
            },
          },
          ...(s.caption ? [{ type: "callout", tone: "note", text: clip(s.caption, 260) }] : []),
        ]);
      }
      case "flow":
        return page([{ type: "steps", items: (s.steps as Any[]).map((st) => ({ title: clip(st.label, 40), text: clip(st.detail || st.label, 160), claimRefs: st.claimRefs ?? [] })) }]);
      case "stack":
        return page([
          {
            type: "table",
            columns: ["Technologies"],
            rows: (s.groups as Any[]).slice(0, 8).map((g) => ({ head: clip(g.category, 60), cells: [clip((g.items as Any[]).map((it) => it.name).join(", "), 120)] })),
          },
        ]);
      case "timeline":
        return page([{ type: "steps", items: (s.items as Any[]).map((it) => ({ title: clip(it.label, 40), text: clip(it.detail || it.label, 160) })) }]);
      case "metrics":
        return page(
          [{ type: "stats", items: (s.metrics as Any[]).map((m) => ({ value: clip(m.value, 14), label: clip(m.label, 40), claimRefs: m.claimRefs ?? [] })) }],
          s.bullets?.length ? [{ type: "list", title: "Notes", items: bullets(s.bullets) }] : [],
        );
      case "closing":
        return page([{ type: "callout", tone: "takeaway", text: clip(s.title, 260) }, ...(s.bullets?.length ? [{ type: "list", title: "Summary", items: bullets(s.bullets) }] : [])]);
      default:
        return page([{ type: "callout", tone: "note", text: clip(s.title ?? "Slide", 260) }]);
    }
  });
  // Single-item lists, steps and stats fall below the block minimums: show them as a callout.
  const fit = (b: Any): Any => {
    if (!["list", "steps", "stats"].includes(b.type) || b.items.length >= 2) return b;
    const it = b.items[0] ?? {};
    const text = b.type === "stats" ? `${it.value} ${it.label}` : b.type === "steps" ? `${it.title}: ${it.text}` : it.text;
    return { type: "callout", tone: "note", label: b.title?.slice(0, 30), text: String(text ?? b.title).slice(0, 260) };
  };
  for (const s of out as Any[]) {
    if (s.main) s.main = s.main.map(fit);
    if (s.side) s.side = s.side.map(fit);
  }
  return { format: 2, title: clip(old.title, 90), subtitle: clip(old.subtitle, 160) ?? "", audience: old.audience ?? "Engineering team", purpose: old.purpose ?? "Explain the repository.", theme: old.theme ?? "midnight", slides: out };
}
