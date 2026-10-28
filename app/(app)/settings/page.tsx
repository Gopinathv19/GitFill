import { CheckCircle2, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current";
import { ApiTokens } from "@/components/settings/api-tokens";
import { GitHubConnectionCard } from "@/components/settings/github-connection";
import { authMode, env, inlineWorkerEnabled, memoraConfigured } from "@/lib/config/env";
import { modelFor } from "@/lib/ai/models";
import { getInitials } from "@/lib/utils";

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <CircleAlert className="size-5 text-amber-500" />}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const e = env();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your account, the VS Code extension, and how this GitFill server is configured." />
      <GitHubConnectionCard oauthConfigured={Boolean(e.GITHUB_OAUTH_CLIENT_ID && e.GITHUB_OAUTH_CLIENT_SECRET)} scopes={e.GITHUB_OAUTH_SCOPES} />
      <ApiTokens serverUrl={e.APP_BASE_URL} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>{authMode() === "stub" ? "Signed in with the development demo account." : "Signed in with GitHub."}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Avatar className="size-12">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white">{getInitials(user.name ?? user.login)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold">{user.name ?? user.login}</p>
              <p className="text-sm text-muted-foreground">@{user.login}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Server configuration</CardTitle>
            <CardDescription>Read-only. Set these in the server environment.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Row label="Meta Model API" ok={Boolean(e.MODEL_API_KEY)} detail={`Architect ${modelFor("architect")} · analyst ${modelFor("analyst")} · explainer ${modelFor("explainer")} · images ${modelFor("illustrator")}`} />
            <Row label="Database" ok={Boolean(e.DATABASE_URL)} detail={e.DATABASE_URL?.startsWith("pglite:") ? "Local PGlite (embedded)" : "PostgreSQL (Neon)"} />
            <Row label="Job worker" ok detail={inlineWorkerEnabled() ? "Jobs run inside the web process (INLINE_WORKER)" : "Separate worker process (npm run worker)"} />
            <Row label="Memora retrieval (RAG)" ok={memoraConfigured()} detail={memoraConfigured() ? `Semantic retrieval via ${e.MEMORA_BASE_URL}` : "Optional · set MEMORA_BASE_URL and MEMORA_API_TOKEN; agents fall back to search"} />
            <Row label="GitHub sign-in" ok={Boolean(e.GITHUB_OAUTH_CLIENT_ID && e.GITHUB_OAUTH_CLIENT_SECRET)} detail={`Mode: ${authMode()}`} />
            <Row label="Server GitHub token" ok={Boolean(e.GITHUB_TOKEN)} detail={e.GITHUB_TOKEN ? "Fallback for users without a connected account: 5,000 requests/hour, public repos" : "Optional fallback · 60 requests/hour for users without a connected account"} />
            <Row label="Token encryption key" ok={Boolean(e.TOKEN_ENCRYPTION_KEY || e.AUTH_SECRET)} detail={e.TOKEN_ENCRYPTION_KEY ? "TOKEN_ENCRYPTION_KEY set" : e.AUTH_SECRET ? "Derived from AUTH_SECRET" : "Development default · set TOKEN_ENCRYPTION_KEY before production"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
