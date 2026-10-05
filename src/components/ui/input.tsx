// shadcn/ui Input, copied on 2026-10-04 from https://ui.shadcn.com/r/styles/new-york-v4/input.json. The registry
// imports `cn` from the `cn` package; here it comes from @/lib/utils, which the project already has. Changed from the
// registry, to the "Etykiety i naklejki" handoff (context/archive/2026-09-30-etykiety-redesign/handoff/README.md) and
// the search field it draws (src/components/shell/SearchForm.astro):
// - 52 px tall (h-13) instead of h-9, radius 16 (rounded-search) instead of rounded-md, a 2 px border-input instead of
//   border, px-3.5 instead of px-3, and a card fill (bg-card) in both themes instead of bg-transparent and
//   dark:bg-input/30.
// - No focus ring of its own (outline-none, focus-visible:border-ring, focus-visible:ring-[3px] and
//   focus-visible:ring-ring/50, and the aria-invalid ring colours): the 2 px outline in global.css's base layer shows
//   instead. No shadow-xs.
// - text-base at every width, without md:text-sm: a phone's browser zooms in on a focused field whose text is smaller
//   than 16 px.
import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input bg-card rounded-search selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground h-13 w-full min-w-0 border-2 px-3.5 py-1 text-base transition-[color,box-shadow] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
