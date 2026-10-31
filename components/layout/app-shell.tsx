"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/client/types";
import { AppSidebar } from "./app-sidebar";
import { ResizeHandle, usePanelOpen, usePanelWidth } from "./resizable";
import { PageHeader, ShellProvider } from "./shell-context";
import { UserProvider } from "./user-context";

const SIDEBAR = { initial: 264, min: 208, max: 440 };

/**
 * App frame: one resizable, collapsible sidebar (sessions grouped by workspace) and the main area.
 * Chat pages (a workspace's new-session screen and its sessions) fill the viewport and render their
 * own header; every other page scrolls in a centered column under a slim header.
 */
export function AppShell({ user, stub, children }: { user: SessionUser; stub: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, toggleSidebar] = usePanelOpen("gitfill.sidebar.open", true);
  const sidebar = usePanelWidth("gitfill.sidebar.width", SIDEBAR.initial, SIDEBAR.min, SIDEBAR.max);
  const fullBleed = /^\/workspaces\/[^/]+(\/sessions\/[^/]+)?$/.test(pathname);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <UserProvider value={user}>
      <TooltipProvider delayDuration={200}>
        <ShellProvider value={{ sidebarOpen, toggleSidebar: () => toggleSidebar(), openMobile: () => setMobileOpen(true) }}>
          <div className="flex h-svh overflow-hidden bg-background">
            {sidebarOpen && (
              <aside className="relative hidden h-full shrink-0 border-r lg:block" style={{ width: sidebar.width }}>
                <AppSidebar user={user} stub={stub} onCollapse={() => toggleSidebar(false)} />
                <ResizeHandle edge="right" label="Resize sidebar" width={sidebar.width} onResize={sidebar.set} onCommit={sidebar.commit} onReset={sidebar.reset} />
              </aside>
            )}
            {mobileOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
                <aside className="fixed inset-y-0 left-0 z-50 h-full w-72 max-w-[85vw] border-r lg:hidden">
                  <AppSidebar user={user} stub={stub} />
                </aside>
              </>
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {fullBleed ? (
                <main className="flex min-h-0 flex-1 flex-col">{children}</main>
              ) : (
                <>
                  {/* Only needed for the sidebar toggle: on mobile, or on desktop while the sidebar is hidden. */}
                  <PageHeader className={sidebarOpen ? "lg:hidden" : undefined} />
                  <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-7xl">{children}</div>
                  </main>
                </>
              )}
            </div>
          </div>
        </ShellProvider>
      </TooltipProvider>
    </UserProvider>
  );
}
