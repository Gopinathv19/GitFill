import OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { z } from "zod";
import { env, requireEnv } from "@/lib/config/env";
import { toModelJsonSchema } from "./json-schema";

export type { ChatCompletionMessageParam, ChatCompletionTool };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Hidden reasoning budget for reasoning models. Lower is much faster (Muse Spark: minimal ≈ 3x faster than default). */
  reasoningEffort?: ReasoningEffort;
  /** Label recorded with the call, e.g. "plan_deck". */
  purpose: string;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ChatResult {
  message: ChatCompletionMessage;
  finishReason: string | null;
  usage: Usage;
  model: string;
}

/** Called after every model request so callers can persist an audit trail. */
export type ModelCallObserver = (event: {
  purpose: string;
  model: string;
  usage: Usage;
  durationMs: number;
  error?: string;
}) => void | Promise<void>;

export class ModelError extends Error {
  override name = "ModelError";
}

export class StructuredOutputError extends ModelError {
  override name = "StructuredOutputError";
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

/**
 * Thin wrapper over Meta Model API's OpenAI-compatible Chat Completions endpoint.
 * The rest of the app talks to this interface, never to the SDK directly.
 */
export class MuseClient {
  private readonly sdk: OpenAI;

  constructor(
    private readonly observer?: ModelCallObserver,
    sdk?: OpenAI,
  ) {
    this.sdk =
      sdk ??
      new OpenAI({
        apiKey: requireEnv("MODEL_API_KEY"),
        baseURL: env().MODEL_API_BASE_URL,
        maxRetries: 2,
        timeout: 180_000,
      });
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    return this.call(req, undefined);
  }

  /**
   * Same as chat(), but streams the reply: `onText` receives text as it is generated. Tool calls
   * arrive in fragments and are assembled, so the result has the same shape as chat()'s.
   */
  async chatStream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    const started = Date.now();
    try {
      const stream = await this.sdk.chat.completions.create({ ...this.params(req, undefined), stream: true, stream_options: { include_usage: true } }, { timeout: req.timeoutMs ?? 180_000 });
      let content = "";
      let finishReason: string | null = null;
      let model = req.model;
      const usage = { inputTokens: 0, outputTokens: 0 };
      const calls: Array<{ id: string; name: string; args: string }> = [];
      for await (const chunk of stream) {
        if (chunk.model) model = chunk.model;
        if (chunk.usage) Object.assign(usage, { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 });
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta.content) {
          content += choice.delta.content;
          onText(choice.delta.content);
        }
        for (const tc of choice.delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      const toolCalls = calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.args } }));
      const message: ChatCompletionMessage = { role: "assistant", content: content || null, refusal: null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
      await this.observer?.({ purpose: req.purpose, model: req.model, usage, durationMs: Date.now() - started });
      return { message, finishReason, usage, model };
    } catch (err) {
      const message = describeError(err);
      await this.observer?.({ purpose: req.purpose, model: req.model, usage: { inputTokens: 0, outputTokens: 0 }, durationMs: Date.now() - started, error: message });
      if (err instanceof ModelError) throw err;
      throw new ModelError(message);
    }
  }

  /**
   * Requests JSON constrained to `schema`, then validates it with Zod. On validation
   * failure the issues are sent back once for a bounded self-correction.
   */
  async structured<S extends z.ZodType>(
    req: ChatRequest & { schema: S; schemaName: string; correctionAttempts?: number },
  ): Promise<{ data: z.infer<S>; usage: Usage }> {
    const responseFormat = {
      type: "json_schema" as const,
      json_schema: { name: req.schemaName, strict: false, schema: toModelJsonSchema(req.schema) },
    };
    const messages = [...req.messages];
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const maxAttempts = 1 + (req.correctionAttempts ?? 1);
    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.call({ ...req, messages, purpose: attempt === 1 ? req.purpose : `${req.purpose}:correction` }, responseFormat);
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
      const text = res.message.content ?? "";

      let candidate: unknown;
      try {
        candidate = JSON.parse(stripFences(text));
      } catch {
        lastIssues = ["Response was not valid JSON."];
        messages.push({ role: "assistant", content: text }, { role: "user", content: correctionPrompt(lastIssues) });
        continue;
      }
      const parsed = req.schema.safeParse(candidate);
      if (parsed.success) return { data: parsed.data, usage };

      lastIssues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      messages.push({ role: "assistant", content: text }, { role: "user", content: correctionPrompt(lastIssues) });
    }
    throw new StructuredOutputError(`Model output for ${req.schemaName} failed validation.`, lastIssues);
  }

  private params(req: ChatRequest, responseFormat: OpenAI.ChatCompletionCreateParams["response_format"] | undefined) {
    return {
      model: req.model,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: "auto" as const } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    };
  }

  private async call(
    req: ChatRequest,
    responseFormat: OpenAI.ChatCompletionCreateParams["response_format"] | undefined,
  ): Promise<ChatResult> {
    const started = Date.now();
    try {
      const res = await this.sdk.chat.completions.create(this.params(req, responseFormat), { timeout: req.timeoutMs ?? 180_000 });
      const choice = res.choices[0];
      if (!choice) throw new ModelError("Model returned no choices.");
      const usage = { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
      await this.observer?.({ purpose: req.purpose, model: req.model, usage, durationMs: Date.now() - started });
      return { message: choice.message, finishReason: choice.finish_reason, usage, model: res.model ?? req.model };
    } catch (err) {
      const message = describeError(err);
      await this.observer?.({
        purpose: req.purpose,
        model: req.model,
        usage: { inputTokens: 0, outputTokens: 0 },
        durationMs: Date.now() - started,
        error: message,
      });
      if (err instanceof ModelError) throw err;
      throw new ModelError(message);
    }
  }
}

function correctionPrompt(issues: string[]): string {
  return `Your previous response did not match the required schema:\n- ${issues.join("\n- ")}\nReturn the corrected JSON only.`;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

/** Converts SDK errors to short messages without echoing request bodies or credentials. */
function describeError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    const detail = typeof err.message === "string" ? err.message.slice(0, 300) : "";
    return `Model API error ${err.status ?? ""}: ${detail}`.trim();
  }
  if (err instanceof Error) return err.message.slice(0, 300);
  return "Unknown model error";
}
