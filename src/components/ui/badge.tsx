// shadcn/ui Badge, copied on 2026-09-29 from https://ui.shadcn.com/r/styles/new-york-v4/badge.json. The registry
// imports `cn` from the `cn` package and `Slot` from `radix-ui` (as `Slot.Root`); here they come from @/lib/utils and
// @radix-ui/react-slot, which the project already has. Changed from the registry, to the "Etykiety i naklejki" handoff
// (context/changes/etykiety-redesign/handoff/README.md):
// - The base has no focus ring of its own (focus-visible:border-ring, focus-visible:ring-[3px] and
//   focus-visible:ring-ring/50, and the aria-invalid ring colours): the 2 px outline in global.css's base layer shows
//   instead.
// - destructive reads text-destructive-foreground, not text-white, and has no dark:bg-destructive/60 or focus-ring
//   colours.
// - link reads text-link instead of text-primary.
// - Added: the success and warning variants, tinted status pills; promo, the handoff's success pill; and tag-sun and
//   tag-warn, the hanging tags on a shop's card.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

// A tag hanging off a shop's card: a label of the paper kind, with a 2 px ink edge, tilted −3° and punched with a 9 px
// hole that shows the page's paper. Its card places it.
const HANGING_TAG =
  "-rotate-3 gap-1.75 rounded-tag border-2 border-label-ink py-1.25 pr-3 pl-2 font-extrabold tracking-tag text-label-ink uppercase before:size-2.25 before:shrink-0 before:rounded-full before:border-2 before:border-label-ink before:bg-background";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90",
        outline: "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-link underline-offset-4 [a&]:hover:underline",
        // scripts/check-token-contrast.mjs mirrors the fills and opacities below: change it with them.
        // Tinted status pills, read from the success and warning tokens.
        success: "bg-success/15 text-success-foreground [a&]:hover:bg-success/25",
        warning: "bg-warning/15 text-warning-foreground [a&]:hover:bg-warning/25",
        // The promotion's pill, "promocja do 05.10": 12 px 700 on the success token, 3 × 10 px with the base's border.
        promo: "bg-success px-2.25 font-bold text-success-foreground",
        // "Najtaniej" and "Nieaktualna" on a shop's card.
        "tag-sun": `${HANGING_TAG} bg-sun`,
        "tag-warn": `${HANGING_TAG} bg-tag-warn`,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
