"use client";

import Link from "next/link";
import { LogOut, Menu, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SessionUser } from "@/lib/client/types";
import { getInitials } from "@/lib/utils";

export function Topbar({ user, onOpenMobile, stub }: { user: SessionUser; onOpenMobile: () => void; stub: boolean }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMobile} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>
      <div className="flex-1" />
      {stub && (
        <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 sm:inline dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
          Demo sign-in
        </span>
      )}
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="User menu">
            <Avatar className="size-8">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white">{getInitials(user.name ?? user.login)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-semibold">{user.name ?? user.login}</p>
            <p className="truncate text-xs text-muted-foreground">@{user.login}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <form action="/api/auth/logout" method="post">
            <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
              <button type="submit" className="w-full">
                <LogOut />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
