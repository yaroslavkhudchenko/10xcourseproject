import { describe, expect, it, vi } from "vitest";
import {
  comparisonOf,
  done,
  gapText,
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
// Intl writes Polish prices with a no-break space before "zł".
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

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

describe("a price read that failed", () => {
  // The page couldn't read the stored prices, so it hands the island every shop without one.
  const unread = () => initialState({ shops: [rossmann(null), natura(null)], now: RENDERED, pricesFailed: true });
  const failedReads = (state: PriceComparisonState) => state.rows.map(({ shop, readFailed }) => [shop, readFailed]);

  it("marks every row when the read failed, and none when it didn't", () => {
    expect(failedReads(unread())).toEqual([
      ["rossmann", true],
      ["natura", true],
    ]);
    expect(failedReads(initialState({ shops: [rossmann(), natura(null)], now: RENDERED }))).toEqual([
      ["rossmann", false],
      ["natura", false],
    ]);
  });

  it.each<{ kind: string; result: RefreshResult }>([
    { kind: "price", result: priceAnswer(16.99) },
    { kind: "missing", result: { kind: "missing", checkedAt: CHECKED_AT, saved: true } },
  ])("clears the mark of the row whose shop answered with a $kind, and only that row", ({ result }) => {
    const state = run(unread(), start("rossmann"), start("natura"), done("natura", result, ANSWERED_AT));

    expect(failedReads(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
  });

  it.each<{ kind: string; result: RefreshResult }>([
    { kind: "unavailable", result: { kind: "unavailable", reason: "failed" } },
    {
      kind: "unavailable (paused)",
      result: { kind: "unavailable", reason: "paused", until: "2026-09-28T12:15:00.000Z" },
    },
    { kind: "session-ended", result: { kind: "session-ended" } },
  ])("keeps the mark when the shop's answer is $kind", ({ result }) => {
    const state = run(unread(), start("natura"), done("natura", result, ANSWERED_AT));

    expect(failedReads(state)).toEqual([
      ["rossmann", true],
      ["natura", true],
    ]);
  });

  it("marks only the row of a shop whose own stored price the page couldn't read", () => {
    const state = initialState({ shops: [rossmann(), { ...natura(null), readFailed: true }], now: RENDERED });

    expect(failedReads(state)).toEqual([
      ["rossmann", false],
      ["natura", true],
    ]);
  });

  it("names no shop cheapest while a row's stored price is unread, in the rows or aloud", () => {
    // Rossmann's stored price is fresh, but Natura's, which may be lower, couldn't be read.
    const before = initialState({ shops: [rossmann(), { ...natura(null), readFailed: true }], now: RENDERED });
    expect(marks(before)).toEqual([
      ["rossmann", false],
      ["natura", false],
    ]);
    expect(comparisonOf(before).summary).toEqual({ kind: "none" });

    const state = run(before, start("rossmann"), done("rossmann", priceAnswer(12.99), ANSWERED_AT));

    expect(marks(state)).toEqual([
      ["rossmann", false],
      ["natura", false],
    ]);
    expect(state.announcements).toEqual([`Rossmann: 12,99${NO_BREAK_SPACE}zł`]);
  });

  it("names none cheapest when one shop answers after a failed read, and marks the cheapest once both have", () => {
    let state = run(unread(), start("rossmann"), start("natura"), done("natura", priceAnswer(26.49), ANSWERED_AT));
    expect(marks(state)).toEqual([
      ["natura", false],
      ["rossmann", false],
    ]);

    state = run(state, done("rossmann", priceAnswer(16.99), ANSWERED_AT + 1));

    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
    expect(state.announcements).toEqual([
      `Natura: 26,49${NO_BREAK_SPACE}zł`,
      `Rossmann: 16,99${NO_BREAK_SPACE}zł, najtaniej`,
    ]);
  });
});

describe("gapText", () => {
  it("says the price couldn't be read while the row's read failed", () => {
    const [row] = initialState({ shops: [rossmann(null)], now: RENDERED, pricesFailed: true }).rows;

    expect(gapText(row)).toBe("Nie udało się wczytać ceny.");
  });

  it("says there's no price yet for a row never checked, while it's being fetched too", () => {
    const state = initialState({ shops: [rossmann(null)], now: RENDERED });

    expect(gapText(state.rows[0])).toBe("Jeszcze bez ceny");
    expect(gapText(run(state, start("rossmann")).rows[0])).toBe("Jeszcze bez ceny");
  });

  it("says the shop has no online price once it answered without one", () => {
    const answered = run(
      initialState({ shops: [natura(null)], now: RENDERED, pricesFailed: true }),
      start("natura"),
      done("natura", { kind: "missing", checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
    );

    expect(gapText(answered.rows[0])).toBe("Brak ceny online w drogerienatura.pl");
  });
});

describe("what screen readers hear", () => {
  /** A message as the plan spells it, with the no-break space Intl writes before "zł". */
  const said = (text: string) => text.replaceAll(" zł", `${NO_BREAK_SPACE}zł`);

  it("says nothing before any answer", () => {
    expect(initialState({ shops: [rossmann(), natura()], now: RENDERED }).announcements).toEqual([]);
  });

  it("says a shop's new price, and that it's now the cheapest", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("natura"),
      done("natura", priceAnswer(16.99), ANSWERED_AT),
    );

    expect(state.announcements).toEqual([said("Natura: 16,99 zł, najtaniej")]);
  });

  it("says a new price that isn't the cheapest without the mark", () => {
    // Rossmann's 26,99 zł stays the lowest.
    const state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("natura"),
      done("natura", priceAnswer(27.49), ANSWERED_AT),
    );

    expect(state.announcements).toEqual([said("Natura: 27,49 zł")]);
  });

  it("says each answer of a refresh in the order the answers came", () => {
    const state = run(
      initialState({ shops: [rossmann(null), natura(null)], now: RENDERED }),
      start("rossmann"),
      start("natura"),
      done("natura", priceAnswer(16.99), ANSWERED_AT),
      done("rossmann", priceAnswer(26.49), ANSWERED_AT + 1),
    );

    expect(state.announcements).toEqual([said("Natura: 16,99 zł, najtaniej"), said("Rossmann: 26,49 zł")]);
  });

  it("says why a shop gave no answer, in the words its row shows", () => {
    // 12:15 UTC is 14:15 in Poland.
    const paused = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "paused", until: "2026-09-28T12:15:00.000Z" }, ANSWERED_AT),
    );
    // A shop with no price to keep showing promises none.
    const busy = run(
      initialState({ shops: [rossmann(), natura(null)], now: RENDERED }),
      start("natura"),
      done("natura", { kind: "unavailable", reason: "busy" }, ANSWERED_AT),
    );

    expect(paused.announcements).toEqual([
      "Sklep Rossmann poprosił o przerwę do około 14:15. Pokazujemy ostatnią znaną cenę.",
    ]);
    expect(busy.announcements).toEqual(["Sklep Natura jest teraz zajęty. Spróbuj za minutę."]);
  });

  it("says the shop no longer returns the item, mentioning a price only when one is left", () => {
    const missing = { kind: "missing", checkedAt: CHECKED_AT, saved: true } as const;
    const withPrice = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("natura"),
      done("natura", missing, ANSWERED_AT),
    );
    const withoutPrice = run(
      initialState({ shops: [rossmann(), natura(null)], now: RENDERED }),
      start("natura"),
      done("natura", missing, ANSWERED_AT),
    );

    expect(withPrice.announcements).toEqual(["Natura: Sklep nie zwraca już tego produktu. Cena może być nieaktualna."]);
    expect(withoutPrice.announcements).toEqual(["Natura: Sklep nie zwraca tego produktu."]);
  });

  it("leaves an ended session to the page's alert, so it isn't announced twice", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("rossmann"),
      start("natura"),
      done("rossmann", { kind: "session-ended" }, ANSWERED_AT),
      done("natura", priceAnswer(16.99), ANSWERED_AT + 1),
    );

    expect(state.sessionEnded).toBe(true);
    expect(state.announcements).toEqual([said("Natura: 16,99 zł, najtaniej")]);
  });

  it("clears what the last refresh said when a new one starts, but not while one still runs", () => {
    let state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("rossmann"),
      start("natura"),
      done("rossmann", priceAnswer(26.49), ANSWERED_AT),
    );
    // Natura still runs, so a start now belongs to the same refresh.
    state = run(state, start("rossmann"));
    expect(state.announcements).toEqual([said("Rossmann: 26,49 zł, najtaniej")]);

    state = run(
      state,
      done("rossmann", priceAnswer(26.49), ANSWERED_AT + 1),
      done("natura", priceAnswer(16.99), ANSWERED_AT + 2),
    );
    expect(state.announcements).toEqual([
      said("Rossmann: 26,49 zł, najtaniej"),
      said("Rossmann: 26,49 zł, najtaniej"),
      said("Natura: 16,99 zł, najtaniej"),
    ]);

    // "Odśwież ceny" again, with nothing running: a new refresh.
    state = run(state, start("rossmann"), start("natura"));
    expect(state.announcements).toEqual([]);
    state = run(state, done("natura", priceAnswer(15.99), ANSWERED_AT + 3));
    expect(state.announcements).toEqual([said("Natura: 15,99 zł, najtaniej")]);
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
