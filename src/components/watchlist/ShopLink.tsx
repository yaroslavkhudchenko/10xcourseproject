import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  /** The item's page in the shop. */
  href: string;
  /**
   * The id of the element naming what the link leads to, such as its shop or its item: every such link reads the same
   * words, so this tells them apart.
   */
  describedBy: string;
  className?: string;
}

// The one "Zobacz w sklepie" link to a shop's page, for a price row, a Natura candidate and a match not saved yet. It
// opens the page in a new tab, says so to screen readers, and hands the shop neither this page nor its address. It
// keeps no state and runs no effect, so it renders the same in the island and as static HTML in an .astro file.
export default function ShopLink({ href, describedBy, className }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-describedby={describedBy}
      className={cn(buttonVariants({ variant: "underlined", size: "inline" }), className)}
    >
      Zobacz w sklepie<span className="sr-only"> (otwiera się w nowej karcie)</span>
    </a>
  );
}
