import { env, requireEnv } from "@/lib/config/env";
import { modelFor } from "./models";
import { ModelError, type ModelCallObserver } from "./client";

const ART_DIRECTION =
  "Abstract, minimal background artwork for a technical presentation slide. Dark navy background with soft blue and teal geometric light, subtle network lines. No text, no letters, no logos, no people.";

/**
 * Generates decorative artwork with Muse Image. Diagrams are never generated as images:
 * they stay native, editable shapes. Returns PNG bytes.
 */
export async function generateIllustration(prompt: string, observer?: ModelCallObserver, theme: "midnight" | "daylight" = "midnight"): Promise<Buffer> {
  const model = modelFor("illustrator");
  const direction = theme === "daylight" ? ART_DIRECTION.replace("Dark navy background", "Very light, airy background") : ART_DIRECTION;
  const started = Date.now();
  try {
    const res = await fetch(`${env().MODEL_API_BASE_URL}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("MODEL_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: `${direction} Theme: ${prompt.slice(0, 400)}`, n: 1, size: "1024x1024", response_format: "b64_json", output_format: "png" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new ModelError(`Image API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new ModelError("Image API returned no image data.");
    const png = Buffer.from(b64, "base64");
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new ModelError("Image API did not return a PNG.");
    await observer?.({ purpose: "generate_illustration", model, usage: { inputTokens: 0, outputTokens: 0 }, durationMs: Date.now() - started });
    return png;
  } catch (err) {
    const message = err instanceof Error ? err.message : "image generation failed";
    await observer?.({ purpose: "generate_illustration", model, usage: { inputTokens: 0, outputTokens: 0 }, durationMs: Date.now() - started, error: message });
    throw err instanceof ModelError ? err : new ModelError(message);
  }
}
