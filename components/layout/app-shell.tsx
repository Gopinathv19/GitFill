"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/client/types";
import { PrimarySidebar } from "./primary-sidebar";
import { SecondarySidebar } from "./secondary-sidebar";
import { Topbar } from "./topbar";
import { UserProvider } from "./user-context";

/** SysOne-style shell: icon rail + contextual workspaces panel + topbar. */
export function AppShell({ user, stub, children }: { user: SessionUser; stub: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const showWorkspaces = pathname.startsWith("/workspaces");
  // A workspace's chat fills the viewport; other pages scroll in a centered column.
  const fullBleed = /^\/workspaces\/[^/]+$/.test(pathname);

  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebars = (
    <>
      <PrimarySidebar user={user} />
      {showWorkspaces && <SecondarySidebar />}
    </>
  );

  return (
    <UserProvider value={user}>
    <TooltipProvider delayDuration={200}>
      <div className="flex h-svh overflow-hidden bg-background">
        <div className="hidden h-full shrink-0 lg:flex">{sidebars}</div>
        {mobileOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
            <div className="fixed inset-y-0 left-0 z-50 flex h-full lg:hidden">{sidebars}</div>
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar user={user} stub={stub} onOpenMobile={() => setMobileOpen(true)} />
          {fullBleed ? (
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          ) : (
            <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-7xl">{children}</div>
            </main>
          )}
        </div>
      </div>
    </TooltipProvider>
    </UserProvider>
  );
}
