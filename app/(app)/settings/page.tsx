import { AccountCard } from "@/components/settings/account-card";
import { ConfigurationForm } from "@/components/settings/configuration-form";
import { PageHeader } from "@/components/shared/page-header";
import { requireUser } from "@/lib/auth/current";
import { env } from "@/lib/config/env";

export const metadata = { title: "Configuration · GitFill" };

/** Configuration: how GitFill's agent works for this user, then the GitHub account it reads repositories as. */
export default async function SettingsPage() {
  const user = await requireUser();
  const e = env();
  return (
    <div className="space-y-6">
      <PageHeader title="Configuration" description="How GitFill replies, how much it asks before starting work, your presentation defaults and what it remembers about you." />
      <ConfigurationForm />
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">GitHub account</h2>
        <AccountCard user={user} oauthConfigured={Boolean(e.GITHUB_OAUTH_CLIENT_ID && e.GITHUB_OAUTH_CLIENT_SECRET)} />
      </div>
    </div>
  );
}
