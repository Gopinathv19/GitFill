import { cn } from "@/lib/utils";

export function Logo({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm" aria-hidden>
        G
      </span>
      {!iconOnly && <span className="text-base font-semibold tracking-tight text-foreground">GitFill</span>}
    </div>
  );
}
