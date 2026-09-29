import { describe, expect, it, vi } from "vitest";
import {
  comparisonOf,
  done,
  initialState,
  parseRefreshAnswer,
  priceComparisonReducer,
  PRICES_ROUTE,
  readRefreshResponse,
  requestRefresh,
  start,
  tick,
  type PriceComparisonAction,
  type PriceComparisonShop,
  type PriceComparisonState,
  type RefreshResponse,
  type RefreshResult,
} from "@/components/watchlist/price-comparison-state";
import { STALE_AFTER_MS, type PricedShop } from "@/lib/services/price-comparison";
import type { LatestPrice, PriceRefreshAnswer, ShopOffer } from "@/types";

const ITEM_ID = "9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
// The server rendered the page at RENDERED; the answers came back a few seconds later.
const RENDERED = "2026-09-28T12:00:00.000Z";
const RENDERED_AT = Date.parse(RENDERED);
const CHECKED_AT = "2026-09-28T12:00:02.000Z";
const ANSWERED_AT = Date.parse("2026-09-28T12:00:03.000Z");
const MINUTE = 60 * 1000;

const ago = (ms: number) => new Date(RENDERED_AT - ms).toISOString();

const offer = (price: number): ShopOffer => ({
  price,
  regularPrice: null,
  lowestPrice30d: null,
  promoEndsOn: null,
  available: true,
});

/** A stored price, fetched `pricedAgo` before the page was rendered. */
function stored(shop: PricedShop, shopItemId: string, price: number, pricedAgo = 20 * MINUTE): LatestPrice {
  const at = ago(pricedAgo);
  return { shop, shopItemId, lastCheckedAt: at, lastStatus: "price", offer: { ...offer(price), pricedAt: at } };
}

const rossmann = (latest: LatestPrice | null = stored("rossmann", "26900", 26.99)): PriceComparisonShop => ({
  shop: "rossmann",
  productUrl: "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049",
  latest,
});
const natura = (latest: LatestPrice | null = stored("natura", "NV89063", 29.99)): PriceComparisonShop => ({
  shop: "natura",
  productUrl: "https://www.drogerienatura.pl/nivea-soft",
  latest,
});

const priceAnswer = (price: number): PriceRefreshAnswer => ({
  kind: "price",
  offer: offer(price),
  checkedAt: CHECKED_AT,
  saved: true,
});

function run(state: PriceComparisonState, ...actions: PriceComparisonAction[]): PriceComparisonState {
  return actions.reduce(priceComparisonReducer, state);
}

const rowOf = (state: PriceComparisonState, shop: PricedShop) => state.rows.find((row) => row.shop === shop);

/** Each shop and its mark, in the comparison's order. */
const marks = (state: PriceComparisonState) => comparisonOf(state).rows.map(({ shop, cheapest }) => [shop, cheapest]);

describe("price comparison state", () => {
  it("starts from the stored prices on the server's clock, with nothing running", () => {
    const state = initialState({ shops: [rossmann(), natura()], now: RENDERED });

    expect(state.now).toBe(RENDERED_AT);
    expect(state.sessionEnded).toBe(false);
    expect(state.rows.map(({ shop, pending, notice }) => [shop, pending, notice])).toEqual([
      ["rossmann", false, null],
      ["natura", false, null],
    ]);
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
  });

  it.each<[PricedShop, PricedShop]>([
    ["rossmann", "natura"],
    ["natura", "rossmann"],
  ])("applies both shops' answers whichever comes first (%s first)", (first, second) => {
    const answers: Record<PricedShop, RefreshResult> = { rossmann: priceAnswer(26.49), natura: priceAnswer(16.99) };
    let state = run(
      initialState({ shops: [rossmann(null), natura(null)], now: RENDERED }),
      start("rossmann"),
      start("natura"),
    );
    expect(state.rows.map((row) => row.pending)).toEqual([true, true]);

    state = run(state, done(first, answers[first], ANSWERED_AT));
    expect(rowOf(state, first)?.pending).toBe(false);
    expect(rowOf(state, second)?.pending).toBe(true);

    state = run(state, done(second, answers[second], ANSWERED_AT + 1));
    expect(state.rows.map((row) => row.pending)).toEqual([false, false]);
    expect(rowOf(state, "natura")?.latest).toEqual({
      lastCheckedAt: CHECKED_AT,
      lastStatus: "price",
      offer: { ...offer(16.99), pricedAt: CHECKED_AT },
    });
    expect(marks(state)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    // The answer's time moves the clock.
    expect(state.now).toBe(ANSWERED_AT + 1);
  });

  it("re-sorts and re-marks the shops when an answer changes the cheapest", () => {
    let state = initialState({ shops: [rossmann(), natura()], now: RENDERED });
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);

    state = run(state, start("natura"), done("natura", priceAnswer(16.99), ANSWERED_AT));

    expect(marks(state)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    expect(comparisonOf(state).summary).toMatchObject({ kind: "cheapest", savings: { amount: 10, than: "rossmann" } });
  });

  it("keeps the last known price with its age when the shop gives no answer, and says why", () => {
    const before = initialState({ shops: [rossmann(), natura()], now: RENDERED });
    const until = "2026-09-28T12:15:00.000Z";

    const state = run(
      before,
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "paused", until }, ANSWERED_AT),
    );

    expect(rowOf(state, "rossmann")).toEqual({
      ...rowOf(before, "rossmann"),
      pending: false,
      notice: { reason: "paused", until },
    });
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
    // The next attempt clears the notice.
    expect(rowOf(run(state, start("rossmann")), "rossmann")?.notice).toBeNull();
  });

  it("keeps the price from before when the shop no longer returns the item, and takes away its mark", () => {
    const before = initialState({ shops: [rossmann(), natura(stored("natura", "NV89063", 16.99))], now: RENDERED });
    expect(marks(before)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);

    const state = run(
      before,
      start("natura"),
      done("natura", { kind: "missing", checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
    );

    expect(rowOf(state, "natura")?.latest).toEqual({
      lastCheckedAt: CHECKED_AT,
      lastStatus: "missing",
      offer: rowOf(before, "natura")?.latest?.offer,
    });
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
  });

  it("says the session ended, keeping every price, and clears it on the next attempt", () => {
    const before = initialState({ shops: [rossmann(), natura()], now: RENDERED });

    const state = run(before, start("rossmann"), done("rossmann", { kind: "session-ended" }, ANSWERED_AT));

    expect(state.sessionEnded).toBe(true);
    expect(rowOf(state, "rossmann")).toEqual({ ...rowOf(before, "rossmann"), pending: false });
    expect(run(state, start("rossmann")).sessionEnded).toBe(false);
  });

  it("moves the clock on, so a price that turns stale loses its mark", () => {
    // Rossmann's lower price is a minute short of stale when the page is rendered.
    const before = initialState({
      shops: [rossmann(stored("rossmann", "26900", 12.99, STALE_AFTER_MS - MINUTE)), natura()],
      now: RENDERED,
    });
    expect(marks(before)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);

    const state = run(before, tick(RENDERED_AT + 2 * MINUTE));

    expect(state.now).toBe(RENDERED_AT + 2 * MINUTE);
    expect(marks(state)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
  });
});

/** A response as the island reads one. */
function response({
  status = 200,
  contentType = "application/json",
  body,
  type = "basic",
  redirected = false,
}: {
  status?: number;
  contentType?: string | null;
  body?: unknown;
  type?: ResponseType;
  redirected?: boolean;
}): RefreshResponse {
  return {
    type,
    redirected,
    ok: status >= 200 && status < 300,
    headers: new Headers(contentType === null ? {} : { "Content-Type": contentType }),
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError("Unexpected end of JSON input")) : Promise.resolve(body),
  };
}

describe("readRefreshResponse", () => {
  it.each<{ answer: PriceRefreshAnswer }>([
    { answer: priceAnswer(16.99) },
    {
      answer: {
        kind: "price",
        offer: { ...offer(5.99), regularPrice: 9.99, lowestPrice30d: 6.39, promoEndsOn: "2026-09-30" },
        checkedAt: CHECKED_AT,
        saved: false,
      },
    },
    { answer: { kind: "missing", checkedAt: CHECKED_AT, saved: true } },
    { answer: { kind: "unavailable", reason: "busy" } },
    { answer: { kind: "unavailable", reason: "paused", until: "2026-09-28T12:15:00.000Z" } },
  ])("reads the route's $answer.kind answer", async ({ answer }) => {
    expect(
      await readRefreshResponse(response({ body: answer, contentType: "application/json; charset=utf-8" })),
    ).toEqual(answer);
  });

  it.each<{ why: string; answer: RefreshResponse }>([
    { why: "a redirect it didn't follow", answer: response({ status: 0, type: "opaqueredirect", contentType: null }) },
    {
      why: "a redirect followed to the sign-in page",
      answer: response({ redirected: true, contentType: "text/html" }),
    },
    { why: "a page in place of JSON", answer: response({ contentType: "text/html; charset=utf-8" }) },
  ])("says the session ended for $why", async ({ answer }) => {
    expect(await readRefreshResponse(answer)).toEqual({ kind: "session-ended" });
  });

  it.each<{ why: string; answer: RefreshResponse }>([
    { why: "an error page", answer: response({ status: 500, contentType: "text/html" }) },
    { why: "an error in JSON", answer: response({ status: 404, body: { error: "gone" } }) },
    { why: "a body that isn't JSON", answer: response({}) },
    { why: "an answer of another shape", answer: response({ body: { kind: "price", offer: offer(16.99) } }) },
  ])("fails the refetch for $why", async ({ answer }) => {
    expect(await readRefreshResponse(answer)).toEqual({ kind: "unavailable", reason: "failed" });
  });
});

describe("parseRefreshAnswer", () => {
  it.each<{ why: string; body: unknown }>([
    { why: "no object", body: "price" },
    { why: "an unknown kind", body: { kind: "cheap", checkedAt: CHECKED_AT, saved: true } },
    { why: "a time that doesn't parse", body: { kind: "missing", checkedAt: "wczoraj", saved: true } },
    { why: "no saved flag", body: { kind: "missing", checkedAt: CHECKED_AT } },
    { why: "a price of zero", body: { ...priceAnswer(16.99), offer: offer(0) } },
    { why: "a price as text", body: { ...priceAnswer(16.99), offer: { ...offer(16.99), price: "16.99" } } },
    {
      why: "a promotion's end that isn't a date",
      body: { ...priceAnswer(16.99), offer: { ...offer(16.99), promoEndsOn: "30.09" } },
    },
    { why: "an unknown reason", body: { kind: "unavailable", reason: "later" } },
    { why: "a pause's end that isn't text", body: { kind: "unavailable", reason: "paused", until: 900 } },
  ])("refuses $why", ({ body }) => {
    expect(parseRefreshAnswer(body)).toBeNull();
  });
});

describe("requestRefresh", () => {
  it("posts the product and the shop as JSON, and doesn't follow a redirect", async () => {
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(priceAnswer(16.99)), { headers: { "Content-Type": "application/json" } }),
      ),
    );

    expect(await requestRefresh(ITEM_ID, "natura", send)).toEqual(priceAnswer(16.99));
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe(PRICES_ROUTE);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ itemId: ITEM_ID, shop: "natura" }));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails the refetch when the request fails", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(await requestRefresh(ITEM_ID, "rossmann", send)).toEqual({ kind: "unavailable", reason: "failed" });
  });
});
