import { expect } from "vitest";
import type { ReplacedDecision } from "@/lib/services/matches";

// Test helper: record_decision, the one call that saves a decision, a lookup's or the user's (record in matches.ts,
// supabase/migrations/20261010190000_decision_store_backstop.sql), as the tests of its writers pin it, defined once for
// every one of them: the decision a re-pin hands the store to replace, the call's 16 arguments, which PostgREST finds
// the function by, the three that name the decision it expects to replace, and a lookup's call as the steps' tests pin
// it.

/**
 * The decision a re-pin replaces, as the guardian hands it to the store (recordDecision's `replaces`): a match of the
 * item `shopItemId`, with who decided it, as read.
 */
export function overMatch(shopItemId: string, decidedBy: "auto" | "user"): ReplacedDecision {
  return { state: "matched", shopItemId, decidedBy };
}

/** The user's decline, as a re-pin replaces it. */
export const OVER_DECLINE: ReplacedDecision = { state: "unmatched" };

/**
 * A decision's columns, as watchlist_matches holds them (stored-rows.ts): what was decided, by whom, and its item's
 * columns, none for the user's decline or a lookup that found nothing (NO_ITEM_COLUMNS).
 */
export interface SavedColumns {
  state: "matched" | "unmatched" | "not_found";
  decided_by: "auto" | "user";
  shop_item_id: string | null;
  name: string | null;
  brand: string | null;
  size_text: string | null;
  size_value: number | null;
  size_unit: string | null;
  eans: string[];
  product_url: string | null;
  image_url: string | null;
}

/** The three arguments that name the decision a call expects to replace. */
export interface ExpectedArgs {
  p_replaces_state: "matched" | "unmatched" | null;
  p_replaces_item: string | null;
  p_replaces_decided_by: "auto" | "user" | null;
}

/** A call that expects no decision, which also stands for a lookup that found nothing: three nulls. */
export const EXPECTS_NONE: ExpectedArgs = {
  p_replaces_state: null,
  p_replaces_item: null,
  p_replaces_decided_by: null,
};

/** A call that expects the user's decline: its state, and no item or decider. */
export const EXPECTS_DECLINE: ExpectedArgs = {
  p_replaces_state: "unmatched",
  p_replaces_item: null,
  p_replaces_decided_by: null,
};

/** A call that expects a match of the item `shopItemId`, decided by `decidedBy`. */
export function expectsMatch(shopItemId: string, decidedBy: "auto" | "user"): ExpectedArgs {
  return { p_replaces_state: "matched", p_replaces_item: shopItemId, p_replaces_decided_by: decidedBy };
}

/**
 * record_decision's 16 arguments for a decision of the user's product `itemId` in `shop`: the decision's columns, and
 * the three that name the decision it expects to replace, none unless said otherwise. Every key is there, as its value
 * or null, never undefined.
 */
export function recordDecisionArgs(
  itemId: string,
  shop: string,
  columns: SavedColumns,
  expects: ExpectedArgs = EXPECTS_NONE,
): Record<string, unknown> {
  return {
    p_item: itemId,
    p_shop: shop,
    p_state: columns.state,
    p_decided_by: columns.decided_by,
    p_shop_item_id: columns.shop_item_id,
    p_name: columns.name,
    p_brand: columns.brand,
    p_size_text: columns.size_text,
    p_size_value: columns.size_value,
    p_size_unit: columns.size_unit,
    p_eans: columns.eans,
    p_product_url: columns.product_url,
    p_image_url: columns.image_url,
    ...expects,
  };
}

/**
 * A lookup's one call, as the steps' tests pin it: what the matching rule settled on its own for the user's product
 * `itemId` in `shop`, an automatic match of the item `shopItemId` or, without one, "not found", decided by the rule
 * (`auto`) and expecting no decision, which also stands for the lookup that found nothing a retry replaces. `more` pins
 * more of its arguments, such as the item's size; the item's other columns are the store's to pin (matches.test.ts).
 */
export function lookupCallArgs(
  itemId: string,
  shop: string,
  shopItemId: string | null,
  more: Record<string, unknown> = {},
): unknown {
  return expect.objectContaining({
    p_item: itemId,
    p_shop: shop,
    p_state: shopItemId === null ? "not_found" : "matched",
    p_decided_by: "auto",
    p_shop_item_id: shopItemId,
    ...EXPECTS_NONE,
    ...more,
  });
}
