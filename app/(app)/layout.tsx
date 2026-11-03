import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { DEMO_USER, getSessionUser } from "@/lib/auth/current";
import { authMode } from "@/lib/config/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // The "demo" badge marks the demo account, not the server's sign-in mode.
  return (
    <AppShell user={user} stub={authMode() === "stub" && user.login === DEMO_USER.login}>
      {children}
    </AppShell>
  );
}
