import { GithubIcon } from "@/components/shared/github-icon";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { getSessionUser, safeNext } from "@/lib/auth/current";
import { authMode, env } from "@/lib/config/env";

const ERRORS: Record<string, string> = {
  github_not_configured: "GitHub sign-in isn't configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
  invalid_state: "The sign-in link expired. Please try again.",
  github_denied: "GitHub sign-in was cancelled or denied.",
  github_profile_failed: "Couldn't read your GitHub profile.",
  github_failed: "GitHub sign-in failed. Please try again.",
  not_signed_in: "Sign in first, then connect GitHub.",
};

// GitHub is the way in; the first sign-in creates the account.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  if (await getSessionUser()) redirect(next);
  const stub = authMode() === "stub";
  const githubReady = Boolean(env().GITHUB_OAUTH_CLIENT_ID);

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-[380px] flex-col gap-5">
        <Logo />
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="space-y-1 border-b px-6 py-5">
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">Use your GitHub account. The first sign-in creates your account.</p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <Button asChild className="h-11 w-full" aria-disabled={!githubReady}>
              <a href={`/api/auth/github?next=${encodeURIComponent(next)}`}>
                <GithubIcon />
                Continue with GitHub
              </a>
            </Button>
            {!githubReady && <p className="text-xs text-muted-foreground">GitHub OAuth isn&apos;t configured on this server yet.</p>}
            {stub && (
              <>
                <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> development <span className="h-px flex-1 bg-border" />
                </div>
                <form action="/api/auth/stub" method="post">
                  <input type="hidden" name="next" value={next} />
                  <Button type="submit" variant="outline" className="h-11 w-full">
                    Continue with demo account
                  </Button>
                </form>
              </>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {ERRORS[error] ?? "Sign-in failed."}
              </p>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">GitFill reads repositories as you, with read-only access to the public and private repositories your GitHub account can see. Your token is stored encrypted and can be disconnected at any time.</p>
      </div>
    </div>
  );
}
