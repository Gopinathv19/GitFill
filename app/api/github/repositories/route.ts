import { requireUser } from "@/lib/auth/current";
import { getGitHubConnection, githubClientFor } from "@/lib/auth/github-token";
import { getDb } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/http";

/** GET /api/github/repositories?query= — repositories the signed-in user's GitHub account can access. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const db = getDb();
    const connection = await getGitHubConnection(db, user.id);
    if (!connection.connected) return fail(409, "github_not_connected", "Connect your GitHub account to list your repositories.");
    const query = (new URL(req.url).searchParams.get("query") ?? "").trim().toLowerCase();
    const client = await githubClientFor(db, user.id);
    const [page1, page2] = await Promise.all([client.listUserRepos({ page: 1 }), client.listUserRepos({ page: 2 }).catch(() => [])]);
    const repos = [...page1, ...page2].filter((r) => !query || r.fullName.toLowerCase().includes(query) || (r.description ?? "").toLowerCase().includes(query));
    return ok({ connection, repositories: repos.slice(0, 200) });
  } catch (err) {
    return handleError(err);
  }
}
