"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Option = { value: string; label: React.ReactNode; disabled?: boolean };

/** `<option>` children (also inside arrays and fragments) as plain options. */
function readOptions(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean };
    if (child.type === React.Fragment) out.push(...readOptions(props.children));
    else if (child.type === "option") out.push({ value: String(props.value ?? ""), label: props.children, disabled: props.disabled });
  });
  return out;
}

/**
 * A themed select. The browser draws a native `<select>` menu itself (blue highlight, OS fonts), so
 * this renders the same API — `<option>` children, value/defaultValue, onChange with
 * `e.target.value`, name for forms — as a GitFill menu. A hidden input carries the value into forms.
 */
export const Select = React.forwardRef<HTMLButtonElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { children, value, defaultValue, onChange, name, id, disabled, className, "aria-label": ariaLabel },
  ref,
) {
  const options = readOptions(children);
  const [inner, setInner] = React.useState(() => String(defaultValue ?? options[0]?.value ?? ""));
  const current = value !== undefined ? String(value) : inner;
  const selected = options.find((o) => o.value === current);

  const pick = (next: string) => {
    if (value === undefined) setInner(next);
    // Callers only read e.target.value, as with a native select.
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          ref={ref}
          id={id}
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-foreground/25",
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? <span className="text-muted-foreground">Choose…</span>}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} disabled={o.disabled} onSelect={() => pick(o.value)} className={cn("pr-8", o.value === current && "font-medium")}>
            <span className="truncate">{o.label}</span>
            {o.value === current && <Check className="absolute right-2 size-4 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </DropdownMenu>
  );
});
