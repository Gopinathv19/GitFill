import { cn } from "@/lib/utils";

/**
 * Renders a recorded tool input or output as readable information instead of JSON: objects as
 * label/value rows, multi-line text as a code block, lists as chips or a small table. Used
 * wherever the app shows what an agent step received or returned.
 */

const ACRONYMS = new Set(["id", "url", "api", "sha", "llm", "ms", "kb", "mb", "uri", "json", "html", "pdf", "pptx"]);

/** "end_line" / "totalLines" → "End line" / "Total lines". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** Folds start_line/end_line (and startLine/endLine) into one "Lines" entry. */
function entriesOf(obj: Record<string, unknown>): Array<[string, unknown]> {
  const start = obj.start_line ?? obj.startLine;
  const end = obj.end_line ?? obj.endLine;
  const out: Array<[string, unknown]> = [];
  let linesAdded = false;
  for (const [k, v] of Object.entries(obj)) {
    if (["start_line", "startLine", "end_line", "endLine"].includes(k) && (typeof start === "number" || typeof end === "number")) {
      if (!linesAdded) {
        out.push(["Lines", typeof start === "number" && typeof end === "number" && end !== start ? `${start}–${end}` : String(start ?? end)]);
        linesAdded = true;
      }
      continue;
    }
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    out.push([humanizeKey(k), v]);
  }
  return out;
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">none</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number") return <span className="tabular-nums">{value.toLocaleString()}</span>;
  const text = String(value);
  if (text.includes("\n")) return <CodeText text={text} />;
  // Paths, URLs and identifiers read better in monospace.
  const mono = /^[\w./@:#~-]+$/.test(text) && /[/._:]/.test(text);
  return <span className={cn("break-words", mono && "font-mono text-[11.5px]")}>{text}</span>;
}

function CodeText({ text }: { text: string }) {
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-foreground/85">{text.replace(/\s+$/, "")}</pre>;
}

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  // Same labels and line-range folding as field lists, so "Lines 47–53" is one column.
  const records = rows.map((r) => new Map(entriesOf(r)));
  const cols = [...new Set(records.flatMap((r) => [...r.keys()]))].slice(0, 5);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-muted-foreground">
          <tr>{cols.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {records.slice(0, 50).map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const v = r.get(c);
                return (
                  <td key={c} className="py-1 pr-3 align-top">
                    {v === undefined ? null : isScalar(v) ? <Scalar value={v} /> : <span className="text-muted-foreground">{Array.isArray(v) ? `${v.length} items` : "…"}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 ? <p className="pt-1 text-[11px] text-muted-foreground">and {rows.length - 50} more</p> : null}
    </div>
  );
}

/** The recorder trims long lists and appends "…N more" (lib/agent/recorder.ts summarize). */
function splitTrimmed(list: unknown[]): { items: unknown[]; more: number } {
  const last = list[list.length - 1];
  const m = typeof last === "string" ? /^…(\d+) more$/.exec(last) : null;
  return m ? { items: list.slice(0, -1), more: Number(m[1]) } : { items: list, more: 0 };
}

function Value({ value, depth }: { value: unknown; depth: number }) {
  if (isScalar(value)) return <Scalar value={value} />;
  if (Array.isArray(value)) {
    const { items, more } = splitTrimmed(value);
    if (more) {
      return (
        <div className="space-y-1">
          <Value value={items} depth={depth} />
          <p className="text-[11px] text-muted-foreground">and {more} more</p>
        </div>
      );
    }
    if (value.every(isScalar)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.slice(0, 40).map((v, i) => (
            <span key={i} className="rounded border bg-background/70 px-1.5 py-px font-mono text-[11px]">
              {String(v)}
            </span>
          ))}
          {value.length > 40 ? <span className="text-[11px] text-muted-foreground">+{value.length - 40} more</span> : null}
        </span>
      );
    }
    if (value.every(isPlainObject)) return <Table rows={value as Record<string, unknown>[]} />;
    return <span className="text-muted-foreground">{value.length} items</span>;
  }
  if (isPlainObject(value)) {
    if (depth > 2) return <span className="text-muted-foreground">{Object.keys(value).length} fields</span>;
    return <Fields obj={value} depth={depth + 1} />;
  }
  return <Scalar value={String(value)} />;
}

function Fields({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const entries = entriesOf(obj);
  if (!entries.length) return <span className="text-muted-foreground">nothing</span>;
  return (
    <dl className={cn("grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1.5", depth > 1 && "border-l pl-3")}>
      {entries.map(([k, v]) => {
        const block = (typeof v === "string" && v.includes("\n")) || (Array.isArray(v) && v.some(isPlainObject)) || isPlainObject(v);
        return block ? (
          <div key={k} className="col-span-2 space-y-1">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd>
              <Value value={v} depth={depth} />
            </dd>
          </div>
        ) : (
          <div key={k} className="contents">
            <dt className="text-[12px] text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-[12.5px]">
              <Value value={v} depth={depth} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function DataView({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn("min-w-0 text-[12.5px]", className)}>
      {isPlainObject(value) ? <Fields obj={value} depth={1} /> : <Value value={value} depth={1} />}
    </div>
  );
}

/** True when there is something worth showing. */
export function hasData(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}
