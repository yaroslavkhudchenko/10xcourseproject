import { useId, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import Price from "@/components/watchlist/Price";
import { gapText, type ComparedRow } from "@/components/watchlist/price-comparison-state";
import { SHOP_FILLS } from "@/components/watchlist/shop-fills";
import ShopLink from "@/components/watchlist/ShopLink";
import { ageText, formatDay, formatPrice, SHOP_LABELS, type PricedShop } from "@/lib/services/price-comparison";
import { PRICE_UNSAVED_TEXT, priceMissingText, priceUnavailableText } from "@/lib/shop-messages";
import { cn } from "@/lib/utils";

/**
 * Every shop's card, with a price or without one (MatchCard): its paddings and gaps, and a 2 px edge, which the card
 * colours by its state. It stretches to its row of the grid.
 */
export const SHOP_CARD = "relative h-full gap-2.5 border-2 p-4.5 lg:gap-3 lg:px-6 lg:py-5.5";

interface HeaderProps {
  shop: PricedShop;
  /** The id of the shop's name, which describes the card's links. */
  nameId: string;
  /** The shop is being asked again. */
  pending?: boolean;
}

/** A shop card's top row: the shop's dot in its colour, its name, "Odświeżam…" while it's asked again, and its site. */
export function ShopHeader({ shop, nameId, pending = false }: HeaderProps) {
  const label = SHOP_LABELS[shop];
  return (
    <div className="flex items-center gap-2.25 lg:gap-2.5">
      <span
        aria-hidden="true"
        className={cn("border-label-ink size-3.25 shrink-0 rounded-full border-2 lg:size-3.5", SHOP_FILLS[shop])}
      />
      <h3 id={nameId} className="text-shop-name lg:text-shop-name-lg font-extrabold tracking-tight">
        {label.name}
      </h3>
      {pending && (
        <span className="text-meta text-muted-foreground font-mono whitespace-nowrap uppercase">Odświeżam…</span>
      )}
      <span className="text-micro text-muted-foreground lg:text-meta ml-auto font-mono whitespace-nowrap">
        {label.site}
      </span>
    </div>
  );
}

interface Props {
  /** The shop's row, as the comparison marks it: cheapest or not, and where its price stands. */
  row: ComparedRow;
  /** The time the price's age is read at, in milliseconds. */
  now: number;
  /** What follows "Zobacz w sklepie" in the card: a matched shop's card adds how its match was decided (MatchCard). */
  children?: ReactNode;
}

// One shop's price on its card: the shop's dot, its name and the site the price comes from; the price in shelf-label
// style with the regular one it replaces, a promotion's end and whether it can't be ordered online; the shop's 30-day
// low and the price's age; why it may be out of date or missing, and, while the price is one the route couldn't store
// (`priceUnsaved`), that the list won't show it; and "Zobacz w sklepie". The cheapest card has an ink edge and a
// "Najtaniej" tag hanging off it, one out of date a warm edge and a "Nieaktualna" tag. While its shop is asked again,
// "Odświeżam…" stands by the name and the price fades. Without a price, a visible gap. It keeps no state, so it renders
// the same in the island and in the kitchen sink.
export default function ShopCard({ row, now, children }: Props) {
  // The shop's name describes the card's "Zobacz w sklepie", which every card repeats; the id is this card's own.
  const nameId = useId();
  const label = SHOP_LABELS[row.shop];
  const offer = row.latest?.offer ?? null;
  const hasPrice = offer !== null;
  // A price out of date, or one of an item the shop no longer returns: it may no longer be the shop's.
  const outOfDate = hasPrice && (row.state === "stale" || row.state === "missing");
  return (
    <Card
      className={cn(
        SHOP_CARD,
        row.cheapest ? "border-foreground" : outOfDate ? "border-tag-warn-border" : "border-border",
      )}
    >
      <ShopHeader shop={row.shop} nameId={nameId} pending={row.pending} />
      {row.cheapest ? (
        <Badge variant="tag-sun" className="absolute -top-3.75 right-4.5 lg:-top-4 lg:right-5.5">
          Najtaniej
        </Badge>
      ) : (
        outOfDate && (
          <Badge variant="tag-warn" className="absolute -top-3.75 right-4.5 lg:-top-4 lg:right-5.5">
            Nieaktualna
          </Badge>
        )
      )}
      {offer === null ? (
        <p className="text-warning-foreground lg:text-body text-sm leading-normal">{gapText(row)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 lg:gap-4">
            <Price amount={offer.price} size="card" pending={row.pending} />
            {(offer.regularPrice !== null || offer.promoEndsOn !== null || !offer.available) && (
              <div className="flex flex-col items-start gap-1.25 pb-0.5 lg:gap-1.5 lg:pb-0.75">
                {offer.regularPrice !== null && (
                  <p className="text-compact text-muted-foreground whitespace-nowrap lg:text-sm">
                    zamiast <s>{formatPrice(offer.regularPrice)}</s>
                  </p>
                )}
                {offer.promoEndsOn !== null && (
                  <Badge variant="promo">promocja do {formatDay(offer.promoEndsOn)}</Badge>
                )}
                {!offer.available && <Badge variant="warning">niedostępny online</Badge>}
              </div>
            )}
          </div>
          <div className="text-meta text-muted-foreground flex flex-col gap-0.75 font-mono lg:gap-1 lg:text-xs">
            {offer.lowestPrice30d !== null && <p>najniższa z 30 dni wg sklepu: {formatPrice(offer.lowestPrice30d)}</p>}
            <p>cena online · {ageText(offer.pricedAt, now)}</p>
          </div>
        </>
      )}
      {row.latest?.lastStatus === "missing" && (
        <p className="text-warning-foreground text-sm">{priceMissingText(hasPrice)}</p>
      )}
      {row.notice && (
        <p className="text-warning-foreground text-sm">
          {priceUnavailableText(label.name, row.notice.reason, row.notice.until, hasPrice)}
        </p>
      )}
      {row.priceUnsaved && <p className="text-warning-foreground text-sm">{PRICE_UNSAVED_TEXT}</p>}
      {row.productUrl && <ShopLink href={row.productUrl} describedBy={nameId} className="lg:text-body self-start" />}
      {children}
    </Card>
  );
}
