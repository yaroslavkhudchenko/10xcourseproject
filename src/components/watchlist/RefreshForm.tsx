import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REFRESH_FORM_ROUTE } from "@/components/watchlist/price-comparison-state";
import { cn } from "@/lib/utils";

interface Props {
  /** The watched product's id, which the form posts. */
  itemId: string;
  /** Some shop's refetch runs: one per shop at a time, since a second tap would only spend the cap again. */
  pending: boolean;
  /**
   * Refetches every shop in place of the form's post. Absent when the view is rendered without the island, as in the
   * kitchen sink: the form then posts, as it does without JavaScript.
   */
  onRefresh?: () => void;
  /** The title row's button on a desktop, or the larger one in a phone's bottom bar. */
  size: "title" | "bar";
  /** Places the form. */
  className?: string;
}

// Each size's button and icon, from the handoff: 46 px and 15 px bold in the title row, 52 px, radius 16 and 16 px
// extra bold in the bar. The touch size's padding beside an icon (has-[>svg]:px-3) is set again, or it would win.
const SIZES = {
  title: { button: "h-11.5 px-4.5 text-body has-[>svg]:px-4.5", icon: "size-4", stroke: 2.2 },
  bar: {
    button: "h-13 rounded-button-lg px-5.5 text-base font-extrabold has-[>svg]:px-5.5",
    icon: "size-4.5",
    stroke: 2.4,
  },
};

// While a refresh runs, the button looks as a disabled one does, but keeps the keyboard's focus: it's aria-disabled
// rather than disabled, which would drop the focus to the page, and the island ignores its submit meanwhile.
const PENDING = "aria-disabled:pointer-events-none aria-disabled:opacity-50";

// A product's "Odśwież ceny", which refreshes this product only: screen readers hear "Odśwież ceny tego produktu",
// since the list's own refreshes every product. Without JavaScript it posts the product's id to the refresh route, and
// the page comes back with the refreshed prices; with the island, each shop is refetched in place and its card updates
// as it answers, and a submit while a refetch runs does nothing. The title row on a desktop and a phone's bottom bar
// each hold one, and the page shows one of them at each width.
export default function RefreshForm({ itemId, pending, onRefresh, size, className }: Props) {
  const look = SIZES[size];
  return (
    <form
      method="POST"
      action={REFRESH_FORM_ROUTE}
      className={className}
      onSubmit={
        onRefresh === undefined
          ? undefined
          : (event) => {
              // With JavaScript each shop is refetched here, and its card updates as it answers, in place of the post.
              event.preventDefault();
              if (!pending) {
                onRefresh();
              }
            }
      }
    >
      <input type="hidden" name="itemId" value={itemId} />
      <Button
        type="submit"
        size="touch"
        aria-disabled={pending ? true : undefined}
        className={cn(look.button, PENDING)}
      >
        <RefreshCw aria-hidden="true" strokeWidth={look.stroke} className={look.icon} />
        Odśwież ceny<span className="sr-only"> tego produktu</span>
      </Button>
    </form>
  );
}
