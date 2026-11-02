import { describeActivity, upsertActivity, type Activity } from "./activity";

/**
 * One agent turn as the chat shows it, built from the streamed events in order:
 * "Thought for 3s", the narration the agent writes before acting, "Worked for 7s" groups of
 * steps, and finally the answer (the draft). Short thinking between tool calls is folded into
 * the surrounding work group, so a turn reads Thought → narration → Worked → answer.
 */
export type Segment =
  | { kind: "thought"; id: string; startedAt: number; endedAt: number | null }
  | { kind: "narration"; id: string; text: string }
  | { kind: "work"; id: string; startedAt: number; endedAt: number | null; items: WorkItem[] };

export type WorkItem = { kind: "step"; activity: Activity } | { kind: "thought"; id: string; startedAt: number; endedAt: number | null };

export interface Turn {
  startedAt: number;
  segments: Segment[];
  /** Text streamed since the last tool call: the answer, unless a tool call follows. */
  draft: string;
}

export const newTurn = (now: number): Turn => ({ startedAt: now, segments: [], draft: "" });

export type TurnEvent = { event: "activity"; data: Activity } | { event: "text"; delta: string } | { event: "text_reset" };

export function reduceTurn(turn: Turn, e: TurnEvent, now: number): Turn {
  const segments = [...turn.segments];
  const last = segments[segments.length - 1];
  const closeWork = () => {
    if (last?.kind === "work" && last.endedAt === null) segments[segments.length - 1] = { ...last, endedAt: now };
  };

  if (e.event === "text") return { ...turn, draft: turn.draft + e.delta };
  if (e.event === "text_reset") {
    // What streamed was the agent narrating before a tool call: keep it as narration.
    const text = turn.draft.trim();
    if (text) {
      closeWork();
      segments.push({ kind: "narration", id: `n${segments.length}-${now}`, text });
    }
    return { ...turn, segments, draft: "" };
  }

  const a = e.data;
  if (a.name === "thinking") {
    // An update to a thought already shown, wherever it is.
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i]!;
      if (s.kind === "thought" && s.id === a.id) {
        segments[i] = { ...s, endedAt: a.status === "started" ? null : now };
        return { ...turn, segments };
      }
      if (s.kind === "work") {
        const j = s.items.findIndex((it) => it.kind === "thought" && it.id === a.id);
        if (j >= 0) {
          const items = [...s.items];
          items[j] = { ...(items[j] as Extract<WorkItem, { kind: "thought" }>), endedAt: a.status === "started" ? null : now };
          segments[i] = { ...s, items };
          return { ...turn, segments };
        }
      }
    }
    if (a.status !== "started") return turn;
    // Thinking inside a run of tool calls belongs to that run.
    if (last?.kind === "work") {
      segments[segments.length - 1] = { ...last, endedAt: null, items: [...last.items, { kind: "thought", id: a.id, startedAt: now, endedAt: null }] };
    } else segments.push({ kind: "thought", id: a.id, startedAt: now, endedAt: null });
    return { ...turn, segments };
  }

  if (describeActivity(a) === null) return turn;
  // An update to a step already shown.
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]!;
    if (s.kind !== "work") continue;
    const j = s.items.findIndex((it) => it.kind === "step" && it.activity.id === a.id);
    if (j >= 0) {
      const items = [...s.items];
      items[j] = { kind: "step", activity: upsertActivity([(items[j] as Extract<WorkItem, { kind: "step" }>).activity], a)[0]! };
      segments[i] = { ...s, items };
      return { ...turn, segments };
    }
  }
  const step: WorkItem = { kind: "step", activity: a };
  if (last?.kind === "work") segments[segments.length - 1] = { ...last, endedAt: null, items: [...last.items, step] };
  else segments.push({ kind: "work", id: `w${segments.length}-${now}`, startedAt: now, endedAt: null, items: [step] });
  return { ...turn, segments };
}

/** Closes everything still open when the turn ends. */
export function finishTurn(turn: Turn, now: number): Turn {
  return {
    ...turn,
    draft: "",
    segments: turn.segments.map((s) =>
      s.kind === "narration"
        ? s
        : s.kind === "thought"
          ? { ...s, endedAt: s.endedAt ?? now }
          : { ...s, endedAt: s.endedAt ?? now, items: s.items.map((it) => (it.kind === "thought" ? { ...it, endedAt: it.endedAt ?? now } : it)) },
    ),
  };
}

export function stepCount(turn: Turn): number {
  return turn.segments.reduce((n, s) => n + (s.kind === "work" ? s.items.filter((i) => i.kind === "step").length : 0), 0);
}
