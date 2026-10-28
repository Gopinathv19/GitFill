import type { z } from "zod";
import type { ChatCompletionMessageParam, ChatCompletionTool, MuseClient } from "@/lib/ai/client";
import { toModelJsonSchema } from "@/lib/ai/json-schema";
import { summarize, type RunRecorder } from "./recorder";

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Executes in application code. Returned value is serialized back to the model. */
  run(input: z.infer<S>): Promise<unknown>;
  /** A terminal tool ends the loop; its validated input becomes the loop result. */
  terminal?: boolean;
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

export interface ToolLoopOptions {
  client: MuseClient;
  model: string;
  purpose: string;
  system: string;
  messages: ChatCompletionMessageParam[];
  tools: ToolDefinition[];
  recorder: RunRecorder;
  maxTurns?: number;
  maxToolCalls?: number;
  maxTokens?: number;
}

export interface ToolLoopResult<T> {
  result: T;
  turns: number;
  toolCalls: number;
}

export class ToolLoopError extends Error {
  override name = "ToolLoopError";
}

const MAX_TOOL_RESULT_CHARS = 24_000;

/**
 * Bounded agent loop: the model proposes tool calls, application code validates and
 * executes them, and real results go back to the model until a terminal tool is called.
 */
export async function runToolLoop<T>(opts: ToolLoopOptions): Promise<ToolLoopResult<T>> {
  const maxTurns = opts.maxTurns ?? 12;
  const maxToolCalls = opts.maxToolCalls ?? 60;
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const tools: ChatCompletionTool[] = opts.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: toModelJsonSchema(t.input) },
  }));
  const terminalNames = opts.tools.filter((t) => t.terminal).map((t) => t.name);
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }, ...opts.messages];
  let toolCalls = 0;
  let nudges = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const res = await opts.client.chat({ model: opts.model, messages, tools, purpose: `${opts.purpose}:turn${turn}`, maxTokens: opts.maxTokens });
    await opts.recorder.addUsage(res.usage.inputTokens, res.usage.outputTokens);
    const calls = (res.message.tool_calls ?? []).filter((c) => c.type === "function");

    if (calls.length === 0) {
      if (nudges >= 2) throw new ToolLoopError(`Agent stopped without calling ${terminalNames.join(" or ")}.`);
      nudges++;
      messages.push(
        { role: "assistant", content: res.message.content ?? "" },
        { role: "user", content: `Continue using the tools. When done, call ${terminalNames.join(" or ")}.` },
      );
      continue;
    }

    messages.push({ role: "assistant", content: res.message.content ?? null, tool_calls: res.message.tool_calls });
    let terminalResult: { value: T } | undefined;

    for (const call of calls) {
      toolCalls++;
      const tool = byName.get(call.function.name);
      const output = await executeCall(tool, call.function.name, call.function.arguments, opts.recorder, toolCalls > maxToolCalls);
      if (output.ok && tool?.terminal) terminalResult = { value: output.input as T };
      messages.push({ role: "tool", tool_call_id: call.id, content: truncate(JSON.stringify(output.ok ? output.result : { error: output.error })) });
    }

    if (terminalResult) return { result: terminalResult.value, turns: turn, toolCalls };
    if (toolCalls > maxToolCalls) {
      messages.push({ role: "user", content: `Tool budget exhausted. Call ${terminalNames.join(" or ")} now with what you have.` });
    }
  }
  throw new ToolLoopError(`Agent did not finish within ${maxTurns} turns.`);
}

type CallOutcome = { ok: true; input: unknown; result: unknown } | { ok: false; error: string };

async function executeCall(
  tool: ToolDefinition | undefined,
  name: string,
  rawArgs: string,
  recorder: RunRecorder,
  overBudget: boolean,
): Promise<CallOutcome> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    args = undefined;
  }
  const event = await recorder.start("tool", name, summarize(args));
  if (!tool) {
    await event.fail("unknown_tool");
    return { ok: false, error: `Unknown tool "${name}".` };
  }
  if (overBudget && !tool.terminal) {
    await event.fail("tool_budget_exhausted");
    return { ok: false, error: "Tool budget exhausted; only terminal tools may be called now." };
  }
  if (args === undefined) {
    await event.fail("invalid_json_arguments");
    return { ok: false, error: "Arguments were not valid JSON." };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    await event.fail("invalid_arguments", issues);
    return { ok: false, error: `Invalid arguments: ${issues.join("; ")}` };
  }
  try {
    const result = await tool.run(parsed.data);
    await event.succeed(summarize(result));
    return { ok: true, input: parsed.data, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed";
    await event.fail(message.slice(0, 300));
    return { ok: false, error: message.slice(0, 500) };
  }
}

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]` : text;
}
