import RefreshForm from "@/components/watchlist/RefreshForm";

interface Props {
  /** The watched product's id, which the bar's "Odśwież ceny" posts. */
  itemId: string;
  /** How old the prices' oldest check is (checkedAge), or null when no shop was checked. */
  age: string | null;
  /** When the prices were checked, as the title row says it (checkedCaption), for a product never checked. */
  caption: string;
  /** Some shop's refetch runs, so "Odśwież ceny" waits. */
  refreshing: boolean;
  onRefresh?: () => void;
}

// A phone's bar along the bottom of the screen, in the thumb's reach: when the prices were checked, on two lines, and
// "Odśwież ceny", the same form as the title row's, which a phone doesn't show. It keeps clear of the screen's rounded
// corners and home bar (the safe-area insets), and the page leaves room below its content for it; a control the
// keyboard reaches stops above it too (data-refresh-bar, global.css). From lg the title row holds the refresh, and the
// bar is gone.
export default function RefreshBar({ itemId, age, caption, refreshing, onRefresh }: Props) {
  return (
    <div
      data-refresh-bar
      className="bg-card border-t-hairline fixed inset-x-0 bottom-0 z-10 flex items-center gap-3.5 pt-3 pr-[calc(var(--spacing)*4.5+env(safe-area-inset-right))] pb-[calc(var(--spacing)*6+env(safe-area-inset-bottom))] pl-[calc(var(--spacing)*4.5+env(safe-area-inset-left))] lg:hidden"
    >
      <p className="text-meta tracking-meta text-muted-foreground min-w-0 flex-1 font-mono leading-normal uppercase">
        {age === null ? (
          caption
        ) : (
          <>
            Sprawdzono
            <br />
            {age}
          </>
        )}
      </p>
      <RefreshForm itemId={itemId} disabled={refreshing} onRefresh={onRefresh} size="bar" className="shrink-0" />
    </div>
  );
}
