"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, FolderGit2, MessageSquare, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

/** Workspace title with Chat / Repositories / Documents / Presentations tabs. */
export function WorkspaceHeader({ id, name, description, actions }: { id: string; name: string; description?: string | null; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const base = `/workspaces/${id}`;
  const tabs = [
    { href: base, label: "Chat", icon: MessageSquare },
    { href: `${base}/repositories`, label: "Repositories", icon: FolderGit2 },
    { href: `${base}/documents`, label: "Documents", icon: BookOpen },
    { href: `${base}/presentations`, label: "Presentations", icon: Presentation },
  ];
  return (
    <div className="border-b">
      <div className="flex items-start justify-between gap-4 pt-1">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
          {description && <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <nav className="-mb-px mt-3 flex gap-1" aria-label="Workspace sections">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
