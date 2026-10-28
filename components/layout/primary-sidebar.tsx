"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, FolderGit2, Presentation, Settings } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionUser } from "@/lib/client/types";
import { cn, getInitials } from "@/lib/utils";

const NAV = [
  { href: "/workspaces", icon: FolderGit2, label: "Workspaces" },
  { href: "/documents", icon: BookOpen, label: "Documents" },
  { href: "/presentations", icon: Presentation, label: "Presentations" },
  { href: "/activity", icon: Activity, label: "Activity" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

/** Narrow icon rail (~56px), as in SysOne. */
export function PrimarySidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) || (href === "/presentations" && pathname.startsWith("/jobs"));

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center border-r bg-sidebar py-2">
      <Link href="/workspaces" className="mb-2 flex h-12 w-full items-center justify-center border-b" aria-label="GitFill home">
        <Logo iconOnly />
      </Link>
      <nav className="flex w-full flex-1 flex-col items-center gap-1 px-1.5 py-2">
        {NAV.map(({ href, icon: Icon, label }) => (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <Link
                href={href}
                aria-label={label}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  active(href) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/settings" className="mb-2 rounded-full" aria-label="Account">
            <Avatar className="size-8">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white">{getInitials(user.name ?? user.login)}</AvatarFallback>
            </Avatar>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {user.name ?? user.login}
        </TooltipContent>
      </Tooltip>
    </aside>
  );
}
