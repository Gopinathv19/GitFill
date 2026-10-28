import { sql } from "drizzle-orm";
import { env, inlineWorkerEnabled, memoraConfigured } from "@/lib/config/env";
import { MemoraClient } from "@/lib/memora/client";
import { getDb } from "@/lib/db";
import { ok } from "@/lib/http";

/** GET /api/health — reports which dependencies are configured and reachable (no secrets). */
export async function GET() {
  const e = env();
  let database: "ok" | "unconfigured" | "unreachable" = "unconfigured";
  if (e.DATABASE_URL) {
    try {
      await getDb().execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }
  let memora: "ok" | "unconfigured" | "unreachable" = "unconfigured";
  if (memoraConfigured()) {
    try {
      await MemoraClient.fromEnv()!.whoami();
      memora = "ok";
    } catch {
      memora = "unreachable";
    }
  }
  return ok({ database, modelApiKey: Boolean(e.MODEL_API_KEY), githubToken: Boolean(e.GITHUB_TOKEN), contributorTier: e.MUSE_USE_CONTRIBUTOR === "true", memora, inlineWorker: inlineWorkerEnabled() });
}
