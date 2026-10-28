import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSessionUser } from "@/lib/auth/current";
import { authMode } from "@/lib/config/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user} stub={authMode() === "stub"}>
      {children}
    </AppShell>
  );
}
