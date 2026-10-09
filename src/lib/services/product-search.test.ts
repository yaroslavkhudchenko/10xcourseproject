import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PricedShop } from "@/lib/services/price-comparison";
import {
  entryShopsText,
  onListOf,
  searchEntriesOf,
  searchResultsOf,
  searchShops,
  searchSourcesText,
  shopLinesOf,
  type SearchEntry,
  type SearchOutcomes,
} from "@/lib/services/product-search";
import { createShopGate, type ShopGate, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import { loggedLine, type ServedAnswer } from "@/lib/services/testing/shop-answers";
import { parseWatchlistForm } from "@/lib/services/watchlist";
import type { ProductCandidate, ShopMatchState, WatchlistItem } from "@/types";
import hebeAaLaab from "@/lib/services/shops/fixtures/hebe-search-aa-laab.json";
import hebeNiveaSoft from "@/lib/services/shops/fixtures/hebe-search-nivea-soft.json";
import naturaAaLaab from "@/lib/services/shops/fixtures/natura-search-aa-laab.json";
import naturaNiveaSoft from "@/lib/services/shops/fixtures/natura-search-nivea-soft.json";
import rossmannAaLaab from "@/lib/services/shops/fixtures/rossmann-search-aa-laab.json";
import rossmannMisspelled from "@/lib/services/shops/fixtures/rossmann-search-misspelled.json";
import rossmannNiveaSoft from "@/lib/services/shops/fixtures/rossmann-search-nivea-soft.json";
import superPharmAaLaab from "@/lib/services/shops/fixtures/super-pharm-search-aa-laab.json";
import superPharmNiveaSoft from "@/lib/services/shops/fixtures/super-pharm-search-nivea-soft.json";

// The list's search on the owner's eight recorded answers (add-from-other-shops, research.md "Live evidence"): on
// 2026-10-06 at 10:37:35-10:38:00 UTC, with the owner's approval, the four shops were each asked for „nivea soft” and
// for the owner's „AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający”, from the developer machine, one request
// at a time and 3 s apart, with the gate's User-Agent and `Accept: application/json`, following no redirect, each with
// its adapter's own search request for 10 hits, and each answer kept whole. They are served here through the real gate
// for exactly the four requests the search makes, Super-Pharm's by its POST body, all spelled out as they were sent.
// The expected entries come from the recordings and the owner's calls (change.md), read item by item:
// - „nivea soft”: Rossmann's Nivea Soft 300 ml (26900) shares its first EAN, 4005900009319, its size and its brand with
//   Natura's NV89063, and Super-Pharm's 10132, „Nivea Soft Krem nawilżający (Pudełko)”, has the product's size and only
//   words of its name and caption. Natura's 200 ml (NV890500) shares 4005900008299 with Hebe's 218807, and Natura's
//   Creme Soft shower gel in 500 ml (NV80758) has every word of its name in Super-Pharm's 20461, which has no other.
//   Rossmann's 4,8 g lip balm (11790) and Hebe's 5,5 ml one (742817) share an EAN in another size, and Rossmann's wipes
//   (2079205, „4x57 szt.”, no size) and Natura's (NV74420, 228 pcs) one in an unknown one, so neither joins. Super-Pharm's
//   SPF15 creams have a word Natura's and Rossmann's creams lack, its refill (186276) a word the bottle lacks, and its
//   750 ml gel (20377) lacks Natura's „Kremowy”, so none of them joins.
// - AA LAAB: Rossmann's face wash in 150 ml (419343) shares 5900116091877 with Hebe's 450251, and Super-Pharm's 105870,
//   brand „AA Cosmetics”, which agrees with „AA”, has the size and only words of the product's name and caption, among
//   them every one its caption writes with a capital letter or a digit. Natura's four items each share their EAN and
//   size with a Hebe twin. Hebe's make-up balm in 150 ml (450257) has words the face wash lacks.
// Each shop's search is the first answer of its ranking, so an item no entry holds is only not found in this search.
const QUERY_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";

/** One recorded text: the four requests the search makes for it, spelled out as sent, and each shop's answer. */
interface RecordedSearch {
  query: string;
  urls: Record<PricedShop, string>;
  /** Super-Pharm's search body, whose text, form-encoded, is the only part that changes between the two. */
  superPharmBody: string;
  answers: Record<PricedShop, object>;
}

/** Super-Pharm's search body for the text, form-encoded, as its adapter sends it for 10 hits. */
const superPharmBody = (encodedQuery: string) =>
  `{"params":"query=${encodedQuery}&hitsPerPage=10&analytics=false` +
  "&attributesToRetrieve=name%2Cbrand%2Ccapacity%2Curl%2Cthumbnail_url%2Cprice%2Cin_stock%2CinStoreOnly" +
  '&attributesToHighlight=%5B%5D"}';

const NIVEA_SOFT: RecordedSearch = {
  query: "nivea soft",
  urls: {
    rossmann: "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=10",
    natura: "https://live.luigisbox.com/search?tracker_id=703598-939363&q=nivea%20soft&size=10",
    hebe: "https://live.luigisbox.com/search?tracker_id=421168-505233&q=nivea%20soft&size=10",
    "super-pharm": QUERY_URL,
  },
  superPharmBody: superPharmBody("nivea+soft"),
  answers: {
    rossmann: rossmannNiveaSoft,
    natura: naturaNiveaSoft,
    hebe: hebeNiveaSoft,
    "super-pharm": superPharmNiveaSoft,
  },
};

// The owner's text, encoded as a URL's part and as Algolia's form-encoded body has it.
const AA_LAAB_URL_TEXT = "AA%20LAAB%20100%25%20Centella%20B12%20%C5%BBel%20do%20mycia%20twarzy%20nawil%C5%BCaj%C4%85cy";
const AA_LAAB: RecordedSearch = {
  query: "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający",
  urls: {
    rossmann: `https://www.rossmann.pl/products/v4/api/Products?search=${AA_LAAB_URL_TEXT}&page=1&pageSize=10`,
    natura: `https://live.luigisbox.com/search?tracker_id=703598-939363&q=${AA_LAAB_URL_TEXT}&size=10`,
    hebe: `https://live.luigisbox.com/search?tracker_id=421168-505233&q=${AA_LAAB_URL_TEXT}&size=10`,
    "super-pharm": QUERY_URL,
  },
  superPharmBody: superPharmBody("AA+LAAB+100%25+Centella+B12+%C5%BBel+do+mycia+twarzy+nawil%C5%BCaj%C4%85cy"),
  answers: {
    rossmann: rossmannAaLaab,
    natura: naturaAaLaab,
    hebe: hebeAaLaab,
    "super-pharm": superPharmAaLaab,
  },
};

const SHOPS: PricedShop[] = ["rossmann", "natura", "hebe", "super-pharm"];

/**
 * The replay of a recorded text's four requests, each shop's answer as recorded unless `served` gives another in its
 * place, such as a refusal or an edited copy.
 */
function replayOf(search: RecordedSearch, served: Partial<Record<PricedShop, ServedAnswer>> = {}): ReplayEntry[] {
  return SHOPS.map((shop) => ({
    url: search.urls[shop],
    requestBody: shop === "super-pharm" ? search.superPharmBody : undefined,
    ...(served[shop] ?? { status: 200, body: JSON.stringify(search.answers[shop]) }),
  }));
}

/**
 * A real gate over the replay, whose counter gives each shop's reservation `reservations` names, allowed otherwise.
 * `reserve` shows each slot asked for, `reportBlock` each refusal reported, and `gateLog` the gate's own log lines.
 */
function setup(entries: ReplayEntry[], reservations: Partial<Record<PricedShop, unknown>> = {}) {
  const fetchMock = vi.fn(createReplayFetch(entries));
  const reserve = vi.fn<ShopGateDeps["reserve"]>((shop) =>
    Promise.resolve(shop in reservations ? reservations[shop] : { outcome: "allowed" }),
  );
  const reportBlock = vi.fn<ShopGateDeps["reportBlock"]>(() => Promise.resolve());
  const gateLog = vi.fn<(entry: ShopGateLogEntry) => void>();
  const gate = createShopGate({ reserve, reportBlock, fetch: fetchMock, log: gateLog });
  return { gate, fetchMock, reserve, reportBlock, gateLog };
}

/** Every request the fetch was asked for, its URL and its body, sorted, since the shops are asked at once. */
function requestsOf(fetchMock: Mock<typeof fetch>): string[] {
  return fetchMock.mock.calls
    .map(([input, init]) => {
      const url = input instanceof Request ? input.url : new URL(input).href;
      return typeof init?.body === "string" ? `${url} ${init.body}` : url;
    })
    .sort();
}

/** The requests of a recorded text, as requestsOf reads them, for the shops given. */
function requestsFor(search: RecordedSearch, shops: readonly PricedShop[] = SHOPS): string[] {
  return shops
    .map((shop) => (shop === "super-pharm" ? `${search.urls[shop]} ${search.superPharmBody}` : search.urls[shop]))
    .sort();
}

/** Each entry's items as "shop id", in the entries' order. */
const itemsOf = (entries: readonly SearchEntry[]): string[][] =>
  entries.map((entry) => entry.items.map(({ shop, shopItemId }) => `${shop} ${shopItemId}`));

/** The search for a recorded text, through the real gate, which must ask each shop once for exactly its request. */
async function searchRecorded(search: RecordedSearch): Promise<SearchOutcomes> {
  const { gate, fetchMock, reserve } = setup(replayOf(search));
  const outcomes = await searchShops(gate, search.query);
  expect(requestsOf(fetchMock)).toEqual(requestsFor(search));
  expect(reserve.mock.calls.map(([shop]) => shop).sort()).toEqual([...SHOPS].sort());
  return outcomes;
}

/** The hidden fields `SearchResults.astro` renders in an entry's "Dodaj" form. */
function dodajForm(product: ProductCandidate): FormData {
  const form = new FormData();
  form.append("source", product.source);
  form.append("sourceItemId", product.sourceItemId);
  form.append("name", product.name);
  form.append("brand", product.brand ?? "");
  form.append("caption", product.caption ?? "");
  form.append("sizeText", product.sizeText ?? "");
  form.append("productUrl", product.productUrl ?? "");
  form.append("imageUrl", product.imageUrl ?? "");
  for (const ean of product.eans) {
    form.append("eans", ean);
  }
  return form;
}

/** A listed product, as the list reads it, made up but for its shop and its own item there. */
function listed(n: number, source: WatchlistItem["source"], sourceItemId: string): WatchlistItem {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    source,
    sourceItemId,
    brand: null,
    name: "Produkt",
    caption: null,
    sizeText: null,
    size: null,
    imageUrl: null,
    addedAt: "2026-10-01T08:00:00.000Z",
  };
}

/** A listed product's match in a shop, as the list reads it. */
const matchOf = (product: WatchlistItem, shop: PricedShop, shopItemId: string): ShopMatchState => ({
  watchlistItemId: product.id,
  shop,
  state: "matched",
  shopItemId,
  brand: null,
  size: null,
  decidedBy: "user",
});

// The entries the two recorded texts come to, each as its items' shops and ids, in the entries' order.
const NIVEA_SOFT_ENTRIES = [
  ["rossmann 26900", "natura NV89063", "super-pharm 10132"],
  ["rossmann 2126586"],
  ["rossmann 2103263"],
  ["rossmann 11790"],
  ["rossmann 2079205"],
  ["natura NV890500", "hebe 000000000000218807"],
  ["natura NV80758", "super-pharm 20461"],
  ["natura NV89059"],
  ["natura NV19891"],
  ["natura NV84067"],
  ["natura NV18540"],
  ["natura NV74420"],
  ["natura NV80643"],
  ["hebe 000000000000742817"],
  ["hebe 000000000000218607"],
  ["super-pharm 145460"],
  ["super-pharm 145461"],
  ["super-pharm 10139"],
  ["super-pharm 122310"],
  ["super-pharm 122353"],
  ["super-pharm 20377"],
  ["super-pharm 186276"],
  ["super-pharm 163025"],
];
const AA_LAAB_ENTRIES = [
  ["rossmann 2132081"],
  ["rossmann 419343", "hebe 000000000000450251", "super-pharm 105870"],
  ["natura OC91938", "hebe 000000000000450259"],
  ["natura OC04980", "hebe 000000000000576736"],
  ["natura OC91907", "hebe 000000000000450258"],
  ["natura OC04966", "hebe 000000000000576729"],
  ["hebe 000000000000475881"],
  ["hebe 000000000000450257"],
  ["hebe 000000000000475880"],
  ["hebe 000000000000450256"],
  ["hebe 000000000000764646"],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchShops and searchEntriesOf: the recorded texts", () => {
  it("joins „nivea soft”'s items into one entry per product, the shops in their order and each shop's in its own", async () => {
    const outcomes = await searchRecorded(NIVEA_SOFT);

    expect(itemsOf(searchEntriesOf(outcomes))).toEqual(NIVEA_SOFT_ENTRIES);
    expect(shopLinesOf(outcomes).map(({ text }) => text)).toEqual([
      "Rossmann: 5 wyników",
      "Natura: 9 wyników",
      "Hebe: 3 wyniki",
      "Super-Pharm: 10 wyników",
    ]);
  });

  it("joins the AA LAAB face wash from three shops, and four Natura items with their Hebe twins", async () => {
    const outcomes = await searchRecorded(AA_LAAB);

    expect(itemsOf(searchEntriesOf(outcomes))).toEqual(AA_LAAB_ENTRIES);
    expect(shopLinesOf(outcomes).map(({ text }) => text)).toEqual([
      "Rossmann: 2 wyniki",
      "Natura: 4 wyniki",
      "Hebe: 10 wyników",
      "Super-Pharm: 1 wynik",
    ]);
  });

  it.each([
    {
      why: "a shared EAN in another size: Rossmann's 4,8 g lip balm and Hebe's 5,5 ml",
      search: NIVEA_SOFT,
      alone: ["rossmann 11790", "hebe 000000000000742817"],
    },
    {
      why: "a shared EAN beside a size Rossmann's wipes don't state: its „4x57 szt.” and Natura's 228 pieces",
      search: NIVEA_SOFT,
      alone: ["rossmann 2079205", "natura NV74420"],
    },
    {
      why: "Super-Pharm's SPF15 creams, a word Natura's and Rossmann's creams of their sizes lack",
      search: NIVEA_SOFT,
      alone: ["super-pharm 145460", "super-pharm 145461", "rossmann 2103263", "natura NV89059"],
    },
    {
      why: "the shower gel's refills, whose words the bottles lack",
      search: NIVEA_SOFT,
      alone: ["natura NV84067", "super-pharm 186276"],
    },
    {
      why: "Super-Pharm's 750 ml shower gel, without Natura's „Kremowy”",
      search: NIVEA_SOFT,
      alone: ["natura NV18540", "super-pharm 20377"],
    },
    {
      why: "Hebe's make-up balm in the face wash's size, whose name isn't the face wash's",
      search: AA_LAAB,
      alone: ["hebe 000000000000450257"],
    },
  ])("joins nothing on a look-alike: $why", async ({ search, alone }) => {
    const entries = itemsOf(searchEntriesOf(await searchRecorded(search)));

    for (const item of alone) {
      expect(entries).toContainEqual([item]);
    }
  });

  it("names each entry's shops in their order", async () => {
    const entries = searchEntriesOf(await searchRecorded(NIVEA_SOFT));

    expect(entries.slice(0, 7).map(entryShopsText)).toEqual([
      "Rossmann · Natura · Super-Pharm",
      "Rossmann",
      "Rossmann",
      "Rossmann",
      "Rossmann",
      "Natura · Hebe",
      "Natura · Super-Pharm",
    ]);
  });
});

describe("searchEntriesOf: what „Dodaj” adds", () => {
  it("adds the first shop's item: Rossmann's with its caption, any other's without one", async () => {
    const entries = searchEntriesOf(await searchRecorded(NIVEA_SOFT));
    const productOf = (item: string) => entries.find((entry) => itemsOf([entry])[0][0] === item)?.product;

    expect(productOf("rossmann 26900")).toEqual({
      source: "rossmann",
      sourceItemId: "26900",
      brand: "NIVEA",
      name: "Soft",
      caption: "krem do twarzy, ciała i dłoni, nawilżający",
      sizeText: "300 ml",
      size: { value: 300, unit: "ml" },
      eans: ["4005900009319", "4005808890637", "5900017001234"],
      productUrl:
        "https://www.rossmann.pl/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-do-twarzy-ciala-i-dloni-nawilzajacy-300-ml,26900,13049",
      imageUrl: "https://pro-fra-s3-productsassets.rossmann.pl/product_1_medium/26900_360_350_1790938776.webp",
    });
    expect(productOf("natura NV890500")).toEqual({
      source: "natura",
      sourceItemId: "NV890500",
      brand: "NIVEA",
      name: "NIVEA SOFT krem intensywnie nawilżający 200 ml",
      caption: null,
      sizeText: "200 ml",
      size: { value: 200, unit: "ml" },
      eans: ["4005900008299"],
      productUrl: "https://drogerienatura.pl/produkt/nivea-soft-krem-intensywnie-nawilzajacy-200-ml-4005900008299",
      imageUrl:
        "https://media.drogerienatura.pl/catalog/product/4/0/4005900008299_T1_928d.jpg?store=default&image-type=image",
    });
    expect(productOf("hebe 000000000000742817")).toEqual({
      source: "hebe",
      sourceItemId: "000000000000742817",
      brand: "Nivea",
      name: "Nivea Soft Rose Pielęgnująca pomadka do ust 5,5 ml",
      caption: null,
      sizeText: "5,5 ml",
      size: { value: 5.5, unit: "ml" },
      eans: ["9005800362939"],
      productUrl: "https://www.hebe.pl/nivea-pielegnujaca-pomadka-do-ust-55-ml-000000000000742817.html",
      imageUrl:
        "https://www.hebe.pl/dw/image/v2/BDDS_PRD/on/demandware.static/-/Sites-PL_Master_Catalog/default/dw1f3de17b/" +
        "images/hi-res/742817__Nivea_Soft_Rose_Pielegnujaca_pomadka_do_ust_55_ml__BB__1__p.png",
    });
    // Super-Pharm's record has no `capacity`, so its size is the one its name ends with; its index holds no EAN.
    expect(productOf("super-pharm 145460")).toEqual({
      source: "super-pharm",
      sourceItemId: "145460",
      brand: "Nivea",
      name: "Nivea Soft Krem Intensywnie nawilżający SPF15, 200ml",
      caption: null,
      sizeText: "200 ml",
      size: { value: 200, unit: "ml" },
      eans: [],
      productUrl: "https://www.superpharm.pl/nivea-soft-krem-intensywnie-nawilzajacy-spf15-200ml-208877",
      imageUrl:
        "https://media.superpharm.eu/media/catalog/product/cache/c67a6870c5ebea7eb5ebe1ca04d0c8c1/1/6/16088951_T1.jpg",
    });
  });

  it.each([NIVEA_SOFT, AA_LAAB])(
    "posts every entry's product of „$query” the way the page does, and „Dodaj” takes it as it is",
    async (search) => {
      const entries = searchEntriesOf(await searchRecorded(search));

      expect(entries.length).toBeGreaterThan(0);
      for (const { product } of entries) {
        expect(parseWatchlistForm(dodajForm(product)), `${product.source} ${product.sourceItemId}`).toEqual(product);
      }
    },
  );

  it("adds Natura's item for the entry Natura's search finds first while Rossmann gives no answer", async () => {
    const { gate, fetchMock } = setup(replayOf(NIVEA_SOFT, { rossmann: { status: 502 } }));

    const outcomes = await searchShops(gate, NIVEA_SOFT.query);

    expect(requestsOf(fetchMock)).toEqual(requestsFor(NIVEA_SOFT));
    const entries = searchEntriesOf(outcomes);
    // Without Rossmann's caption, Natura's 300 ml cream, „intensywnie” in its name, doesn't take Super-Pharm's.
    expect(itemsOf(entries)).toEqual([
      ["natura NV89063"],
      ["natura NV890500", "hebe 000000000000218807"],
      ["natura NV80758", "super-pharm 20461"],
      ["natura NV89059"],
      ["natura NV19891"],
      ["natura NV84067"],
      ["natura NV18540"],
      ["natura NV74420"],
      ["natura NV80643"],
      ["hebe 000000000000742817"],
      ["hebe 000000000000218607"],
      ["super-pharm 10132"],
      ["super-pharm 145460"],
      ["super-pharm 145461"],
      ["super-pharm 10139"],
      ["super-pharm 122310"],
      ["super-pharm 122353"],
      ["super-pharm 20377"],
      ["super-pharm 186276"],
      ["super-pharm 163025"],
    ]);
    expect(entries[0].product).toMatchObject({ source: "natura", sourceItemId: "NV89063", caption: null });
    expect(shopLinesOf(outcomes)[0]).toEqual({ shop: "rossmann", text: "Rossmann: nie odpowiada" });
  });
});

describe("searchEntriesOf: an item two entries would take joins neither", () => {
  /** A copy of Natura's „nivea soft” answer with a copy of the hit of `sku` after it, under `copySku` and its EANs. */
  function naturaWithCopy(sku: string, copySku: string, ean: string): string {
    const copy = structuredClone(naturaNiveaSoft) as { results: { hits: Record<string, unknown>[] } };
    const index = copy.results.hits.findIndex((hit) => hit.url === sku);
    const hit = structuredClone(copy.results.hits[index]) as { url: string; attributes: Record<string, unknown> };
    hit.url = copySku;
    hit.attributes.ean = [ean];
    copy.results.hits.splice(index + 1, 0, hit);
    return JSON.stringify(copy);
  }

  it("by the name rule: Super-Pharm's shower gel, which two Natura items of the same name would take", async () => {
    // Natura's 500 ml Creme Soft shower gel twice, under another SKU and EAN.
    const body = naturaWithCopy("NV80758", "NV80759", "5900000000017");
    const { gate, fetchMock } = setup(replayOf(NIVEA_SOFT, { natura: { status: 200, body } }));

    const entries = itemsOf(searchEntriesOf(await searchShops(gate, NIVEA_SOFT.query)));

    expect(requestsOf(fetchMock)).toEqual(requestsFor(NIVEA_SOFT));
    expect(entries).toContainEqual(["natura NV80758"]);
    expect(entries).toContainEqual(["natura NV80759"]);
    // Its own entry, in Super-Pharm's order, after the 2x57 wipes and before the 750 ml gel.
    expect(entries.slice(-4)).toEqual([
      ["super-pharm 20461"],
      ["super-pharm 20377"],
      ["super-pharm 186276"],
      ["super-pharm 163025"],
    ]);
    // The other joins stand.
    expect(entries[0]).toEqual(["rossmann 26900", "natura NV89063", "super-pharm 10132"]);
  });

  it("by a shared EAN: Hebe's 200 ml Nivea Soft, which two Natura items of its EAN would take", async () => {
    // Natura's 200 ml Nivea Soft twice, under another SKU with the same EAN.
    const body = naturaWithCopy("NV890500", "NV890501", "4005900008299");
    const { gate } = setup(replayOf(NIVEA_SOFT, { natura: { status: 200, body } }));

    const entries = itemsOf(searchEntriesOf(await searchShops(gate, NIVEA_SOFT.query)));

    expect(entries).toContainEqual(["natura NV890500"]);
    expect(entries).toContainEqual(["natura NV890501"]);
    // Its own entry, first of Hebe's, after Natura's.
    expect(entries.slice(13, 16)).toEqual([
      ["natura NV80643"],
      ["hebe 000000000000218807"],
      ["hebe 000000000000742817"],
    ]);
  });
});

describe("searchEntriesOf: a name never joins an item of a shop whose items carry EANs", () => {
  it("keeps Natura's 300 ml cream apart from Rossmann's, which the name rule accepts it for once EANs can't decide", async () => {
    // A copy of Rossmann's answer whose Nivea Soft 300 ml (26900) lost its EANs, so EANs can't decide and the name rule
    // judges, and a copy of Natura's whose NV89063 reads without „intensywnie”, so its name holds only words of the
    // Rossmann product's name and caption. The rule accepts it, yet only an EAN the two share would join it.
    const rossmann = structuredClone(rossmannNiveaSoft) as { data: { items: { id: number; eanNumber: string[] }[] } };
    for (const item of rossmann.data.items) {
      if (item.id === 26900) {
        item.eanNumber = [];
      }
    }
    const natura = structuredClone(naturaNiveaSoft) as {
      results: { hits: { url: string; attributes: Record<string, unknown> }[] };
    };
    for (const hit of natura.results.hits) {
      if (hit.url === "NV89063") {
        hit.attributes.title = "NIVEA SOFT krem nawilżający 300 ml";
      }
    }
    const { gate, fetchMock } = setup(
      replayOf(NIVEA_SOFT, {
        rossmann: { status: 200, body: JSON.stringify(rossmann) },
        natura: { status: 200, body: JSON.stringify(natura) },
      }),
    );

    const entries = itemsOf(searchEntriesOf(await searchShops(gate, NIVEA_SOFT.query, ["rossmann", "natura"])));

    expect(requestsOf(fetchMock)).toEqual(requestsFor(NIVEA_SOFT, ["rossmann", "natura"]));
    expect(entries[0]).toEqual(["rossmann 26900"]);
    expect(entries).toContainEqual(["natura NV89063"]);
  });
});

describe("searchShops: a shop that gives no answer", () => {
  it("says so in its line, never „brak wyników”, while the others' entries still show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Natura's search answers 403, Hebe's counter is at its cap, and Super-Pharm's search fails with a 500.
    const { gate, fetchMock, reserve, reportBlock } = setup(
      replayOf(NIVEA_SOFT, { natura: { status: 403 }, "super-pharm": { status: 500 } }),
      { hebe: { outcome: "capped" } },
    );

    const outcomes = await searchShops(gate, NIVEA_SOFT.query);

    // Hebe at its cap is never asked.
    expect(requestsOf(fetchMock)).toEqual(requestsFor(NIVEA_SOFT, ["rossmann", "natura", "super-pharm"]));
    expect(reserve).toHaveBeenCalledTimes(4);
    // The 403 stops Natura for everyone.
    expect(reportBlock.mock.calls).toEqual([["natura", "blocked", undefined, "HTTP 403"]]);
    expect(outcomes.shops).toMatchObject({
      natura: { kind: "unavailable", reason: "stopped" },
      hebe: { kind: "unavailable", reason: "busy" },
      "super-pharm": { kind: "unavailable", reason: "failed" },
    });
    expect(shopLinesOf(outcomes).map(({ text }) => text)).toEqual([
      "Rossmann: 5 wyników",
      "Natura: nie odpowiada",
      "Hebe: nie odpowiada",
      "Super-Pharm: nie odpowiada",
    ]);
    expect(itemsOf(searchEntriesOf(outcomes))).toEqual([
      ["rossmann 26900"],
      ["rossmann 2126586"],
      ["rossmann 2103263"],
      ["rossmann 11790"],
      ["rossmann 2079205"],
    ]);
    // Only the gate logs them.
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads a shop whose search throws as not answering, logged without the search, beside the others", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gate: real } = setup(replayOf(AA_LAAB));
    // A gate that throws for Hebe, as it does for a URL off the shop's hosts.
    const gate: ShopGate = {
      fetch: (shop, url, init) =>
        shop === "hebe" ? Promise.reject(new TypeError("not a hebe URL")) : real.fetch(shop, url, init),
    };

    const outcomes = await searchShops(gate, AA_LAAB.query);

    expect(outcomes.shops.hebe).toEqual({ kind: "unavailable", reason: "failed" });
    expect(itemsOf(searchEntriesOf(outcomes))).toEqual([
      ["rossmann 2132081"],
      ["rossmann 419343", "super-pharm 105870"],
      ["natura OC91938"],
      ["natura OC04980"],
      ["natura OC91907"],
      ["natura OC04966"],
    ]);
    expect(loggedLine(warn)).toEqual({
      event: "product-search",
      shop: "hebe",
      reason: "search failed",
      error: "TypeError",
    });
  });

  it("asks no shop when none can be asked, and every line says so", async () => {
    const { gate, fetchMock } = setup(replayOf(NIVEA_SOFT), {
      rossmann: { outcome: "stopped" },
      natura: { outcome: "paused", until: "2026-10-09T12:00:00+00:00" },
      hebe: { outcome: "capped" },
      "super-pharm": null,
    });

    const outcomes = await searchShops(gate, NIVEA_SOFT.query);
    const results = searchResultsOf(outcomes, [], []);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results.entries).toEqual([]);
    expect(results.answered).toBe(false);
    expect(results.lines.map(({ text }) => text)).toEqual([
      "Rossmann: nie odpowiada",
      "Natura: nie odpowiada",
      "Hebe: nie odpowiada",
      "Super-Pharm: nie odpowiada",
    ]);
  });
});

describe("onListOf: „Na liście”", () => {
  it("marks an entry one of whose items is a listed product's own item, whichever shop it's from", async () => {
    const entries = searchEntriesOf(await searchRecorded(NIVEA_SOFT));
    // A product picked in Natura, whose own item is the second of the first entry's three.
    const fromNatura = listed(1, "natura", "NV89063");

    const marked = onListOf(entries, [fromNatura], []);

    expect(marked.filter((entry) => entry.onList).map((entry) => itemsOf([entry])[0])).toEqual([
      ["rossmann 26900", "natura NV89063", "super-pharm 10132"],
    ]);
  });

  it("marks an entry one of whose items a listed product is matched to", async () => {
    const entries = searchEntriesOf(await searchRecorded(NIVEA_SOFT));
    // A product picked in Rossmann, no item of these results, matched in Hebe to its 200 ml Nivea Soft.
    const fromRossmann = listed(2, "rossmann", "900002");

    const marked = onListOf(entries, [fromRossmann], [matchOf(fromRossmann, "hebe", "000000000000218807")]);

    expect(marked.filter((entry) => entry.onList).map((entry) => itemsOf([entry])[0])).toEqual([
      ["natura NV890500", "hebe 000000000000218807"],
    ]);
  });

  it.each<{ why: string; products: WatchlistItem[] | null; decisions: ShopMatchState[] | null }>([
    {
      why: "a decision in the product's own shop, which no read counts",
      products: [listed(3, "hebe", "000000000000999999")],
      decisions: [matchOf(listed(3, "hebe", "000000000000999999"), "hebe", "000000000000218807")],
    },
    {
      why: "a decision that names no item: declined, or not found",
      products: [listed(4, "rossmann", "900004")],
      decisions: [
        { watchlistItemId: listed(4, "rossmann", "900004").id, shop: "hebe", state: "unmatched", shopItemId: null },
        { watchlistItemId: listed(4, "rossmann", "900004").id, shop: "natura", state: "not_found", shopItemId: null },
      ],
    },
    {
      why: "a match of a product the list couldn't read, whose own shop isn't known",
      products: [],
      decisions: [matchOf(listed(5, "rossmann", "900005"), "hebe", "000000000000218807")],
    },
    {
      why: "a list that couldn't be read, whatever its decisions say",
      products: null,
      decisions: [matchOf(listed(6, "rossmann", "900006"), "hebe", "000000000000218807")],
    },
  ])("marks nothing for $why", async ({ products, decisions }) => {
    const entries = searchEntriesOf(await searchRecorded(NIVEA_SOFT));

    expect(onListOf(entries, products, decisions).some((entry) => entry.onList)).toBe(false);
  });

  it("marks the products' own items when the decisions couldn't be read", async () => {
    const entries = searchEntriesOf(await searchRecorded(AA_LAAB));
    const fromHebe = listed(7, "hebe", "000000000000450257");

    const marked = onListOf(entries, [fromHebe], null);

    expect(marked.filter((entry) => entry.onList).map((entry) => itemsOf([entry])[0])).toEqual([
      ["hebe 000000000000450257"],
    ]);
  });
});

describe("searchResultsOf and the texts around the entries", () => {
  it("keeps Rossmann's spelling hint beside the shops that couldn't be asked", async () => {
    // Rossmann's recorded answer to „niwea soft”, whose hint is „nivea soft”, served for the list's request; the other
    // three shops are stopped, so none is asked.
    const url = "https://www.rossmann.pl/products/v4/api/Products?search=niwea%20soft&page=1&pageSize=10";
    const { gate, fetchMock } = setup([{ url, status: 200, body: JSON.stringify(rossmannMisspelled) }], {
      natura: { outcome: "stopped" },
      hebe: { outcome: "stopped" },
      "super-pharm": { outcome: "stopped" },
    });

    const results = searchResultsOf(await searchShops(gate, "niwea soft"), [], []);

    expect(requestsOf(fetchMock)).toEqual([url]);
    expect(results.spellingHint).toBe("nivea soft");
    expect(results.answered).toBe(true);
    expect(results.entries).toHaveLength(5);
    expect(results.lines.map(({ text }) => text)).toEqual([
      "Rossmann: 5 wyników",
      "Natura: nie odpowiada",
      "Hebe: nie odpowiada",
      "Super-Pharm: nie odpowiada",
    ]);
  });

  it("says a shop found nothing only when its answer said so", () => {
    const outcomes: SearchOutcomes = {
      shops: {
        rossmann: { kind: "results", products: [] },
        natura: { kind: "unavailable", reason: "failed" },
      },
      spellingHint: null,
    };

    const results = searchResultsOf(outcomes, [], []);

    expect(results.lines).toEqual([
      { shop: "rossmann", text: "Rossmann: brak wyników" },
      { shop: "natura", text: "Natura: nie odpowiada" },
    ]);
    expect(results.entries).toEqual([]);
    expect(results.answered).toBe(true);
  });

  it.each([
    { count: 1, text: "1 wynik" },
    { count: 2, text: "2 wyniki" },
    { count: 4, text: "4 wyniki" },
    { count: 5, text: "5 wyników" },
    { count: 12, text: "12 wyników" },
    { count: 14, text: "14 wyników" },
    { count: 22, text: "22 wyniki" },
    { count: 25, text: "25 wyników" },
  ])("counts $count results as „$text”", ({ count, text }) => {
    const product: ProductCandidate = {
      source: "rossmann",
      sourceItemId: "1",
      brand: null,
      name: "Produkt",
      caption: null,
      sizeText: null,
      size: null,
      eans: [],
      productUrl: null,
      imageUrl: null,
    };
    const outcomes: SearchOutcomes = {
      shops: { rossmann: { kind: "results", products: Array.from({ length: count }, () => product) } },
      spellingHint: null,
    };

    expect(shopLinesOf(outcomes)).toEqual([{ shop: "rossmann", text: `Rossmann: ${text}` }]);
  });

  it("names the shops' searches the results come from", () => {
    expect(searchSourcesText()).toBe("Wyniki z wyszukiwarek rossmann.pl, drogerienatura.pl, hebe.pl i superpharm.pl");
  });
});
