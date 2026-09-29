import { isJsonMediaType } from "@/lib/json-request";
import { compareShops, type Comparison, type LatestCheck, type PricedShop } from "@/lib/services/price-comparison";
import type { LatestPrice, PriceRefreshAnswer, SearchUnavailableReason, ShopOffer } from "@/types";

// The product page's price island, without React: each matched shop's latest price, whether its refetch runs, and why
// the last one gave no answer. Every change goes through the reducer, and the order and marks always come from
// compareShops, so Vitest can check them in Node. It runs in the browser, so it imports nothing server-only.

/** The route that refetches one shop of one product (src/pages/api/watchlist/prices.ts). */
export const PRICES_ROUTE = "/api/watchlist/prices";
/** The form route that refreshes a product's prices when JavaScript doesn't run (src/pages/api/watchlist/refresh.ts). */
export const REFRESH_FORM_ROUTE = "/api/watchlist/refresh";
// A refetch gives up after 20 s, past the route's own worst case (its database calls and the gate's 8 s), so a row
// never waits for good.
const REFRESH_TIMEOUT_MS = 20_000;

/** One matched shop as the page hands it to the island: the shop, its item's page, and its stored price, if any. */
export interface PriceComparisonShop {
  shop: PricedShop;
  productUrl: string | null;
  latest: LatestPrice | null;
}

/** What one refetch came to: the route's answer, or that the session ended and the user has to sign in again. */
export type RefreshResult = PriceRefreshAnswer | { kind: "session-ended" };

/** Why the last refetch gave no answer, shown next to the last known price. */
export interface RefreshNotice {
  reason: SearchUnavailableReason;
  until?: string;
}

/** One shop's row: its item's page, its latest check, whether a refetch runs, and why the last one gave no answer. */
export interface ShopRow {
  shop: PricedShop;
  productUrl: string | null;
  latest: LatestCheck | null;
  pending: boolean;
  notice: RefreshNotice | null;
}

export interface PriceComparisonState {
  /** The rows in the page's order; compareShops orders them for the view. */
  rows: ShopRow[];
  /** The time ages and staleness are judged at, in milliseconds. */
  now: number;
  /** A refetch found the session ended. */
  sessionEnded: boolean;
}

export type PriceComparisonAction =
  | { type: "start"; shop: PricedShop }
  | { type: "done"; shop: PricedShop; result: RefreshResult; at: number }
  | { type: "tick"; now: number };

/** A shop's refetch has started. */
export function start(shop: PricedShop): PriceComparisonAction {
  return { type: "start", shop };
}

/** A shop's refetch came back with `result`, at `at` on the browser's clock. */
export function done(shop: PricedShop, result: RefreshResult, at: number): PriceComparisonAction {
  return { type: "done", shop, result, at };
}

/** The clock moved on to `now`, in milliseconds. */
export function tick(now: number): PriceComparisonAction {
  return { type: "tick", now };
}

/**
 * The state the page renders with: the stored prices, nothing running, on the server's clock (`now`, an ISO
 * timestamp), so the browser's first render matches the page's HTML.
 */
export function initialState({ shops, now }: { shops: PriceComparisonShop[]; now: string }): PriceComparisonState {
  return {
    rows: shops.map(({ shop, productUrl, latest }) => ({ shop, productUrl, latest, pending: false, notice: null })),
    now: Date.parse(now),
    sessionEnded: false,
  };
}

export function priceComparisonReducer(
  state: PriceComparisonState,
  action: PriceComparisonAction,
): PriceComparisonState {
  switch (action.type) {
    case "start":
      // A new attempt clears what the last one said.
      return {
        ...state,
        sessionEnded: false,
        rows: state.rows.map((row) => (row.shop === action.shop ? { ...row, pending: true, notice: null } : row)),
      };
    case "done":
      return {
        rows: state.rows.map((row) => (row.shop === action.shop ? settled(row, action.result) : row)),
        now: action.at,
        sessionEnded: state.sessionEnded || action.result.kind === "session-ended",
      };
    case "tick":
      return { ...state, now: action.now };
  }
}

/** A row once its refetch came back. */
function settled(row: ShopRow, result: RefreshResult): ShopRow {
  const idle = { ...row, pending: false };
  switch (result.kind) {
    case "price": {
      const { offer, checkedAt } = result;
      return {
        ...idle,
        notice: null,
        latest: { lastCheckedAt: checkedAt, lastStatus: "price", offer: { ...offer, pricedAt: checkedAt } },
      };
    }
    case "missing":
      // The price from before stays with its own age, and the row says the shop no longer returns the item.
      return {
        ...idle,
        notice: null,
        latest: { lastCheckedAt: result.checkedAt, lastStatus: "missing", offer: row.latest?.offer ?? null },
      };
    case "unavailable":
      // Nothing was stored, so the last known price keeps its age.
      return {
        ...idle,
        notice: result.until === undefined ? { reason: result.reason } : { reason: result.reason, until: result.until },
      };
    case "session-ended":
      return idle;
  }
}

/** The rows in their order with their marks, and the summary, at the state's time. */
export function comparisonOf(state: PriceComparisonState): Comparison<ShopRow> {
  return compareShops(state.rows, state.now);
}

/** A row as the island renders it, with its verdict. */
export type ComparedRow = Comparison<ShopRow>["rows"][number];

const FAILED: RefreshResult = { kind: "unavailable", reason: "failed" };
const SESSION_ENDED: RefreshResult = { kind: "session-ended" };

/**
 * Asks the route to refetch one shop of the product, as JSON, which only the app's own pages can send. It never
 * throws: a request that fails or runs out of time is a failed refetch.
 */
export async function requestRefresh(
  itemId: string,
  shop: PricedShop,
  send: typeof fetch = fetch,
): Promise<RefreshResult> {
  // A timer of its own rather than AbortSignal.timeout, which Safari before 16 lacks; it covers reading the answer too.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REFRESH_TIMEOUT_MS);
  try {
    const response = await send(PRICES_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ itemId, shop }),
      // A signed-out request is redirected to the sign-in page: not following the redirect tells at once.
      redirect: "manual",
      signal: controller.signal,
    });
    return await readRefreshResponse(response);
  } catch {
    return FAILED;
  } finally {
    clearTimeout(timer);
  }
}

/** The parts of a `Response` the island reads, so a test can stand in for a redirect the browser didn't follow. */
export type RefreshResponse = Pick<Response, "type" | "redirected" | "ok" | "headers" | "json">;

/**
 * What the route's response comes to. A signed-out request is redirected to the sign-in page, so a redirect, or a page
 * in place of JSON, means the session ended: with `redirect: "manual"` the redirect comes back opaque, and one followed
 * anyway comes back as the sign-in page. An error status, and an answer that isn't the route's own, is a failed
 * refetch.
 */
export async function readRefreshResponse(response: RefreshResponse): Promise<RefreshResult> {
  if (response.type === "opaqueredirect" || response.redirected) {
    return SESSION_ENDED;
  }
  if (!isJsonMediaType(response.headers.get("Content-Type"))) {
    // An error page is a failure; a page that loaded fine is the sign-in page.
    return response.ok ? SESSION_ENDED : FAILED;
  }
  if (!response.ok) {
    return FAILED;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return FAILED;
  }
  return parseRefreshAnswer(body) ?? FAILED;
}

// The route's answers are checked by hand rather than with zod, which would add the whole library to the page's
// JavaScript for one small shape.
const REASONS: readonly SearchUnavailableReason[] = ["busy", "paused", "stopped", "failed"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The route's answer, or null when the body isn't one. */
export function parseRefreshAnswer(body: unknown): PriceRefreshAnswer | null {
  if (!isRecord(body)) {
    return null;
  }
  if (body.kind === "unavailable") {
    const { reason, until } = body;
    if (!isReason(reason) || !(until === undefined || typeof until === "string")) {
      return null;
    }
    return until === undefined ? { kind: "unavailable", reason } : { kind: "unavailable", reason, until };
  }
  const { checkedAt, saved } = body;
  if (!isTime(checkedAt) || typeof saved !== "boolean") {
    return null;
  }
  if (body.kind === "missing") {
    return { kind: "missing", checkedAt, saved };
  }
  const offer = body.kind === "price" ? parseOffer(body.offer) : null;
  return offer === null ? null : { kind: "price", offer, checkedAt, saved };
}

/** An offer as the route sends it, or null when a field is off. */
function parseOffer(value: unknown): ShopOffer | null {
  if (!isRecord(value)) {
    return null;
  }
  const { price, regularPrice, lowestPrice30d, promoEndsOn, available } = value;
  if (!isAmount(price) || typeof available !== "boolean") {
    return null;
  }
  if (!(regularPrice === null || isAmount(regularPrice))) {
    return null;
  }
  if (!(lowestPrice30d === null || isAmount(lowestPrice30d))) {
    return null;
  }
  if (!(promoEndsOn === null || (typeof promoEndsOn === "string" && ISO_DATE.test(promoEndsOn)))) {
    return null;
  }
  return { price, regularPrice, lowestPrice30d, promoEndsOn, available };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is SearchUnavailableReason {
  return REASONS.some((reason) => reason === value);
}

/** A time the island can show an age for. */
function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
