import "dotenv/config";
import { env } from "@/lib/config/env";
import { localStore } from "@/lib/repo-store";
import { createRepoService } from "@/lib/repo-store/service";

/**
 * Runs repository storage as its own service (in the cloud: a separate Cloud Run service with the
 * archive cache in Cloud Storage). Point the app at it with REPO_SERVICE_URL (+ REPO_SERVICE_TOKEN).
 *   npm run repo-service
 */
const e = env();
if (e.NODE_ENV === "production" && !e.REPO_SERVICE_TOKEN) throw new Error("REPO_SERVICE_TOKEN is required in production.");
const port = Number(process.env.PORT ?? e.REPO_SERVICE_PORT);
createRepoService(localStore(), { token: e.REPO_SERVICE_TOKEN }).listen(port, () => {
  console.log(`repo service listening on :${port} (archive cache: ${e.REPO_ARCHIVE_CACHE ?? "none"})`);
});
