import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { NaturaCardAlert, NaturaCard as NaturaCardModel } from "@/components/watchlist/natura-card";
import type { ComparedRow } from "@/components/watchlist/price-comparison-state";
import ProductThumb from "@/components/watchlist/ProductThumb";
import ShopCard, { SHOP_CARD, ShopHeader } from "@/components/watchlist/ShopCard";
import ShopLink from "@/components/watchlist/ShopLink";
import type { NaturaItemSummary } from "@/lib/services/natura-view";
import { rowProductOf } from "@/lib/services/watchlist-rows";
import { cn } from "@/lib/utils";

interface Props {
  /** What the card says of Natura, from the page's view of it (naturaCardOf). */
  card: NaturaCardModel;
  /** The watched product's id, which "Pokaż zapisaną decyzję" leads to. */
  itemId: string;
  /** Natura's price row, as the comparison marks it, while the product has a saved match; null without one. */
  row: ComparedRow | null;
  /** The time the price's age is read at, in milliseconds. */
  now: number;
}

// A line a card without a price says in its place, as the handoff draws a gap: 14 px, and 15 px from lg.
const LINE = "text-sm leading-normal lg:text-body";

// Natura's card among the shops' cards, so each shop appears once on the page. A saved match is Natura's price card,
// with a footer under a dashed line: how the match was decided and whether its size differs. Without one, the card
// has no price and says where Natura stands instead: not matched yet, with the link that looks the product up; found
// nothing, with the link that looks again; declined, as a dashed ghost on the paper; a decision another tab saved
// meanwhile, with the link that shows it; Natura busy or a decision that couldn't be read, in the warning colour, as a
// price that couldn't be read; or candidates to choose from, which the section below the cards holds with their forms.
// A match the page couldn't save has no price row, so its item stands in the price's place. The notices of a decision
// just made, and a lookup's outcome that couldn't be stored, close the card. Every action here is a plain link, which
// works without JavaScript, and none changes a stored decision: re-pinning waits for S-08. It keeps no state, so it
// renders the same in the island and in the kitchen sink.
export default function NaturaCard({ card, itemId, row, now }: Props) {
  const nameId = useId();
  const body = <NaturaBody card={card} itemId={itemId} />;
  if (row !== null) {
    return (
      <ShopCard row={row} now={now}>
        {body}
      </ShopCard>
    );
  }
  return (
    <Card
      className={cn(
        SHOP_CARD,
        "border-border",
        // The user declined Natura: a ghost of a card, dashed on the paper.
        card.kind === "unmatched" && "border-dashed bg-transparent",
      )}
    >
      <ShopHeader shop="natura" nameId={nameId} />
      {body}
    </Card>
  );
}

/** The card's own part: where Natura stands, then the alerts. */
function NaturaBody({ card, itemId }: { card: NaturaCardModel; itemId: string }) {
  return (
    <>
      <NaturaState card={card} itemId={itemId} />
      {card.alerts.map((alert) => (
        <NaturaAlert key={alert.tone} alert={alert} />
      ))}
    </>
  );
}

function NaturaState({ card, itemId }: { card: NaturaCardModel; itemId: string }) {
  switch (card.kind) {
    case "matched":
      return <MatchFooter note={card.note} sizeWarning={card.sizeWarning} item={card.item} />;
    case "prompt":
      // Full width on a phone, as the handoff draws it, and as wide as its words from lg.
      return (
        <>
          <p className={cn(LINE, "text-muted-foreground")}>{card.text}</p>
          <a href={card.link.href} className={cn(buttonVariants({ size: "touch" }), "w-full lg:w-auto lg:self-start")}>
            {card.link.label}
          </a>
        </>
      );
    case "not-found":
      return (
        <>
          <p className={cn(LINE, "text-muted-foreground")}>{card.text}</p>
          <a href={card.link.href} className={cn(buttonVariants({ variant: "outline", size: "touch" }), "self-start")}>
            {card.link.label}
          </a>
        </>
      );
    case "decided":
      return (
        <>
          <p role="status" className={cn(LINE, "text-muted-foreground")}>
            {card.text}
          </p>
          <a
            href={`/watchlist/${itemId}`}
            className={cn(buttonVariants({ variant: "underlined", size: "inline" }), "self-start")}
          >
            Pokaż zapisaną decyzję
          </a>
        </>
      );
    case "unavailable":
    case "read-failed":
      return <p className={cn(LINE, "text-warning-foreground")}>{card.text}</p>;
    case "unmatched":
    case "choose":
      return <p className={cn(LINE, "text-muted-foreground")}>{card.text}</p>;
  }
}

/**
 * A match's footer, under a dashed line at the card's foot: how the match was decided, in DM Mono, and its size flagged
 * with a warning pill when it differs. While the match isn't saved, it has no price, so its item stands above the
 * footer, where the price would.
 */
function MatchFooter({
  note,
  sizeWarning,
  item,
}: {
  note: string;
  sizeWarning: string | null;
  item: NaturaItemSummary | null;
}) {
  return (
    <>
      {item !== null && <MatchedItem item={item} />}
      <div className="border-t-hairline mt-auto flex flex-col items-start gap-2 border-dashed pt-2.5 lg:pt-3">
        <p className="text-micro text-muted-foreground lg:text-meta font-mono">{note}</p>
        {sizeWarning !== null && (
          <Badge variant="warning" className="whitespace-normal">
            {sizeWarning}
          </Badge>
        )}
      </div>
    </>
  );
}

/**
 * The item of a match the page couldn't save, which has no price row: its thumbnail, its brand and size above its
 * name, as a list row draws a product, and its page in the shop.
 */
function MatchedItem({ item }: { item: NaturaItemSummary }) {
  // The item's name describes its "Zobacz w sklepie"; the id is this item's own.
  const textId = useId();
  const { eyebrow, name, brand, imageUrl } = rowProductOf({ ...item, caption: null });
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
        <ProductThumb brand={brand} imageUrl={imageUrl} size="row" />
        <p id={textId} className="flex min-w-0 flex-col gap-0.75">
          {eyebrow && (
            <span className="text-meta tracking-eyebrow text-muted-foreground font-mono wrap-break-word uppercase">
              {eyebrow}
            </span>
          )}
          <span className="text-body leading-tight font-semibold wrap-break-word">{name}</span>
        </p>
      </div>
      {item.productUrl && <ShopLink href={item.productUrl} describedBy={textId} />}
    </div>
  );
}

/** A notice in the card: a decision saved, a decision that wasn't, or a lookup's outcome that couldn't be stored. */
function NaturaAlert({ alert }: { alert: NaturaCardAlert }) {
  // A saved decision is news, told politely; the other two are problems, told at once.
  return (
    <Alert variant={alert.tone} role={alert.tone === "success" ? "status" : "alert"}>
      <AlertDescription>{alert.text}</AlertDescription>
    </Alert>
  );
}
