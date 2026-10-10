import { describe, expect, it, vi } from "vitest";
import {
  checkedAge,
  checkedCaption,
  comparisonOf,
  done,
  gapText,
  heroOf,
  initialState,
  judgementOfState,
  markerSteps,
  matchChangedText,
  parseRefreshAnswer,
  priceComparisonReducer,
  PRICES_EVENT,
  PRICES_ROUTE,
  readRefreshResponse,
  requestRefresh,
  rowShopsOfIsland,
  shopsOfPricesEvent,
  start,
  tick,
  trackHint,
  trackLabels,
  trackOf,
  verdictOfState,
  type Hero,
  type PriceComparisonAction,
  type PriceComparisonState,
  type PricesEventDetail,
  type RefreshResponse,
  type RefreshResult,
  type TrackLabel,
  type TrackMarker,
} from "@/components/watchlist/price-comparison-state";
import {
  compareShops,
  judgementOf,
  STALE_AFTER_MS,
  verdictOf,
  type LatestCheck,
  type MatchableShop,
  type PriceComparisonShop,
  type PricedShop,
  type PriceJudgement,
  type PriceVerdict,
  type ShopPrice,
} from "@/lib/services/price-comparison";
import { rowTagOf } from "@/lib/services/watchlist-rows";
import type { LatestPrice, PriceHistory, PriceRefreshAnswer, ShopOffer } from "@/types";

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

/** A stored price, fetched `pricedAgo` before the page was rendered, read without its history. */
function stored(shop: PricedShop, shopItemId: string, price: number, pricedAgo = 20 * MINUTE): LatestPrice {
  const at = ago(pricedAgo);
  return {
    shop,
    shopItemId,
    lastCheckedAt: at,
    lastStatus: "price",
    offer: { ...offer(price), pricedAt: at },
    history: null,
  };
}

const rossmann = (latest: LatestPrice | null = stored("rossmann", "26900", 26.99)): PriceComparisonShop => ({
  shop: "rossmann",
  shopItemId: "26900",
  productUrl: "https://www.rossmann.pl/Produkt/NIVEA-Soft,26900,13049",
  latest,
});
const natura = (latest: LatestPrice | null = stored("natura", "NV89063", 29.99)): PriceComparisonShop => ({
  shop: "natura",
  shopItemId: "NV89063",
  productUrl: "https://www.drogerienatura.pl/nivea-soft",
  latest,
});
// Hebe's Nivea Soft 200 ml, by its 18-digit id.
const HEBE_SOFT_ID = "000000000000218807";
const hebe = (latest: LatestPrice | null = stored("hebe", HEBE_SOFT_ID, 24.99)): PriceComparisonShop => ({
  shop: "hebe",
  shopItemId: HEBE_SOFT_ID,
  productUrl: "https://www.hebe.pl/nivea-intensywnie-nawilzajacy-krem-do-twarzy-i-ciala-200-ml-000000000000218807.html",
  latest,
});
// Super-Pharm's Nivea Soft 300 ml, by its record's objectID.
const SUPER_PHARM_SOFT_ID = "10132";
const superPharm = (
  latest: LatestPrice | null = stored("super-pharm", SUPER_PHARM_SOFT_ID, 19.49),
): PriceComparisonShop => ({
  shop: "super-pharm",
  shopItemId: SUPER_PHARM_SOFT_ID,
  productUrl: "https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477",
  latest,
});

/** The route's answer with `price`, checked at CHECKED_AT, which it stored unless `saved` is false. */
const priceAnswer = (price: number, saved = true): PriceRefreshAnswer => ({
  kind: "price",
  offer: offer(price),
  checkedAt: CHECKED_AT,
  saved,
});

function run(state: PriceComparisonState, ...actions: PriceComparisonAction[]): PriceComparisonState {
  return actions.reduce(priceComparisonReducer, state);
}

const rowOf = (state: PriceComparisonState, shop: PricedShop) => state.rows.find((row) => row.shop === shop);

/** Each shop and its mark, in the comparison's order. */
const marks = (state: PriceComparisonState) => comparisonOf(state).rows.map(({ shop, cheapest }) => [shop, cheapest]);

/** A message as the plan spells it, with the no-break space Intl writes before "zł". */
const said = (text: string) => text.replaceAll(" zł", `${NO_BREAK_SPACE}zł`);

describe("price comparison state", () => {
  it("starts from the stored prices on the server's clock, with nothing running", () => {
    const state = initialState({ shops: [rossmann(), natura()], now: RENDERED });

    expect(state.now).toBe(RENDERED_AT);
    expect(state.sessionEnded).toBe(false);
    expect(state.matchChanged).toEqual([]);
    expect(state.unreadable).toEqual([]);
    // Every price the page hands over is a stored one.
    expect(state.rows.map(({ shop, pending, notice, unsaved }) => [shop, pending, notice, unsaved])).toEqual([
      ["rossmann", false, null, false],
      ["natura", false, null, false],
    ]);
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
  });

  it.each<[PricedShop, PricedShop, PricedShop, PricedShop]>([
    ["rossmann", "natura", "hebe", "super-pharm"],
    ["super-pharm", "hebe", "natura", "rossmann"],
    ["natura", "super-pharm", "rossmann", "hebe"],
  ])("applies every shop's answer whichever comes first (%s, then %s, then %s, then %s)", (...order) => {
    const answers: Record<PricedShop, RefreshResult> = {
      rossmann: priceAnswer(26.49),
      natura: priceAnswer(16.99),
      hebe: priceAnswer(17.49),
      "super-pharm": priceAnswer(19.49),
    };
    let state = run(
      initialState({ shops: [rossmann(null), natura(null), hebe(null), superPharm(null)], now: RENDERED }),
      start("rossmann"),
      start("natura"),
      start("hebe"),
      start("super-pharm"),
    );
    expect(state.rows.map((row) => row.pending)).toEqual([true, true, true, true]);

    order.forEach((shop, answered) => {
      state = run(state, done(shop, answers[shop], ANSWERED_AT + answered));
      // The shops that answered so far are done, and every other one still waits.
      expect(order.map((each) => rowOf(state, each)?.pending)).toEqual(order.map((_, index) => index > answered));
    });
    expect(rowOf(state, "natura")?.latest).toEqual({
      lastCheckedAt: CHECKED_AT,
      lastStatus: "price",
      offer: { ...offer(16.99), pricedAt: CHECKED_AT },
      // The page read no check of Natura's item, so it had no price before today.
      history: { low: null, days: [] },
    });
    expect(marks(state)).toEqual([
      ["natura", true],
      ["hebe", false],
      ["super-pharm", false],
      ["rossmann", false],
    ]);
    // The answer's time moves the clock.
    expect(state.now).toBe(ANSWERED_AT + 3);
  });

  it("names Hebe cheapest once its answer is the lowest of three, and never its stale stored price", () => {
    // Hebe's stored 9,99 zł is two days old, so it can't win, until Hebe answers with a fresh 15,99 zł.
    const before = initialState({
      shops: [
        rossmann(),
        natura(stored("natura", "NV89063", 16.99)),
        hebe(stored("hebe", HEBE_SOFT_ID, 9.99, 2 * DAY)),
      ],
      now: RENDERED,
    });
    expect(marks(before)).toEqual([
      ["natura", true],
      ["rossmann", false],
      ["hebe", false],
    ]);

    const state = run(before, start("hebe"), done("hebe", priceAnswer(15.99), ANSWERED_AT));

    expect(marks(state)).toEqual([
      ["hebe", true],
      ["natura", false],
      ["rossmann", false],
    ]);
    expect(state.announcements).toEqual([`Hebe: 15,99${NO_BREAK_SPACE}zł, najtaniej`]);
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
      history: null,
    });
    expect(marks(state)).toEqual([
      ["rossmann", true],
      ["natura", false],
    ]);
  });

  it("keeps a shop's price history through its answer, since the history covers only the days before today", () => {
    // Natura's prices on two days before the page was rendered, as the page read them.
    const history = { low: 15.99, days: ["2026-09-26", "2026-09-27"] };
    const before = initialState({
      shops: [rossmann(), natura({ ...stored("natura", "NV89063", 16.99), history })],
      now: RENDERED,
    });

    const answered = run(before, start("natura"), done("natura", priceAnswer(17.49), ANSWERED_AT));
    const gone = run(
      before,
      start("natura"),
      done("natura", { kind: "missing", checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT),
    );

    expect(rowOf(answered, "natura")?.latest).toMatchObject({ lastCheckedAt: CHECKED_AT, history });
    expect(rowOf(gone, "natura")?.latest).toMatchObject({ lastStatus: "missing", history });
  });

  it("gives a shop the page read without any check no history before today, and one it couldn't read none read", () => {
    // Rossmann's item was never checked, so the page's read found no price of it before today. Natura's stored price
    // couldn't be read, so neither could its history, whatever Natura answers today.
    const before = initialState({ shops: [rossmann(null), { ...natura(null), readFailed: true }], now: RENDERED });
    const missing = { kind: "missing", checkedAt: CHECKED_AT, saved: true } as const;
    const answered = (rossmannAnswer: RefreshResult, naturaAnswer: RefreshResult) =>
      run(
        before,
        start("rossmann"),
        start("natura"),
        done("rossmann", rossmannAnswer, ANSWERED_AT),
        done("natura", naturaAnswer, ANSWERED_AT + 1),
      );

    for (const state of [answered(priceAnswer(26.49), priceAnswer(16.99)), answered(missing, missing)]) {
      expect(rowOf(state, "rossmann")?.latest?.history).toEqual({ low: null, days: [] });
      expect(rowOf(state, "natura")?.latest?.history).toBeNull();
    }
  });

  it("says the session ended, keeping every price, and clears it on the next attempt", () => {
    const before = initialState({ shops: [rossmann(), natura()], now: RENDERED });

    const state = run(before, start("rossmann"), done("rossmann", { kind: "session-ended" }, ANSWERED_AT));

    expect(state.sessionEnded).toBe(true);
    expect(rowOf(state, "rossmann")).toEqual({ ...rowOf(before, "rossmann"), pending: false });
    expect(run(state, start("rossmann")).sessionEnded).toBe(false);
  });

  it("says the shop's match changed, keeping its row's price and notice, and clears it on the next attempt", () => {
    // Rossmann's last refetch left a notice; Natura's match was re-pinned elsewhere while the page stood open.
    const before = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "busy" }, ANSWERED_AT),
    );

    const state = run(before, start("natura"), done("natura", { kind: "match-changed" }, ANSWERED_AT + 1));

    expect(state.matchChanged).toEqual(["natura"]);
    expect(matchChangedText(state.matchChanged)).toBe("Dopasowanie w Naturze się zmieniło.");
    // The row shows its last known price as it was, and says nothing itself: the page's alert asks for a reload.
    expect(rowOf(state, "natura")).toEqual({ ...rowOf(before, "natura"), pending: false });
    expect(rowOf(state, "rossmann")).toEqual(rowOf(before, "rossmann"));
    expect(state.announcements).toEqual([]);
    expect(run(state, start("natura")).matchChanged).toEqual([]);
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
    { kind: "match-changed", result: { kind: "match-changed" } },
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

// The owner's calls of 2026-10-10 (context/changes/unstored-price-check/plan.md): the island keeps a price the route
// couldn't store, with its marks, and says the list won't show it while that price is on the card. Each message is
// written out whole, never put together as the rule puts it.
describe("a price the route couldn't store", () => {
  // Rossmann's stored 26,99 zł and Natura's 29,99 zł.
  const before = () => initialState({ shops: [rossmann(), natura()], now: RENDERED });
  /** Natura refetched, and answered 16,99 zł, which the route couldn't store. */
  const unstored = () => run(before(), start("natura"), done("natura", priceAnswer(16.99, false), ANSWERED_AT));

  it("keeps the price on Natura's row with its marks, and says the list won't show it", () => {
    const state = unstored();

    expect(rowOf(state, "natura")).toMatchObject({
      pending: false,
      notice: null,
      readFailed: false,
      unsaved: true,
      latest: { lastCheckedAt: CHECKED_AT, lastStatus: "price", offer: { price: 16.99, pricedAt: CHECKED_AT } },
    });
    expect(marks(state)).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);
    expect(state.announcements).toEqual([
      said("Natura: 16,99 zł, najtaniej. Nie udało się zapisać tej ceny, więc lista jej nie pokaże."),
    ]);
  });

  it("says nothing more of a price the route stored", () => {
    const state = run(before(), start("natura"), done("natura", priceAnswer(16.99, true), ANSWERED_AT));

    expect(rowOf(state, "natura")?.unsaved).toBe(false);
    expect(state.announcements).toEqual([said("Natura: 16,99 zł, najtaniej")]);
  });

  it("keeps saying so while Natura is asked again, and once that refetch gets no answer", () => {
    const asked = run(unstored(), start("natura"));
    expect(rowOf(asked, "natura")).toMatchObject({ pending: true, unsaved: true });

    const state = run(asked, done("natura", { kind: "unavailable", reason: "failed" }, ANSWERED_AT + 1));

    expect(rowOf(state, "natura")).toMatchObject({
      pending: false,
      notice: { reason: "failed" },
      unsaved: true,
      latest: { lastCheckedAt: CHECKED_AT, lastStatus: "price", offer: { price: 16.99, pricedAt: CHECKED_AT } },
    });
    expect(state.announcements).toEqual([
      "Nie udało się pobrać ceny ze sklepu Natura. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.",
    ]);
  });

  it("keeps saying so once Natura no longer returns the item, since the row keeps that price", () => {
    const state = run(
      unstored(),
      start("natura"),
      done("natura", { kind: "missing", checkedAt: CHECKED_AT, saved: true }, ANSWERED_AT + 1),
    );

    expect(rowOf(state, "natura")).toMatchObject({
      unsaved: true,
      latest: { lastStatus: "missing", offer: { price: 16.99, pricedAt: CHECKED_AT } },
    });
    expect(state.announcements).toEqual([
      "Natura: Sklep nie zwraca już tego produktu. Cena może być nieaktualna. Nie udało się zapisać tej ceny, więc lista jej nie pokaże.",
    ]);
  });

  it("stops saying so once Natura's next price is stored", () => {
    const state = run(unstored(), start("natura"), done("natura", priceAnswer(17.49, true), ANSWERED_AT + 1));

    expect(rowOf(state, "natura")).toMatchObject({ unsaved: false, latest: { offer: { price: 17.49 } } });
    expect(state.announcements).toEqual([said("Natura: 17,49 zł, najtaniej")]);
  });

  it("says nothing of a missing item it couldn't store after a stored price, which the list does show", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura(stored("natura", "NV89063", 16.99))], now: RENDERED }),
      start("natura"),
      done("natura", { kind: "missing", checkedAt: CHECKED_AT, saved: false }, ANSWERED_AT),
    );

    expect(rowOf(state, "natura")).toMatchObject({ unsaved: false, latest: { lastStatus: "missing" } });
    expect(state.announcements).toEqual(["Natura: Sklep nie zwraca już tego produktu. Cena może być nieaktualna."]);
  });

  it("says so of a price that answers after the page couldn't read the stored one, whose history stays unread", () => {
    const state = run(
      initialState({ shops: [rossmann(), { ...natura(null), readFailed: true }], now: RENDERED }),
      start("natura"),
      done("natura", priceAnswer(16.99, false), ANSWERED_AT),
    );

    expect(rowOf(state, "natura")).toMatchObject({ readFailed: false, unsaved: true, latest: { history: null } });
  });

  it("lets the selected list row's tag follow the price, an edge the test plan accepts", () => {
    // From lg, the tag beside the product follows the island's live prices (context/foundation/test-plan.md, the edges
    // the owner accepted), while the list as it loads shows only stored prices.
    expect(rowTagOf(rowShopsOfIsland(unstored().rows), ANSWERED_AT)).toEqual({
      tone: "sun",
      price: 16.99,
      label: "Natura",
      meta: "Natura · przed chwilą",
    });
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
    status,
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

  it("says the shop's match changed for the route's conflict, so the page asks for a reload", async () => {
    expect(await readRefreshResponse(response({ status: 409, body: { error: "changed" } }))).toEqual({
      kind: "match-changed",
    });
  });

  it.each<{ why: string; answer: RefreshResponse }>([
    { why: "an error page", answer: response({ status: 500, contentType: "text/html" }) },
    { why: "an error in JSON", answer: response({ status: 404, body: { error: "gone" } }) },
    { why: "another conflict", answer: response({ status: 409, body: { error: "gone" } }) },
    { why: "a conflict whose body can't be read", answer: response({ status: 409 }) },
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
  it("posts the product, the shop and the item the page shows as JSON, and doesn't follow a redirect", async () => {
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(priceAnswer(16.99)), { headers: { "Content-Type": "application/json" } }),
      ),
    );

    expect(await requestRefresh(ITEM_ID, "natura", "NV89063", send)).toEqual(priceAnswer(16.99));
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe(PRICES_ROUTE);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe(JSON.stringify({ itemId: ITEM_ID, shop: "natura", shopItemId: "NV89063" }));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads the route's conflict as a changed match", async () => {
    const send = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "changed" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    expect(await requestRefresh(ITEM_ID, "natura", "NV81063", send)).toEqual({ kind: "match-changed" });
  });

  it("fails the refetch when the request fails", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(await requestRefresh(ITEM_ID, "rossmann", "26900", send)).toEqual({ kind: "unavailable", reason: "failed" });
  });
});

// The product area's rules, judged on the server's clock when the page was rendered.
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A text as the plan spells it, with the no-break space Intl writes before "zł". */
const priced = (text: string) => text.replaceAll(" zł", `${NO_BREAK_SPACE}zł`);

/**
 * A check that found `price`, fetched `pricedAgo` before the page was rendered, with the shop's 30-day low if given, and
 * the item's price history as the page reads it: no price before today, unless given.
 */
function checkOf(
  price: number,
  {
    lowestPrice30d = null,
    pricedAgo = 5 * MINUTE,
    available = true,
    history = { low: null, days: [] },
  }: { lowestPrice30d?: number | null; pricedAgo?: number; available?: boolean; history?: PriceHistory | null } = {},
): LatestCheck {
  const at = ago(pricedAgo);
  return {
    lastCheckedAt: at,
    lastStatus: "price",
    offer: { price, regularPrice: null, lowestPrice30d, promoEndsOn: null, available, pricedAt: at },
    history,
  };
}

/** The comparison and the verdict of these rows at the page's render, with or without a price that couldn't be read. */
function judged(rows: ShopPrice[], unread = false) {
  const compared = compareShops(rows, RENDERED_AT);
  return { rows: compared.rows, verdict: verdictOf(compared, RENDERED_AT, unread) };
}

/** Rows compared at the page's render, with their verdict (judged). */
type Judged = ReturnType<typeof judged>;

// The owner's rule of 2026-10-06 (FR-012) compares today's price with the cheapest shop's declared 30-day low until the
// product has been on the list for 30 days and its shops had a price on 5 different days before today, and with that
// history from then on. A product added the day before the page was rendered is compared with its shop's low; one
// added 40 days before, with its own history, once that holds 5 days.
const ADDED_RECENTLY = ago(DAY);
const ADDED_LONG_AGO = ago(40 * DAY);
// The five days in Poland before the page's, 28 September.
const FIVE_DAYS = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

/** Whether these rows' price is a good one (judgementOf), at the page's render, for a product added at `addedAt`. */
function judgementFor({ rows, verdict }: Judged, addedAt = ADDED_RECENTLY): PriceJudgement | null {
  return judgementOf(verdict, rows, addedAt, RENDERED_AT);
}

// The handoff's samples: Nivea cheapest in Natura, with Natura's 30-day low; Isana cheapest in Rossmann, at the 30-day
// low Rossmann declares; Ziaja only in Rossmann; Colgate stale.
const nivea = () =>
  judged([
    { shop: "rossmann", latest: checkOf(26.99, { pricedAgo: 10 * MINUTE }) },
    { shop: "natura", latest: checkOf(22.99, { lowestPrice30d: 23.99 }) },
  ]);
const isana = () =>
  judged([
    { shop: "rossmann", latest: checkOf(7.49, { lowestPrice30d: 7.49, pricedAgo: 10 * MINUTE }) },
    { shop: "natura", latest: checkOf(8.99, { pricedAgo: 12 * MINUTE }) },
  ]);
const ziaja = () => judged([{ shop: "rossmann", latest: checkOf(12.99, { pricedAgo: DAY }) }]);
const colgate = () =>
  judged([{ shop: "rossmann", latest: checkOf(11.49, { lowestPrice30d: 10.99, pricedAgo: 2 * DAY }) }]);

/**
 * Natura cheapest at 16,99 zł beside Rossmann's 26,99 zł: Natura declaring `low` as its 30-day low, or none, with
 * `history` as its own, and Rossmann with `rossmannHistory`; each history none before today unless given.
 */
function inNatura({
  low = null,
  history = { low: null, days: [] },
  rossmannHistory = { low: null, days: [] },
}: { low?: number | null; history?: PriceHistory; rossmannHistory?: PriceHistory | null } = {}): Judged {
  return judged([
    { shop: "rossmann", latest: checkOf(26.99, { history: rossmannHistory }) },
    { shop: "natura", latest: checkOf(16.99, { lowestPrice30d: low, history }) },
  ]);
}

describe("heroOf", () => {
  it("names the cheapest shop and how much less it is, with the age of its price and its judgement's sticker", () => {
    // Natura's 22,99 zł is below the 23,99 zł Natura declares as its 30-day low: a good price.
    expect(heroOf(nivea().verdict, { undecided: [] }, judgementFor(nivea()))).toEqual({
      tone: "sun",
      eyebrow: "Najtaniej dziś",
      shops: "w Naturze",
      price: 22.99,
      sub: priced("o 4,00 zł taniej niż Rossmann · sprawdzono 5 min temu"),
      sticker: "good",
    });
  });

  it.each<{ why: string; prices: () => Judged; addedAt?: string; sticker: Hero["sticker"] }>([
    { why: "below its shop's 30-day low", prices: () => inNatura({ low: 17.99 }), sticker: "good" },
    { why: "equal to its shop's 30-day low, as the handoff's Isana", prices: isana, sticker: "ordinary" },
    { why: "above its shop's 30-day low", prices: () => inNatura({ low: 15.99 }), sticker: "ordinary" },
    {
      why: "below the product's own 30 days and its shop's 30-day low",
      prices: () => inNatura({ low: 17.99, history: { low: 17.49, days: FIVE_DAYS } }),
      addedAt: ADDED_LONG_AGO,
      sticker: "good",
    },
    {
      why: "below the product's own 30 days, though above the lower 30-day low its shop declares",
      prices: () => inNatura({ low: 15.99, history: { low: 17.49, days: FIVE_DAYS } }),
      addedAt: ADDED_LONG_AGO,
      sticker: "ordinary",
    },
    {
      why: "above the product's own 30 days, though below its shop's 30-day low",
      prices: () => inNatura({ low: 17.99, history: { low: 15.99, days: FIVE_DAYS } }),
      addedAt: ADDED_LONG_AGO,
      sticker: "ordinary",
    },
    { why: "with nothing to compare it with", prices: () => inNatura(), sticker: null },
  ])("stamps the cheapest price $sticker when it's $why", ({ prices, addedAt, sticker }) => {
    const compared = prices();

    expect(heroOf(compared.verdict, { undecided: [] }, judgementFor(compared, addedAt))).toMatchObject({
      tone: "sun",
      eyebrow: "Najtaniej dziś",
      sticker,
    });
  });

  it('names both shops of a tie after "w", with the older price\'s age', () => {
    const tie = judged([
      { shop: "rossmann", latest: checkOf(16.99, { pricedAgo: 5 * MINUTE }) },
      { shop: "natura", latest: checkOf(16.99, { pricedAgo: HOUR }) },
    ]);

    expect(heroOf(tie.verdict, { undecided: [] }, judgementFor(tie))).toMatchObject({
      tone: "sun",
      shops: "w Rossmannie i w Naturze",
      price: 16.99,
      sub: "sprawdzono 1 godz. temu",
    });
  });

  it.each<{ undecided: MatchableShop[]; sub: string }>([
    { undecided: ["natura"], sub: "sprawdzono wczoraj · Natura czeka na dopasowanie" },
    { undecided: [], sub: "sprawdzono wczoraj" },
  ])("gives the only known price, saying Natura waits only while it does ($undecided)", ({ undecided, sub }) => {
    expect(heroOf(ziaja().verdict, { undecided }, judgementFor(ziaja()))).toEqual({
      tone: "plain",
      eyebrow: "Jedyna znana cena",
      shops: "w Rossmannie",
      price: 12.99,
      sub,
      sticker: "one-shop",
    });
  });

  it('keeps "Tylko 1 sklep" on the only price whatever its judgement, which the price track\'s card gives', () => {
    // Rossmann's 12,99 zł is below the 13,49 zł Rossmann declares as its 30-day low: a good price.
    const good = judged([{ shop: "rossmann", latest: checkOf(12.99, { lowestPrice30d: 13.49 }) }]);

    expect(judgementFor(good)).toMatchObject({ kind: "good" });
    expect(heroOf(good.verdict, { undecided: [] }, judgementFor(good))).toMatchObject({
      eyebrow: "Jedyna znana cena",
      sticker: "one-shop",
    });
  });

  it("names every matched shop that waits for its match, agreeing in number", () => {
    expect(heroOf(ziaja().verdict, { undecided: ["natura", "hebe"] }, judgementFor(ziaja()))).toMatchObject({
      eyebrow: "Jedyna znana cena",
      sub: "sprawdzono wczoraj · Natura i Hebe czekają na dopasowanie",
    });
    expect(heroOf(ziaja().verdict, { undecided: ["hebe"] }, judgementFor(ziaja()))).toMatchObject({
      sub: "sprawdzono wczoraj · Hebe czeka na dopasowanie",
    });
  });

  it("gives a price that can't be ordered online, with its age, and no judgement", () => {
    // Below the 27,99 zł Rossmann declares as its 30-day low, but it can't be ordered online, so it isn't judged.
    const unorderable = judged([
      { shop: "rossmann", latest: checkOf(26.99, { lowestPrice30d: 27.99, available: false }) },
    ]);

    expect(heroOf(unorderable.verdict, { undecided: ["natura"] }, judgementFor(unorderable))).toEqual({
      tone: "plain",
      eyebrow: "Niedostępny online",
      shops: "w Rossmannie",
      price: 26.99,
      sub: "sprawdzono 5 min temu",
      sticker: null,
    });
  });

  it("gives the last known price with its age, saying it may be out of date", () => {
    expect(heroOf(colgate().verdict, { undecided: [] }, judgementFor(colgate()))).toEqual({
      tone: "warn",
      eyebrow: "Ostatnia znana cena",
      shops: "w Rossmannie",
      price: 11.49,
      sub: "2 dni temu · cena może być nieaktualna",
      sticker: "stale",
    });
  });

  it.each<{ verdict: PriceVerdict; eyebrow: string }>([
    { verdict: { kind: "unread", at: RENDERED_AT }, eyebrow: "Nie udało się wczytać cen" },
    { verdict: { kind: "none", at: RENDERED_AT }, eyebrow: "Jeszcze bez ceny" },
  ])("names no shop and no price when the verdict is $verdict.kind", ({ verdict, eyebrow }) => {
    // Neither is judged (judgementOf).
    expect(heroOf(verdict, { undecided: ["natura"] }, null)).toEqual({
      tone: "plain",
      eyebrow,
      shops: null,
      price: null,
      sub: null,
      sticker: null,
    });
  });
});

describe("trackOf", () => {
  /** Where a value sits on a track whose values run from `min` to `max`, by the handoff's formula. */
  function position(value: number, min: number, max: number): number {
    const span = max - min || 1;
    const pad = 0.22 * span;
    return 6 + ((value - (min - pad)) / (span + 2 * pad)) * 88;
  }

  it("places the handoff's Nivea: Natura 22,99 zł, Rossmann 26,99 zł and Natura's 30-day low of 23,99 zł", () => {
    const { rows, verdict } = nivea();
    const at = (value: number) => expect.closeTo(position(value, 22.99, 26.99), 6) as number;

    const track = trackOf(rows, verdict);

    expect(track).toEqual({
      markers: [
        { shop: "natura", price: priced("22,99 zł"), x: at(22.99) },
        { shop: "rossmann", price: priced("26,99 zł"), x: at(26.99) },
      ],
      band: { from: at(22.99), to: at(26.99) },
      low: { x: at(23.99), label: "najniższa z 30 dni", price: priced("23,99 zł") },
      note: priced("różnica 4,00 zł"),
    });
    // As the handoff draws them, to a tenth of a percent.
    expect(track?.markers.map(({ x }) => x.toFixed(1))).toEqual(["19.4", "80.6"]);
    expect(track?.low?.x.toFixed(1)).toBe("34.7");
  });

  it("draws one shop against its 30-day low, with no band and the age of a stale price", () => {
    const at = (value: number) => expect.closeTo(position(value, 10.99, 11.49), 6) as number;

    expect(trackOf(colgate().rows, colgate().verdict)).toEqual({
      markers: [{ shop: "rossmann", price: priced("11,49 zł"), x: at(11.49) }],
      band: null,
      low: { x: at(10.99), label: "najniższa z 30 dni", price: priced("10,99 zł") },
      note: "cena sprzed 2 dni",
    });
  });

  it("spreads equal prices over a span of 1 zł, and takes a tie's lowest 30-day low", () => {
    const tie = judged([
      { shop: "rossmann", latest: checkOf(16.99) },
      { shop: "natura", latest: checkOf(16.99, { lowestPrice30d: 15.99 }) },
    ]);
    expect(trackOf(tie.rows, tie.verdict)).toMatchObject({ low: { price: priced("15,99 zł") }, note: null });

    const equal = judged([
      { shop: "rossmann", latest: checkOf(16.99) },
      { shop: "natura", latest: checkOf(16.99) },
    ]);
    const x = expect.closeTo(position(16.99, 16.99, 16.99), 6) as number;
    expect(trackOf(equal.rows, equal.verdict)).toEqual({
      markers: [
        { shop: "rossmann", price: priced("16,99 zł"), x },
        { shop: "natura", price: priced("16,99 zł"), x },
      ],
      band: { from: x, to: x },
      low: null,
      note: null,
    });
  });

  it.each<{ why: string; judgement: () => ReturnType<typeof judged> }>([
    { why: "one shop's price without a 30-day low", judgement: ziaja },
    {
      why: "a price that couldn't be read beside the other shop's",
      judgement: () =>
        judged(
          [
            { shop: "rossmann", latest: checkOf(26.99, { lowestPrice30d: 20.99 }) },
            { shop: "natura", latest: null },
          ],
          true,
        ),
    },
    {
      why: "no price at all",
      judgement: () =>
        judged([
          { shop: "rossmann", latest: null },
          { shop: "natura", latest: null },
        ]),
    },
  ])("hides the track with fewer than two values: $why", ({ judgement }) => {
    const { rows, verdict } = judgement();

    expect(trackOf(rows, verdict)).toBeNull();
  });

  it("draws the only shop against its 30-day low, without a note", () => {
    const { rows, verdict } = judged([{ shop: "rossmann", latest: checkOf(12.99, { lowestPrice30d: 11.99 }) }]);

    expect(trackOf(rows, verdict)).toMatchObject({ band: null, low: { price: priced("11,99 zł") }, note: null });
  });
});

// The sentences below are the owner's of 2026-10-06 (context/archive/2026-10-06-good-price-judgement/plan.md,
// Phase 3), written out whole, with the no-break space Intl writes before "zł", never put together as the rule puts
// them.
describe("trackHint", () => {
  /**
   * What the price track's card says of these prices, beside the matched shops still to match, for a product added at
   * `addedAt`: by their verdict and its judgement, as the product area passes them.
   */
  function hintOf(
    { rows, verdict }: Judged,
    { undecided = [], addedAt = ADDED_RECENTLY }: { undecided?: MatchableShop[]; addedAt?: string } = {},
  ): string | null {
    return trackHint(verdict, { undecided }, judgementOf(verdict, rows, addedAt, RENDERED_AT));
  }

  /** What the price track's card says of the island's state, for a product added the day before, as the view says it. */
  function hintOfState(state: PriceComparisonState): string | null {
    return trackHint(verdictOfState(state), { undecided: [] }, judgementOfState(state, ADDED_RECENTLY));
  }

  it.each<{ why: string; prices: () => Judged; hint: string }>([
    {
      why: "below it, as the handoff's Nivea",
      prices: nivea,
      hint: "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.",
    },
    {
      why: "equal to it, as the handoff's Isana",
      prices: isana,
      hint: "Równa najniższej cenie z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.",
    },
    {
      why: "above it, naming it",
      prices: () => inNatura({ low: 15.99 }),
      hint: priced(
        "Powyżej najniższej ceny z 30 dni wg sklepu (15,99 zł). Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.",
      ),
    },
  ])("judges the cheapest price against its shop's 30-day low while the history is short: $why", ({ prices, hint }) => {
    expect(hintOf(prices())).toBe(hint);
  });

  it.each<{ why: string; low: number; hint: string }>([
    { why: "below it", low: 17.99, hint: "Poniżej najniższej ceny z 30 dni wg sklepu." },
    { why: "equal to it", low: 16.99, hint: "Równa najniższej cenie z 30 dni wg sklepu." },
    { why: "above it", low: 15.99, hint: priced("Powyżej najniższej ceny z 30 dni wg sklepu (15,99 zł).") },
  ])("doesn't say the history is too short while a shop's history wasn't read: $why", ({ low, hint }) => {
    // Rossmann's check came without its history, as a shop's answer does after the page couldn't read its stored price.
    expect(hintOf(inNatura({ low, rossmannHistory: null }))).toBe(hint);
  });

  it("says the history is too short beside a shop never checked, which had no price before today", () => {
    const prices = judged([
      { shop: "rossmann", latest: null },
      { shop: "natura", latest: checkOf(16.99, { lowestPrice30d: 17.99 }) },
    ]);

    expect(hintOf(prices)).toBe(
      "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.",
    );
  });

  it("says the history is too short once shops never checked answer, but not once they answer after a failed read", () => {
    // Natura answers 16,99 zł, below the 17,99 zł it declares as its 30-day low, and Rossmann 26,49 zł.
    const answers = [
      start("rossmann"),
      start("natura"),
      done("rossmann", priceAnswer(26.49), ANSWERED_AT),
      done(
        "natura",
        { kind: "price", offer: { ...offer(16.99), lowestPrice30d: 17.99 }, checkedAt: CHECKED_AT, saved: true },
        ANSWERED_AT + 1,
      ),
    ];
    // The page read both items without any check, so neither had a price before today.
    const neverChecked = run(initialState({ shops: [rossmann(null), natura(null)], now: RENDERED }), ...answers);
    // The page couldn't read the stored prices, so neither item's history was read.
    const failedRead = run(
      initialState({ shops: [rossmann(null), natura(null)], now: RENDERED, pricesFailed: true }),
      ...answers,
    );

    expect(hintOfState(neverChecked)).toBe(
      "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu.",
    );
    expect(hintOfState(failedRead)).toBe("Poniżej najniższej ceny z 30 dni wg sklepu.");
  });

  it("says nothing of the history's length when nothing compares after a failed read", () => {
    // Both shops answer, and neither declares a 30-day low, but the page couldn't read the stored prices, so the
    // history, however long, wasn't read.
    const failedRead = run(
      initialState({ shops: [rossmann(null), natura(null)], now: RENDERED, pricesFailed: true }),
      start("rossmann"),
      start("natura"),
      done("rossmann", priceAnswer(26.49), ANSWERED_AT),
      done("natura", priceAnswer(16.99), ANSWERED_AT + 1),
    );

    expect(hintOfState(failedRead)).toBe("Nie ma z czym porównać: Natura nie podaje najniższej ceny z 30 dni.");
  });

  it.each<{ why: string; low: number; hint: string }>([
    { why: "below its lowest", low: 17.49, hint: "Najniższa cena w Twoich sklepach od 30 dni." },
    { why: "equal to its lowest", low: 16.99, hint: "Równa najniższej cenie w Twoich sklepach z ostatnich 30 dni." },
    {
      why: "above its lowest, naming it",
      low: 15.99,
      hint: priced("W ostatnich 30 dniach było taniej w Twoich sklepach: 15,99 zł."),
    },
  ])("judges the cheapest price against the product's own 30 days once they count: $why", ({ low, hint }) => {
    // Natura declares a 30-day low of 17,99 zł, above every history low here, so the history is the lower comparison.
    const prices = inNatura({ low: 17.99, history: { low, days: FIVE_DAYS } });

    expect(hintOf(prices, { addedAt: ADDED_LONG_AGO })).toBe(hint);
  });

  it("judges against the lower 30-day low its shop declares once the history counts, never calling it short", () => {
    // The history's lowest is 17,49 zł, but Natura declares 16,49 zł, so 16,99 zł is above what the shop states.
    const prices = inNatura({ low: 16.49, history: { low: 17.49, days: FIVE_DAYS } });

    expect(hintOf(prices, { addedAt: ADDED_LONG_AGO })).toBe(
      priced("Powyżej najniższej ceny z 30 dni wg sklepu (16,49 zł)."),
    );
  });

  it("never judges by the product's own 30 days while a shop's history wasn't read", () => {
    // Natura's history alone counts, but Rossmann's check came without its history, which may have held a lower price.
    const prices = inNatura({ low: 17.99, history: { low: 15.99, days: FIVE_DAYS }, rossmannHistory: null });

    expect(hintOf(prices, { addedAt: ADDED_LONG_AGO })).toBe("Poniżej najniższej ceny z 30 dni wg sklepu.");
  });

  it.each<{ why: string; prices: () => Judged; hint: string }>([
    {
      why: "the cheapest shop declares no 30-day low, though a dearer one does",
      prices: () =>
        judged([
          { shop: "rossmann", latest: checkOf(26.99, { lowestPrice30d: 19.99 }) },
          { shop: "natura", latest: checkOf(16.99) },
        ]),
      hint: "Nie ma z czym porównać: Natura nie podaje najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka.",
    },
    {
      why: "neither shop of a tie declares one",
      prices: () =>
        judged([
          { shop: "rossmann", latest: checkOf(16.99) },
          { shop: "natura", latest: checkOf(16.99) },
        ]),
      hint: "Nie ma z czym porównać: Rossmann i Natura nie podają najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka.",
    },
  ])("says there's nothing to compare with, and why, when $why", ({ prices, hint }) => {
    expect(hintOf(prices())).toBe(hint);
  });

  it.each<{ why: string; prices: () => Judged; undecided: MatchableShop[]; hint: string }>([
    {
      why: "the only price without a 30-day low, while Natura waits",
      prices: ziaja,
      undecided: ["natura"],
      hint: "Nie ma z czym porównać: Rossmann nie podaje najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka. Dopasuj produkt w Naturze, aby porównać ceny.",
    },
    {
      why: "the only price without a 30-day low, once Natura is decided",
      prices: ziaja,
      undecided: [],
      hint: "Nie ma z czym porównać: Rossmann nie podaje najniższej ceny z 30 dni, a historia cen jest jeszcze za krótka.",
    },
    {
      why: "the only price below its 30-day low, while Natura and Hebe wait",
      prices: () => judged([{ shop: "rossmann", latest: checkOf(12.99, { lowestPrice30d: 13.49 }) }]),
      undecided: ["natura", "hebe"],
      hint: "Poniżej najniższej ceny z 30 dni wg sklepu. Historia Twoich cen jest jeszcze za krótka, więc porównujemy z danymi sklepu. Dopasuj produkt w Naturze i w Hebe, aby porównać ceny.",
    },
    {
      why: "a stale price, never judged, though its shop declares a 30-day low",
      prices: colgate,
      undecided: ["natura"],
      hint: "Odśwież ceny, aby sprawdzić aktualną cenę.",
    },
  ])("gives the judgement, then what the product needs: $why", ({ prices, undecided, hint }) => {
    expect(hintOf(prices(), { undecided })).toBe(hint);
  });

  it.each<{ why: string; prices: () => Judged }>([
    {
      why: "a price that can't be ordered online",
      prices: () => judged([{ shop: "rossmann", latest: checkOf(26.99, { lowestPrice30d: 27.99, available: false }) }]),
    },
    {
      why: "a price that couldn't be read beside another",
      prices: () =>
        judged(
          [
            { shop: "rossmann", latest: checkOf(26.99, { lowestPrice30d: 27.99 }) },
            { shop: "natura", latest: null },
          ],
          true,
        ),
    },
    {
      why: "no price",
      prices: () =>
        judged([
          { shop: "rossmann", latest: null },
          { shop: "natura", latest: null },
        ]),
    },
  ])("says nothing for $why, which isn't judged", ({ prices }) => {
    expect(hintOf(prices(), { undecided: ["natura"] })).toBeNull();
  });
});

describe("checkedCaption", () => {
  // Rossmann checked 20 minutes before the page was rendered, and Natura 5 minutes before.
  const both = () =>
    initialState({
      shops: [
        rossmann(stored("rossmann", "26900", 26.99, 20 * MINUTE)),
        natura(stored("natura", "NV89063", 22.99, 5 * MINUTE)),
      ],
      now: RENDERED,
    });

  it("gives the oldest check of the shops", () => {
    const state = both();

    expect(checkedCaption(state.rows, state.now)).toBe("sprawdzono 20 min temu");
  });

  it("leaves out a shop never checked", () => {
    const checked = rossmann(stored("rossmann", "26900", 26.99, 5 * MINUTE));
    const neverChecked = initialState({ shops: [checked, natura(null)], now: RENDERED });

    expect(checkedCaption(neverChecked.rows, RENDERED_AT)).toBe("sprawdzono 5 min temu");
  });

  it("says no shop was checked yet only when none was and every price was read", () => {
    const state = initialState({ shops: [rossmann(null), natura(null)], now: RENDERED });

    expect(checkedCaption(state.rows, RENDERED_AT)).toBe("jeszcze nie sprawdzono");
    expect(checkedCaption([], RENDERED_AT)).toBe("jeszcze nie sprawdzono");
  });

  it("moves on once a refetch replaces the oldest check, and stays when a refetch stored nothing", () => {
    const failed = run(
      both(),
      start("rossmann"),
      done("rossmann", { kind: "unavailable", reason: "failed" }, ANSWERED_AT),
    );
    expect(checkedCaption(failed.rows, failed.now)).toBe("sprawdzono 20 min temu");

    const answered = run(both(), start("rossmann"), done("rossmann", priceAnswer(26.49), ANSWERED_AT));
    expect(checkedCaption(answered.rows, answered.now)).toBe("sprawdzono 5 min temu");
  });
});

describe("when a shop's stored price couldn't be read", () => {
  // Rossmann checked 5 minutes before the page was rendered; Natura's check couldn't be read, and may be older.
  const checked = () => rossmann(stored("rossmann", "26900", 26.99, 5 * MINUTE));
  const unreadNatura = () => ({ ...natura(null), readFailed: true });

  it.each<{ why: string; state: () => PriceComparisonState }>([
    {
      why: "the page couldn't read the stored prices at all",
      state: () => initialState({ shops: [rossmann(), natura()], now: RENDERED, pricesFailed: true }),
    },
    {
      why: "the failed read handed over no price",
      state: () => initialState({ shops: [rossmann(null), natura(null)], now: RENDERED, pricesFailed: true }),
    },
    {
      why: "one shop's price couldn't be read beside one that was checked",
      state: () => initialState({ shops: [checked(), unreadNatura()], now: RENDERED }),
    },
    {
      why: "one shop's price couldn't be read beside one never checked",
      state: () => initialState({ shops: [rossmann(null), unreadNatura()], now: RENDERED }),
    },
    {
      why: "the unread shop's refetch came to nothing",
      state: () =>
        run(
          initialState({ shops: [checked(), unreadNatura()], now: RENDERED }),
          start("natura"),
          done("natura", { kind: "unavailable", reason: "failed" }, ANSWERED_AT),
        ),
    },
  ])("says the checks couldn't be read, never an age or never checked, when $why", ({ state }) => {
    const { rows, now } = state();

    expect(checkedCaption(rows, now)).toBe("nie udało się wczytać");
    // The phone's bar writes it under "Sprawdzono", as it writes an age.
    expect(checkedAge(rows, now)).toBe("nie udało się wczytać");
  });

  it("gives the oldest check again once the unread shop has answered", () => {
    const answered = run(
      initialState({ shops: [checked(), unreadNatura()], now: RENDERED }),
      start("natura"),
      done("natura", priceAnswer(16.99), ANSWERED_AT),
    );

    expect(checkedCaption(answered.rows, answered.now)).toBe("sprawdzono 5 min temu");
    expect(checkedAge(answered.rows, answered.now)).toBe("5 min temu");
  });
});

describe("checkedAge", () => {
  it("gives the caption's check without its word, for the phone's bar to write under it", () => {
    const state = initialState({
      shops: [rossmann(stored("rossmann", "26900", 26.99, 20 * MINUTE)), natura(null)],
      now: RENDERED,
    });

    expect(checkedAge(state.rows, state.now)).toBe("20 min temu");
    expect(checkedCaption(state.rows, state.now)).toBe(`sprawdzono ${checkedAge(state.rows, state.now) ?? ""}`);
  });

  it("gives none when no shop was checked and every price was read, so the bar gives the caption", () => {
    const never = initialState({ shops: [rossmann(null), natura(null)], now: RENDERED });

    expect(checkedAge(never.rows, RENDERED_AT)).toBeNull();
    expect(checkedAge([], RENDERED_AT)).toBeNull();
  });
});

describe("verdictOfState", () => {
  it("judges the rows at the state's time, as comparisonOf compares them", () => {
    const state = initialState({ shops: [rossmann(), natura(stored("natura", "NV89063", 22.99))], now: RENDERED });

    expect(verdictOfState(state)).toEqual({
      kind: "cheapest",
      shops: ["natura"],
      price: 22.99,
      ageFrom: ago(20 * MINUTE),
      savings: { amount: 4, than: "rossmann" },
      at: RENDERED_AT,
    });
  });

  it("names no shop while a row's stored price is unread, and names the cheapest once that shop answered", () => {
    // Rossmann's fresh price would be the only one, but Natura's, which may be lower, couldn't be read.
    const before = initialState({ shops: [rossmann(), { ...natura(null), readFailed: true }], now: RENDERED });
    expect(verdictOfState(before)).toEqual({ kind: "unread", at: RENDERED_AT });

    const answered = run(before, start("natura"), done("natura", priceAnswer(16.99), ANSWERED_AT));
    expect(verdictOfState(answered)).toMatchObject({ kind: "cheapest", shops: ["natura"], at: ANSWERED_AT });
  });

  it("is unread on every price when the page couldn't read the stored prices, until each shop answers", () => {
    const state = initialState({ shops: [rossmann(null), natura(null)], now: RENDERED, pricesFailed: true });
    const oneAnswered = run(state, start("rossmann"), done("rossmann", priceAnswer(26.49), ANSWERED_AT));

    expect(verdictOfState(state).kind).toBe("unread");
    expect(verdictOfState(oneAnswered).kind).toBe("unread");
  });

  it("is unread while Natura's match couldn't be read, beside Rossmann's fresh price, even after Rossmann answers", () => {
    // Without the match there's no Natura row, and Rossmann's price would read as the only one.
    const read = initialState({ shops: [rossmann()], now: RENDERED });
    const state = initialState({ shops: [rossmann()], now: RENDERED, unreadable: ["natura"] });
    const answered = run(state, start("rossmann"), done("rossmann", priceAnswer(26.49), ANSWERED_AT));

    expect(verdictOfState(read)).toMatchObject({ kind: "only", shop: "rossmann" });
    expect(verdictOfState(state)).toEqual({ kind: "unread", at: RENDERED_AT });
    expect(verdictOfState(answered)).toEqual({ kind: "unread", at: ANSWERED_AT });
    expect(initialState({ shops: [rossmann()], now: RENDERED, unreadable: [] })).toEqual(read);
  });
});

describe("a matched shop's decision that couldn't be read, beside two priced shops", () => {
  // Rossmann's 26,99 zł and Natura's 16,99 zł are both fresh, but Hebe's decision couldn't be read: a match it hides
  // has no row at all, and may name a lower price.
  const beside = (unreadable: MatchableShop[]) =>
    initialState({
      shops: [rossmann(), natura(stored("natura", "NV89063", 16.99))],
      now: RENDERED,
      unreadable,
    });

  it("names no shop cheapest while Hebe's decision is unread, in the rows, the summary and the verdict", () => {
    expect(marks(beside([]))).toEqual([
      ["natura", true],
      ["rossmann", false],
    ]);

    const state = beside(["hebe"]);

    expect(marks(state)).toEqual([
      ["natura", false],
      ["rossmann", false],
    ]);
    expect(comparisonOf(state).summary).toEqual({ kind: "none" });
    expect(verdictOfState(state)).toEqual({ kind: "unread", at: RENDERED_AT });
  });

  it("says no shop is the cheapest aloud while Hebe's decision is unread, after a shop's answer too", () => {
    const answered = (unreadable: MatchableShop[]) =>
      run(beside(unreadable), start("natura"), done("natura", priceAnswer(15.99), ANSWERED_AT)).announcements;

    expect(answered([])).toEqual([`Natura: 15,99${NO_BREAK_SPACE}zł, najtaniej`]);
    expect(answered(["hebe"])).toEqual([`Natura: 15,99${NO_BREAK_SPACE}zł`]);
  });

  it("keeps the unread decision through every refetch, since the island never reads the decisions again", () => {
    const state = run(
      beside(["hebe"]),
      start("rossmann"),
      start("natura"),
      done("rossmann", priceAnswer(26.49), ANSWERED_AT),
      done("natura", priceAnswer(15.99), ANSWERED_AT + 1),
      tick(ANSWERED_AT + 2),
    );

    expect(state.unreadable).toEqual(["hebe"]);
    expect(marks(state)).toEqual([
      ["natura", false],
      ["rossmann", false],
    ]);
  });
});

describe("a match that changed under the page", () => {
  it("names Hebe when Hebe's refetch finds its match changed", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("hebe"),
      done("hebe", { kind: "match-changed" }, ANSWERED_AT),
    );

    expect(state.matchChanged).toEqual(["hebe"]);
    expect(matchChangedText(state.matchChanged)).toBe("Dopasowanie w Hebe się zmieniło.");
    // The page's alert says it, so the live region doesn't.
    expect(state.announcements).toEqual([]);
  });

  it("names each shop whose match changed once, in the order their answers came, agreeing in number", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura()], now: RENDERED }),
      start("natura"),
      start("hebe"),
      done("natura", { kind: "match-changed" }, ANSWERED_AT),
      done("hebe", { kind: "match-changed" }, ANSWERED_AT + 1),
      done("natura", { kind: "match-changed" }, ANSWERED_AT + 2),
    );

    expect(state.matchChanged).toEqual(["natura", "hebe"]);
    expect(matchChangedText(state.matchChanged)).toBe("Dopasowania w Naturze i w Hebe się zmieniły.");
  });
});

describe("trackLabels", () => {
  // A marker at a place along the track, its price written out as the pages write it.
  const at = (shop: PricedShop, x: number, amount: number): TrackMarker => ({
    shop,
    price: `${amount.toFixed(2).replace(".", ",")}${NO_BREAK_SPACE}zł`,
    x,
  });
  // Each label as the shops it names and the side it sits on.
  const sides = (labels: TrackLabel[]) => labels.map(({ shops, side }) => [shops, side]);
  const labelsOf = ({ rows, verdict }: ReturnType<typeof judged>) => trackLabels(trackOf(rows, verdict)?.markers ?? []);

  it("centres the labels of markers far apart, as the handoff's Nivea draws them", () => {
    expect(sides(labelsOf(nivea()))).toEqual([
      [["natura"], "center"],
      [["rossmann"], "center"],
    ]);
  });

  it("turns the labels of close markers away from each other, whichever comes first", () => {
    const close = [at("rossmann", 76.2, 19.99), at("natura", 80.6, 20.49)];

    expect(sides(trackLabels(close))).toEqual([
      [["rossmann"], "end"],
      [["natura"], "start"],
    ]);
    expect(sides(trackLabels(close.toReversed()))).toEqual([
      [["rossmann"], "end"],
      [["natura"], "start"],
    ]);
    // 30 % apart is far enough.
    expect(sides(trackLabels([at("rossmann", 20, 15.99), at("natura", 50, 19.99)]))).toEqual([
      [["rossmann"], "center"],
      [["natura"], "center"],
    ]);
  });

  it("sets the labels of two equal prices side by side, in the markers' order, each with its price", () => {
    const labels = labelsOf(
      judged([
        { shop: "rossmann", latest: checkOf(16.99) },
        { shop: "natura", latest: checkOf(16.99) },
      ]),
    );

    expect(sides(labels)).toEqual([
      [["rossmann"], "end"],
      [["natura"], "start"],
    ]);
    expect(labels.map(({ price }) => price)).toEqual([`16,99${NO_BREAK_SPACE}zł`, `16,99${NO_BREAK_SPACE}zł`]);
  });

  it("gives three equal prices one label: every name in the markers' order, then the price once", () => {
    const { rows, verdict } = judged([
      { shop: "rossmann", latest: checkOf(16.99) },
      { shop: "natura", latest: checkOf(16.99) },
      { shop: "hebe", latest: checkOf(16.99) },
    ]);
    const markers = trackOf(rows, verdict)?.markers ?? [];

    expect(trackLabels(markers)).toEqual([
      { shops: markers.map(({ shop }) => shop), price: `16,99${NO_BREAK_SPACE}zł`, x: markers[0].x, side: "center" },
    ]);
  });

  it("keeps three close labels apart, around a centred middle one, while both gaps leave half a label's room", () => {
    expect(sides(trackLabels([at("rossmann", 20, 15.99), at("natura", 45, 17.99), at("hebe", 70, 19.99)]))).toEqual([
      [["rossmann"], "end"],
      [["natura"], "center"],
      [["hebe"], "start"],
    ]);
  });

  it("gives a closer run one label, centred on it: every name left to right, then 'od' the lowest price", () => {
    const run = [at("hebe", 60, 19.99), at("rossmann", 40, 19.97), at("natura", 50, 19.98)];

    expect(trackLabels(run)).toEqual([
      { shops: ["rossmann", "natura", "hebe"], price: `od 19,97${NO_BREAK_SPACE}zł`, x: 50, side: "center" },
    ]);
    // One narrow gap is enough.
    expect(sides(trackLabels([at("rossmann", 20, 15.99), at("natura", 45, 17.99), at("hebe", 55, 18.79)]))).toEqual([
      [["rossmann", "natura", "hebe"], "center"],
    ]);
  });

  it("gives a run of four one label, however wide its gaps", () => {
    const four = [
      at("rossmann", 10, 10.99),
      at("natura", 35, 12.99),
      at("hebe", 60, 14.99),
      at("super-pharm", 85, 16.99),
    ];

    expect(trackLabels(four)).toEqual([
      {
        shops: ["rossmann", "natura", "hebe", "super-pharm"],
        price: `od 10,99${NO_BREAK_SPACE}zł`,
        x: 47.5,
        side: "center",
      },
    ]);
  });

  it("labels each run on its own: a lone marker apart from a close pair", () => {
    expect(sides(trackLabels([at("rossmann", 10, 9.99), at("natura", 70, 19.99), at("hebe", 80, 21.99)]))).toEqual([
      [["rossmann"], "center"],
      [["natura"], "end"],
      [["hebe"], "start"],
    ]);
    expect(trackLabels([])).toEqual([]);
  });
});

describe("markerSteps", () => {
  it("leaves a marker at its own place while no other has its price", () => {
    const { rows, verdict } = nivea();

    expect(markerSteps(trackOf(rows, verdict)?.markers ?? [])).toEqual([0, 0]);
  });

  it("steps markers at the same price aside, in the markers' order, around their shared place", () => {
    const marker = (shop: PricedShop, price: string): TrackMarker => ({ shop, price, x: 50 });

    expect(markerSteps([marker("rossmann", "a"), marker("natura", "a")])).toEqual([-1, 1]);
    expect(markerSteps([marker("rossmann", "a"), marker("natura", "a"), marker("hebe", "a")])).toEqual([-2, 0, 2]);
    expect(markerSteps([marker("rossmann", "a"), marker("natura", "b"), marker("hebe", "a")])).toEqual([-1, 0, 1]);
    expect(markerSteps([])).toEqual([]);
  });
});

describe("PRICES_EVENT", () => {
  it("names the window event whose detail carries the island's rows, which the list's live tag reads", () => {
    const state = run(
      initialState({ shops: [rossmann(), natura(null)], now: RENDERED }),
      start("natura"),
      done("natura", priceAnswer(16.99), ANSWERED_AT),
    );
    const detail: PricesEventDetail = { itemId: ITEM_ID, shops: state.rows };

    expect(PRICES_EVENT).toBe("drogeria:prices");
    // Natura's new price was fetched a second before the answer was applied.
    expect(rowTagOf(detail.shops, state.now)).toEqual({
      tone: "sun",
      price: 16.99,
      label: "Natura",
      meta: "Natura · przed chwilą",
    });
  });
});

describe("rowShopsOfIsland", () => {
  it("gives each row's shop, latest check and read state, and nothing else of the row", () => {
    const state = run(
      initialState({ shops: [rossmann(), { ...natura(null), readFailed: true }], now: RENDERED }),
      start("rossmann"),
    );

    expect(rowShopsOfIsland(state.rows)).toEqual([
      { shop: "rossmann", latest: stored("rossmann", "26900", 26.99), readFailed: false },
      { shop: "natura", latest: null, readFailed: true },
    ]);
  });

  it("adds Natura as a price that couldn't be read while its match couldn't be, so no shop is named", () => {
    const state = initialState({ shops: [rossmann()], now: RENDERED });
    const shops = rowShopsOfIsland(state.rows, ["natura"]);

    expect(shops).toEqual([
      { shop: "rossmann", latest: stored("rossmann", "26900", 26.99), readFailed: false },
      { shop: "natura", latest: null, readFailed: true },
    ]);
    // The list's row would otherwise name Rossmann as the only shop.
    expect(rowTagOf(rowShopsOfIsland(state.rows), RENDERED_AT)).toMatchObject({ label: "Tylko Rossmann" });
    expect(rowTagOf(shops, RENDERED_AT)).toEqual({ tone: "outline", price: null, label: "Błąd odczytu", meta: null });
  });

  it("keeps a Natura row the island has, and adds none", () => {
    const state = initialState({ shops: [rossmann(), natura()], now: RENDERED });

    expect(rowShopsOfIsland(state.rows, ["natura"]).map(({ shop }) => shop)).toEqual(["rossmann", "natura"]);
  });
});

describe("shopsOfPricesEvent and the selected row's tag", () => {
  /** The event the island sends for `itemId` with its rows, as PriceComparison dispatches it. */
  const sent = (itemId: string, shops: PricesEventDetail["shops"]) =>
    new CustomEvent<PricesEventDetail>(PRICES_EVENT, { detail: { itemId, shops } });

  it("recomputes the tag from the rows the island sends, before and after a shop answers", () => {
    const before = initialState({ shops: [rossmann(), natura()], now: RENDERED });
    const after = run(before, start("natura"), done("natura", priceAnswer(16.99), ANSWERED_AT));

    const first = shopsOfPricesEvent(sent(ITEM_ID, rowShopsOfIsland(before.rows)), ITEM_ID);
    const next = shopsOfPricesEvent(sent(ITEM_ID, rowShopsOfIsland(after.rows)), ITEM_ID);

    expect(first).not.toBeNull();
    expect(next).not.toBeNull();
    // Rossmann's stored 26,99 zł beats Natura's stored 29,99 zł, until Natura answers with 16,99 zł; the line under
    // the tag follows, with the new price's shop and age.
    expect(rowTagOf(first ?? [], RENDERED_AT)).toEqual({
      tone: "sun",
      price: 26.99,
      label: "Rossmann",
      meta: "Rossmann · 20 min temu",
    });
    expect(rowTagOf(next ?? [], ANSWERED_AT)).toEqual({
      tone: "sun",
      price: 16.99,
      label: "Natura",
      meta: "Natura · przed chwilą",
    });
  });

  it("ignores an event about another product", () => {
    const state = initialState({ shops: [rossmann()], now: RENDERED });

    expect(shopsOfPricesEvent(sent("another-product", rowShopsOfIsland(state.rows)), ITEM_ID)).toBeNull();
  });

  it("ignores another event, and one without the island's detail", () => {
    expect(shopsOfPricesEvent(new Event(PRICES_EVENT), ITEM_ID)).toBeNull();
    expect(
      shopsOfPricesEvent(new CustomEvent("drogeria:theme", { detail: { itemId: ITEM_ID, shops: [] } }), ITEM_ID),
    ).toBeNull();
    expect(shopsOfPricesEvent(new CustomEvent(PRICES_EVENT, { detail: { itemId: ITEM_ID } }), ITEM_ID)).toBeNull();
    expect(shopsOfPricesEvent(new CustomEvent(PRICES_EVENT, { detail: null }), ITEM_ID)).toBeNull();
  });
});
