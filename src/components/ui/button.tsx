// shadcn/ui Button, as the 10x-astro-starter shipped it from https://ui.shadcn.com/r/styles/new-york-v4/button.json.
// That copy is older than the registry's current one, which differs in its imports (`cn` from the `cn` package, `Slot`
// from `radix-ui`), its shadows and sizes, and its data-variant and data-size attributes; this one imports them from
// @/lib/utils and @radix-ui/react-slot. Changed from that copy, to the "Etykiety i naklejki" handoff
// (context/changes/etykiety-redesign/handoff/README.md):
// - The base has no focus ring of its own (outline-none, focus-visible:border-ring, focus-visible:ring-[3px] and
//   focus-visible:ring-ring/50, and the aria-invalid ring colours): the 2 px outline in global.css's base layer
//   shows instead. Its transition-all becomes Tailwind's transition, which leaves the outline's width and offset
//   out, so the outline shows at once, and it stops under reduced motion. It reads font-bold, not font-medium. Its
//   rounded-md goes to each variant: radius 14 for default, 12 (rounded-button-sm) for the other buttons, and
//   rounded-sm for the two links, which shapes their focus outline.
// - No variant has shadow-xs.
// - default has a 2 px label-ink border, radius 14 (rounded-button) and the hard primary shadow, which it drops as it
//   moves 2 px while pressed.
// - destructive reads text-destructive-foreground, not text-white, and has no dark:bg-destructive/60 or focus-ring
//   colours.
// - outline is a card fill with a 1.5 px border (border-hairline) and text-foreground, in both themes: no
//   bg-background or dark: input fills.
// - link reads text-link instead of text-primary.
// - Added: the underlined variant, a link with a 3 px sun underline 5 px below it; the touch and inline sizes, at least
//   44 px tall; and the compact size, 38 px tall, and the icon size, now a 42 px circle instead of size-9. They, and the
//   registry's default, sm and lg sizes, add a 44 px hit area (hit-area in global.css).
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-bold whitespace-nowrap transition motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // scripts/check-token-contrast.mjs mirrors the fills and opacities below: change it with them.
        default:
          "rounded-button border-2 border-label-ink bg-primary text-primary-foreground shadow-primary hover:bg-primary/90 active:translate-0.5 active:shadow-none",
        destructive: "rounded-button-sm bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "rounded-button-sm border-hairline bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "rounded-button-sm bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "rounded-button-sm hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "rounded-sm text-link underline-offset-4 hover:underline",
        // A link that is always underlined, like "Zobacz w sklepie": the sun's line thickens on hover.
        underlined: "rounded-sm text-link underline decoration-sun decoration-3 underline-offset-5 hover:decoration-4",
      },
      size: {
        // The registry's three sizes, each below 44 px, so each gets the hit area too: every control is 44 px to tap.
        default: "hit-area h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "hit-area h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "hit-area h-10 px-6 has-[>svg]:px-4",
        // A 42 px circle, like the theme switch, with a 44 px hit area around it.
        icon: "hit-area size-10.5 rounded-full",
        // 38 px, like the list's "Odśwież ceny" and "Wyloguj", with a 44 px hit area around it.
        compact: "hit-area h-9.5 gap-1.5 px-3 text-compact has-[>svg]:px-2.5",
        // At least 44 px tall, the tap target of a phone held at the shelf.
        touch: "min-h-11 px-4 py-2 has-[>svg]:px-3",
        // A text link flush with the text beside it, with the same 44 px tap target.
        inline: "min-h-11 px-0 py-2 has-[>svg]:px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
