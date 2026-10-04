import { useId, type ReactElement } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  NaturaCardAction,
  NaturaCardAlert,
  NaturaCardLink,
  NaturaCard as NaturaCardModel,
} from "@/components/watchlist/natura-card";
import type { ComparedRow } from "@/components/watchlist/price-comparison-state";
import ProductThumb from "@/components/watchlist/ProductThumb";
import ShopCard, { SHOP_CARD, ShopHeader } from "@/components/watchlist/ShopCard";
import ShopLink from "@/components/watchlist/ShopLink";
import type { MatchItemSummary } from "@/lib/services/match-view";
import { rowProductOf } from "@/lib/services/watchlist-rows";
import { cn } from "@/lib/utils";

interface Props {
  /** What the card says of Natura, from the page's view of it (naturaCardOf), with its links. */
  card: NaturaCardModel;
  /** Natura's price row, as the comparison marks it, while the product has a saved match; null without one. */
  row: ComparedRow | null;
  /** The time the price's age is read at, in milliseconds. */
  now: number;
}

// A line a card without a price says in its place, as the handoff draws a gap: 14 px, and 15 px from lg.
const LINE = "text-sm leading-normal lg:text-body";

// A stored decision's action, "Zmień", "Dopasuj ponownie" or "Anuluj", as the handoff draws "Zmień": a small outline
// button with the ink's 1.5 px edge over the card's own fill, 36 px tall on a phone and 34 px from lg, at its row's end,
// with the compact size's 44 px hit area around it.
const ACTION = "ml-auto h-9 shrink-0 border-foreground bg-transparent lg:h-8.5";

// Natura's card among the shops' cards, so each shop appears once on the page. A saved match is Natura's price card,
// with a footer under a dashed line: the matched item's brand and size above its name, how the match was decided, with
// "Zmień" beside it, and a warning for each thing that differs from the product, its size or its brand. Without one,
// the card has no price and says where Natura stands instead: not matched yet, with the link that looks the product
// up; found nothing, with the link that looks again; declined, as a dashed ghost on the paper, with "Dopasuj ponownie"
// in its footer; a decision another tab saved meanwhile, with the link that shows it; Natura busy or a decision that
// couldn't be read, in the warning colour, as a price that couldn't be read; or candidates to choose from, which the
// section below the cards holds with their forms. "Zmień" and "Dopasuj ponownie" open the choice of Natura's
// candidates below the cards; while it's open, the card says so and offers "Anuluj" instead. A match the page couldn't
// save has no price row, so its item, with its photo and its page, stands in the price's place, and it has no action
// yet. The notices of a decision just made, and a lookup's outcome that couldn't be stored, close the card. Every
// action here is a plain link, which works without JavaScript; the decisions themselves are the section's forms. It
// keeps no state, so it renders the same in the island and in the kitchen sink.
export default function NaturaCard({ card, row, now }: Props) {
  const nameId = useId();
  const body = <NaturaBody card={card} />;
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
function NaturaBody({ card }: { card: NaturaCardModel }) {
  return (
    <>
      <NaturaState card={card} />
      {card.alerts.map((alert) => (
        <NaturaAlert key={alert.tone} alert={alert} />
      ))}
    </>
  );
}

/** Where Natura stands, by the card's kind. A kind this misses fails to compile instead of rendering nothing. */
function NaturaState({ card }: { card: NaturaCardModel }): ReactElement {
  switch (card.kind) {
    case "matched":
      return (
        <MatchFooter
          note={card.note}
          warnings={card.warnings}
          item={card.item}
          unsaved={card.unsaved}
          action={card.action}
        />
      );
    case "unmatched":
      return (
        <>
          <p className={cn(LINE, "text-muted-foreground")}>{card.text}</p>
          <DeclineFooter action={card.action} />
        </>
      );
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
            href={card.link.href}
            className={cn(buttonVariants({ variant: "underlined", size: "inline" }), "self-start")}
          >
            {card.link.label}
          </a>
        </>
      );
    case "unavailable":
    case "read-failed":
      return <p className={cn(LINE, "text-warning-foreground")}>{card.text}</p>;
    case "choose":
      return <p className={cn(LINE, "text-muted-foreground")}>{card.text}</p>;
  }
}

/**
 * A match's footer, under a dashed line at the card's foot: the matched item's brand and size above its name, how the
 * match was decided, in DM Mono, with its action beside it, as the handoff draws "Zmień", and a warning pill for each
 * thing that differs from the product, its size, then its brand; while the choice is open below the cards, the line
 * that points there closes it. The price card above it has the item's page, so the footer has no second "Zobacz w
 * sklepie" and no photo. While the match isn't saved, it has no price, so its item, with its photo and its page, stands
 * above the footer, where the price would, and it has no action yet.
 */
function MatchFooter({
  note,
  warnings,
  item,
  unsaved,
  action,
}: {
  note: string;
  warnings: string[];
  item: MatchItemSummary;
  unsaved: boolean;
  action: NaturaCardAction | null;
}) {
  const hint = action?.hint ?? null;
  return (
    <>
      {unsaved && <MatchedItem item={item} />}
      <div className="border-t-hairline mt-auto flex flex-col items-start gap-2 border-dashed pt-2.5 lg:pt-3">
        {!unsaved && <ItemText item={item} />}
        <div className="flex w-full items-center gap-2.5">
          <p className="text-micro text-muted-foreground lg:text-meta min-w-0 font-mono">{note}</p>
          {action && <ActionLink link={action.link} />}
        </div>
        {warnings.map((warning) => (
          <Badge key={warning} variant="warning" className="whitespace-normal">
            {warning}
          </Badge>
        ))}
        {hint !== null && <p className={cn(LINE, "text-muted-foreground")}>{hint}</p>}
      </div>
    </>
  );
}

/**
 * The footer of the user's decline, under a dashed line, as the handoff draws its ghost card: "Dopasuj ponownie" at
 * its end, and, while the choice is open below the cards, the line that points there beside "Anuluj".
 */
function DeclineFooter({ action }: { action: NaturaCardAction }) {
  return (
    <div className="border-t-hairline mt-auto flex items-center gap-2.5 border-dashed pt-2.5 lg:pt-3">
      {action.hint !== null && <p className={cn(LINE, "text-muted-foreground min-w-0")}>{action.hint}</p>}
      <ActionLink link={action.link} />
    </div>
  );
}

/** A stored decision's action: a plain link to the product's page, which opens or closes the choice. */
function ActionLink({ link }: { link: NaturaCardLink }) {
  return (
    <a href={link.href} className={cn(buttonVariants({ variant: "outline", size: "compact" }), ACTION)}>
      {link.label}
    </a>
  );
}

/**
 * The item of a match the page couldn't save, which has no price row: its thumbnail, its brand and size above its
 * name, as a list row draws a product, and its page in the shop.
 */
function MatchedItem({ item }: { item: MatchItemSummary }) {
  // The item's name describes its "Zobacz w sklepie"; the id is this item's own.
  const textId = useId();
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
        <ProductThumb brand={item.brand} imageUrl={item.imageUrl} size="row" />
        <ItemText item={item} id={textId} />
      </div>
      {item.productUrl && <ShopLink href={item.productUrl} describedBy={textId} />}
    </div>
  );
}

/** A matched item's brand and size above its name, as a list row draws a product (rowProductOf). */
function ItemText({ item, id }: { item: MatchItemSummary; id?: string }) {
  const { eyebrow, name } = rowProductOf({ ...item, caption: null });
  return (
    <p id={id} className="flex min-w-0 flex-col gap-0.75">
      {eyebrow && (
        <span className="text-meta tracking-eyebrow text-muted-foreground font-mono wrap-break-word uppercase">
          {eyebrow}
        </span>
      )}
      <span className="text-body leading-tight font-semibold wrap-break-word">{name}</span>
    </p>
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
