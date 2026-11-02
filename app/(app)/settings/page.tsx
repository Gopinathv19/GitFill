import { AccountCard } from "@/components/settings/account-card";
import { PageHeader } from "@/components/shared/page-header";
import { requireUser } from "@/lib/auth/current";
import { env } from "@/lib/config/env";

export default async function SettingsPage() {
  const user = await requireUser();
  const e = env();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <AccountCard user={user} oauthConfigured={Boolean(e.GITHUB_OAUTH_CLIENT_ID && e.GITHUB_OAUTH_CLIENT_SECRET)} />
    </div>
  );
}
