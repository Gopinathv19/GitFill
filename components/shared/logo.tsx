import { useId } from "react";
import { cn } from "@/lib/utils";

/** GitFill's mark (the same artwork as app/icon.svg): a branch on the emerald → teal tile. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#059669" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="115" fill={`url(#${id}g)`} />
      <g fill="none" stroke="#fff" strokeLinecap="round">
        <line x1="196" y1="180" x2="196" y2="332" strokeWidth="30" />
        <path d="M 316 220 C 316 300 196 262 196 322" strokeWidth="30" />
        <circle cx="196" cy="150" r="32" strokeWidth="28" />
        <circle cx="196" cy="362" r="32" fill="#fff" strokeWidth="28" />
        <circle cx="316" cy="190" r="32" strokeWidth="28" />
      </g>
    </svg>
  );
}

export function Logo({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {!iconOnly && <span className="font-display text-xl font-medium tracking-tight text-foreground">GitFill</span>}
    </div>
  );
}
