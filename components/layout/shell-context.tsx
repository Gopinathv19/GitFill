"use client";

import { createContext, useContext } from "react";
import { Menu, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Shell {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  openMobile: () => void;
}

const ShellContext = createContext<Shell>({ sidebarOpen: true, toggleSidebar: () => {}, openMobile: () => {} });
export const ShellProvider = ShellContext.Provider;
export const useShell = () => useContext(ShellContext);

/** Opens the sidebar: always on small screens, and on desktop only when it is collapsed. */
export function SidebarToggle() {
  const { sidebarOpen, toggleSidebar, openMobile } = useShell();
  return (
    <>
      <Button variant="ghost" size="icon" className="size-8 lg:hidden" onClick={openMobile} aria-label="Open navigation">
        <Menu className="size-4" />
      </Button>
      {!sidebarOpen && (
        <Button variant="ghost" size="icon" className="hidden size-8 lg:inline-flex" onClick={toggleSidebar} aria-label="Show sidebar">
          <PanelLeftOpen className="size-4" />
        </Button>
      )}
    </>
  );
}

/** Slim header row at the top of the main area, with the sidebar toggle first. */
export function PageHeader({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3", className)}>
      <SidebarToggle />
      {children}
    </header>
  );
}
