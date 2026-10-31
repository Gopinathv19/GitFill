import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { defineTool, runToolLoop } from "@/lib/agent/tool-loop";

/** Fake model that issues one scripted tool call per turn. */
function scripted(calls: Array<{ name: string; args: object }>) {
  let turn = 0;
  return {
    async chat() {
      const c = calls[turn++]!;
      return {
        message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: `t${turn}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] },
        finishReason: "tool_calls",
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "fake",
      };
    },
  } as unknown as MuseClient;
}

const tools = [
  defineTool({
    name: "ask",
    description: "",
    input: z.object({ q: z.string() }),
    run: async ({ q }) => (q === "bad" ? { error: "failed" } : { attached: true }),
    terminal: (r) => (r as { attached?: boolean }).attached === true,
  }),
  defineTool({ name: "reply", description: "", input: z.object({ message: z.string() }), terminal: true, run: async () => ({ sent: true }) }),
];

describe("runToolLoop conditional terminal tools", () => {
  it("ends the loop when the tool's result says so", async () => {
    const out = await runToolLoop<{ q?: string; message?: string }>({ client: scripted([{ name: "ask", args: { q: "ok" } }]), model: "m", purpose: "t", system: "", messages: [], tools, recorder: new MemoryRecorder() });
    expect(out).toMatchObject({ turns: 1, result: { q: "ok" } });
  });

  it("keeps going when the tool failed", async () => {
    const out = await runToolLoop<{ q?: string; message?: string }>({
      client: scripted([{ name: "ask", args: { q: "bad" } }, { name: "reply", args: { message: "sorry" } }]),
      model: "m",
      purpose: "t",
      system: "",
      messages: [],
      tools,
      recorder: new MemoryRecorder(),
    });
    expect(out).toMatchObject({ turns: 2, result: { message: "sorry" } });
  });
});

describe("runToolLoop turn limit", () => {
  it("offers only the terminal tool on the last turn and finishes", async () => {
    const seen: string[][] = [];
    let turn = 0;
    const client = {
      async chat(req: { tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content?: unknown }> }) {
        seen.push((req.tools ?? []).map((t) => t.function.name));
        turn++;
        const last = req.messages.at(-1)?.content;
        const call = typeof last === "string" && last.startsWith("This is your last turn") ? { name: "reply", args: { message: "partial" } } : { name: "ask", args: { q: "bad" } };
        return {
          message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: `t${turn}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] },
          finishReason: "tool_calls",
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "fake",
        };
      },
    } as unknown as MuseClient;
    const out = await runToolLoop<{ message?: string }>({ client, model: "m", purpose: "t", system: "", messages: [], tools, recorder: new MemoryRecorder(), maxTurns: 3 });
    expect(out).toMatchObject({ turns: 3, result: { message: "partial" } });
    expect(seen).toEqual([["ask", "reply"], ["ask", "reply"], ["reply"]]);
  });
});

describe("runToolLoop text streaming", () => {
  it("streams answer text, and resets text written before tool calls", async () => {
    const events: string[] = [];
    let turn = 0;
    const client = {
      async chatStream(_req: unknown, onText: (d: string) => void) {
        turn++;
        if (turn === 1) {
          onText("Let me look.");
          return { message: { role: "assistant", content: "Let me look.", refusal: null, tool_calls: [{ id: "t1", type: "function", function: { name: "ask", arguments: '{"q":"bad"}' } }] }, finishReason: "tool_calls", usage: { inputTokens: 0, outputTokens: 0 }, model: "fake" };
        }
        for (const d of ["The answer ", "is in `a.ts:1` and is long enough."]) onText(d);
        return { message: { role: "assistant", content: "The answer is in `a.ts:1` and is long enough.", refusal: null }, finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 }, model: "fake" };
      },
    } as unknown as MuseClient;
    const recorder = new MemoryRecorder((e) => events.push(e.type === "text" ? `text:${e.delta}` : e.type === "activity" ? `${e.name}:${e.status}` : e.type));
    const out = await runToolLoop<string>({ client, model: "m", purpose: "t", system: "", messages: [], tools, recorder, finishOnText: true, streamText: true });
    expect(out.result).toBe("The answer is in `a.ts:1` and is long enough.");
    expect(events).toEqual([
      "thinking:started",
      "text:Let me look.",
      "thinking:succeeded",
      "text_reset",
      "ask:started",
      "ask:succeeded",
      "thinking:started",
      "text:The answer ",
      "text:is in `a.ts:1` and is long enough.",
      "thinking:succeeded",
    ]);
  });
});
