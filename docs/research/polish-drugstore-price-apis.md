# Polish drugstore & perfumery price sources: API investigation

- Date of investigation: 2026-09-17
- Goal: given a product name + size, fetch the current price from each Polish drugstore / perfumery so a "where to buy" list can be built.
- Method: live probes with plain `curl` (desktop Chrome User-Agent, no cookies, no login), inspection of page HTML and JS bundles for the endpoints the sites' own frontends call, plus web research on aggregators and affiliate programs.
- Scope: drugstores first (Rossmann, Hebe, Super-Pharm, dm, Drogerie Natura, Ziko Dermo, Kontigo), perfumeries second (Sephora, Douglas, Notino), aggregators (Ceneo, Skąpiec).

## 1. Summary

| Shop            | How prices can be fetched                                                 | Size / EAN available                                                      | Auth                             | Verdict                                                               |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Rossmann        | internal JSON API `www.rossmann.pl/products/v4/api/Products`              | `unit` string, `eanNumber[]`                                              | none                             | **open, verified**                                                    |
| Hebe            | Luigi's Box search API (`live.luigisbox.com`)                             | size at the end of the legal name (`Pojemność` unreliable, §2.2), `EAN[]` | tracker id from page             | **open, verified**                                                    |
| Super-Pharm     | Algolia index `spprod_drugstore_pl_simple_products`, POST search          | `capacity` (`farmax_capacity` has no unit); EAN only on product pages     | public key in every page, stable | **open, verified**                                                    |
| dm              | `product-search.services.dmtech.com/pl/search`                            | size inside `title`, `gtin`                                               | none                             | **open from a normal connection; 403 from Cloudflare Workers** (§9)   |
| Drogerie Natura | Luigi's Box search API                                                    | `size` + `size_unit`, `ean[]`                                             | tracker id from page             | **open, verified**                                                    |
| Ziko Dermo      | plain server-rendered HTML (AptusShop)                                    | in HTML                                                                   | none                             | scrapable                                                             |
| Sephora.pl      | Akamai Bot Manager, HTTP 403 "Access Denied" on every URL                 | –                                                                         | –                                | **blocked** for plain HTTP                                            |
| Douglas.pl      | Akamai, returns fake `400 Request Too Long` to non-browsers               | –                                                                         | –                                | **blocked** for plain HTTP                                            |
| Notino.pl       | Cloudflare managed challenge (`Cf-Mitigated: challenge`)                  | –                                                                         | –                                | **blocked**; official affiliate XML feed exists                       |
| Ceneo.pl        | HTML search + product pages fetchable; Partner API has no per-shop offers | offers have `data-shop`, `data-price`                                     | none (HTML)                      | fallback for Douglas / Notino / Sephora; Rossmann is **not** on Ceneo |
| Skąpiec.pl      | HTML, results dominated by Amazon.pl                                      | –                                                                         | none                             | low value                                                             |
| Kontigo         | `kontigo.com.pl` no longer resolves                                       | –                                                                         | –                                | chain is gone                                                         |

Proof on one product, **Nivea Soft 300 ml, EAN 4005900009319** (prices on 2026-09-17):

| Shop            | Price        | Notes                                                                                                                                                                   |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dm              | 18,95 zł     | unit price 63,17 zł / l                                                                                                                                                 |
| Drogerie Natura | 22,99 zł     | Omnibus lowest 30-day: 23,99 zł                                                                                                                                         |
| Rossmann        | 26,99 zł     | `pricePerUnit: "100 ml = 9,00 zł"`, `differentPricesInShop: true`                                                                                                       |
| Super-Pharm     | 36,99 zł     | product page JSON-LD confirms `gtin13: 4005900009319`                                                                                                                   |
| Hebe            | 24,99 zł (?) | EAN query returned the 300 ml item with `Pojemność: 0.237` (237 ml): a wrong size field, not a wrong EAN, and Hebe doesn't sell it online (re-checked 2026-10-02, §2.2) |

## 2. Working sources in detail

### 2.1 Rossmann (rossmann.pl)

- Platform: Next.js frontend; product data comes from an internal REST API under the `/products` path prefix on the same host. No bot protection observed (one transient HTTP 502 in ~10 calls).
- Endpoints found in the JS bundle (`ros-prd-common-s3-cdn-lv8ij9.rossmann.pl/_next/static/chunks/*.js`) and verified:

```
GET https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=24
GET https://www.rossmann.pl/products/v2/api/Products/26900?shopNumber=null
GET https://www.rossmann.pl/products/api/Categories
```

- Query parameters accepted by `v4/api/Products` (from the bundle): `search, page, pageSize, sortOrder, categoryId, brandIds, priceFrom, priceTo, recommendedTags, promotionTags, dynamicTags, seasonalCampaignsIds, campaign, clientUUID, retailerVisitorId, customerId, deviceType`.
- Response shape: `data.{ filters, items[], recommendedProducts, totalPages, totalCount, correlationId, spellCheckHint }`.
- `items[]` fields: `id, rossnetId, brand, brandId, name, caption, fallbackName, fallbackCaption, unit, price, pricePerUnit, vat, eanNumber[], navigateUrl, pictures[], promotion, availability, category, attributes, badges, averageRating, totalReviews, dimensional, hasRichContent, isInOut`. A reduced item also carries the price fields below.
- Product detail (`v2/api/Products/{id}?shopNumber=null`), one product per request (see Limitations): `data` holds the product's `id`, the same price fields as a search item (next bullet), and `promotions[], availability ("available"), differentPricesInShop (bool), colorVariants, variants, shelvesNavigateUrl, brandUrls`. `promotions[]` names campaigns, like `promotion`: the unreduced 26900 has three "seasonal" ones. An id Rossmann doesn't have answers HTTP 404 `application/problem+json`, and the endpoint answers from Cloudflare Workers too (both 2026-09-28; §9). `shopNumber=<store id>` should give store-specific price/stock.
- Price fields (recordings of 2026-09-27, live requests of 2026-09-28), the same in `items[]`, `recommendedProducts` and the detail:
  - `price` is the current price: the promo price while a reduction runs. An item without a reduction carries none of the fields below.
  - A reduced item adds `oldPrice`, the regular price before the reduction; `lastLowestPrice` (equal to `lastLowestPriceV2`, with `lastLowestPriceType` "basic"), the Omnibus 30-day low; and `promotionFrom` / `promotionTo`, the reduction's window, without a UTC offset (`"2026-09-30T00:00:00"`).
  - `oldPrice` is not the 30-day low: Purina Felix Fantastic (131225) has `price` 5.99, `oldPrice` 9.99 and `lastLowestPrice` 6.39.
  - `promotion{type, redirectUrl}` tags a campaign (`seasonal`, `rossmann`, `rossne`, `mega`) and appears on items with no reduction too, so it says nothing about the price.
- Other routes seen in the bundle, not tested: `/v4/api/Products/filters`, `/api/Products/{id}/additionals`, `/api/shops/{shopNumber}/products/stocks?productsIds=...`, `/api/Shops?...`, `/api/v3/Suggestion?Search=...` (different base), `/api/v1/Catalog?...` (alternative catalog base).
- Limitations: **text search only**. `search=4005900009319` returns 0 items, so resolve by name and filter on `eanNumber` client-side. `v2/api/Products?ids=26900&ids=11790` returned HTTP 400 (parameter format not figured out).
- The app reads the search's items for two uses (since 2026-10-08):
  - the list's search, whose items are products to add, each with its caption (`searchRossmann`): one of the four shops' searches the list asks at once, each for 10 items, so since 2026-10-09 Rossmann's page is 10 items (`pageSize=10`), not 24 (§6 step 1);
  - a lookup for a product picked in another shop, whose items are candidates for its match at Rossmann (`searchRossmannItems`): each one's name joins the item's name and caption, where Rossmann keeps the shade or the scent, and its offer is read from its price fields by the detail's rules, so an automatic Rossmann match brings its first price with no further request. A lookup asks by name only, for 10 items a page (`pageSize=10`), with the text the app's lookup builds (§6 step 2).
- A query in another shop's words can find nothing at Rossmann, even for a product it sells. Three lookups were recorded on 2026-10-08 at 22:06 UTC, with the owner's approval: 3 requests from the developer machine, one at a time and 3 s apart, with the gate's User-Agent and `Accept: application/json`, following no redirect, each with the exact text the app's lookup builds and 10 items a page. Their answers, kept whole, are the `rossmann-lookup-*.json` fixtures, which `src/lib/services/shop-matching.test.ts` lists:
  - "NIVEA SOFT krem intensywnie nawilżający 300 ml", Natura's title for NV89063: 26900 alone, which carries Natura's EAN, on promotion (`price` 15.99, `oldPrice` 26.99, `lastLowestPrice` 26.99, `promotionTo` 2026-10-14). Its name and caption ("Soft ", "krem do twarzy, ciała i dłoni, nawilżający") lack "intensywnie", which the answer holds only in its first picture's `alt` text, so not every word of a query need be in an item's name or caption.
  - "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający 150 ml", Hebe's legal name for 450251: the face wash in 150 ml (419343), which carries Hebe's EAN, then in 75 ml (2132081).
  - "Maybelline Mascara Lash Sensational Sky High Cosmic Black 7.2 ml", Super-Pharm's name and `capacity` for 84422: no item, a `totalCount` of 0, an empty `spellCheckHint`, and four unrelated `recommendedProducts`. Rossmann sells the mascara: "maybelline lash sensational" found it on 2026-10-06 as 390594, named "Lash Sensational Sky High", with the caption "tusz do rzęs, wydłużający, Cosmic Black" and the unit "7,2 ml" (`rossmann-search-maybelline-lash-sensational.json`). Which of Super-Pharm's words, such as "Mascara" or "7.2 ml", kept it out is unknown: no request varied them. The app stores that Rossmann found nothing, a known limit (§6 step 3).
- Sample item (trimmed):

```json
{
  "brand": "NIVEA",
  "brandId": 5500,
  "caption": "krem uniwersalny, nawilżający",
  "unit": "300 ml",
  "id": 26900,
  "rossnetId": 100118,
  "eanNumber": ["4005900009319", "4005808890637", "5900017001234"],
  "navigateUrl": "/Produkt/Kremy-do-twarzy/NIVEA-Soft-krem-uniwersalny-nawilzajacy-300-ml,26900,13049",
  "name": "Soft ",
  "price": 26.99,
  "pricePerUnit": "100 ml = 9,00 zł",
  "vat": 23,
  "promotion": { "type": "seasonal", "redirectUrl": "/produkty?Statuses=seasonal", "attributes": [] },
  "availability": "available"
}
```

### 2.2 Hebe (hebe.pl)

- Platform: Salesforce Commerce Cloud (SFRA). The search page HTML (≈680 KB) contains **no product tiles**: results are rendered client-side by a React bundle that queries **Luigi's Box**. The tracker id is in `https://scripts.luigisbox.com/LBX-505233.js` (`trackerId: "421168-505233"`).
- Endpoint (verified, JSON):

```
GET https://live.luigisbox.com/search?tracker_id=421168-505233&q=nivea%20soft&size=20
GET https://live.luigisbox.com/search?tracker_id=421168-505233&q=4005900009319      # EAN query works
```

- Response: `results.{ query, total_hits, hits[], facets[] }`. Each hit: `url` (Hebe product id, e.g. `000000000000218807`), `type`, `attributes{...}`. An item's hit has `type: "item"`, and its `url` is the 18-digit id, equal to `attributes.ID[0]` (2026-10-02).
- Useful attributes: `title, name[], brand[], ShortDescription[] (contains size text), Nazwa wymagana przez prawo[] (the legal name, which ends with the size), price, price_amount, price_sale, price_sale_amount, price_omnibus, price_omnibus_amount, AttrOmnibusPrice[], EAN[], Pojemność[] (litres as string, "0.200" = 200 ml; unreliable, see below), availability, availability_rank, online_flag[], invAllocation[], searchable[], ID[], web_url, image_link, ShortProductID[], SupplierCode[], CurrentProductPromotions[], Promocje[], TrustmateAverageGrade, currency`.
- Quirks: the hit list can include a query-suggestion pseudo-hit (`"url":"nivea soft"`, `type: "query"`, no price among its attributes) → keep only `type: "item"` hits with a price. Prices are strings (`"15.99"`), each beside a numeric twin (see below); `price_sale` is the current promo price, `price` the regular one.
- Sample hit (trimmed, 2026-09-17; on 2026-10-02 the same item had no sale, with `price` "15.99" and `price_omnibus` "10.89"):

```json
{
  "url": "000000000000218807",
  "attributes": {
    "title": "Nivea Soft",
    "brand": ["Nivea"],
    "ShortDescription": ["intensywnie nawilżający krem do twarzy i ciała, 200 ml"],
    "price": "15.99",
    "price_sale": "10.89",
    "price_omnibus": "10.99",
    "EAN": ["4005900008299"],
    "Pojemność": ["0.200"],
    "availability": 1,
    "ShortProductID": ["218807"],
    "offerSource": ["Hebe"]
  }
}
```

- Re-checked on 2026-10-02: 7 requests from the developer machine, one at a time and at least 2.5 s apart, with the gate's User-Agent and the owner's approval, none of them to `www.hebe.pl`. One more EAN search, for an item Hebe sells online, followed on 2026-10-04, also approved. The answers became the `hebe-*.json` fixtures, which `src/lib/services/shops/hebe.test.ts` lists.
- Sizes: `Pojemność` is litres with 3 decimals and no unit, and it can be wrong. The legal name (`Nazwa wymagana przez prawo`) and `ShortDescription` end with the size and its unit in all 5 inspected items, so the app reads the legal name's, else the description's:

| Item   | `Pojemność` | Legal name and description end with |
| ------ | ----------- | ----------------------------------- |
| 251798 | `0.237`     | 300 ml                              |
| 218807 | `0.200`     | 200 ml                              |
| 255134 | `0.750`     | 750 ml                              |
| 742817 | `0.005`     | 5,5 ml                              |
| 218607 | `0.100`     | 100 g                               |

- Sets (2026-10-08): a set's legal name or description ends with one of its items' sizes, never the set's, as the description of the AA LAAB set 764646, which has no legal name, does: "zestaw: skoncentrowane serum-amupłka, 30 ml + żel do mycia twarzy, 30 ml + płyn micelarny, 33 ml". So the app reads no size from a set's legal name, nor then from its description, and a description's size only when it isn't a set's, by the set rule Super-Pharm's names follow (§2.3).
- The EAN example, corrected: the EAN query for 4005900009319 (Nivea Soft 300 ml) returns item 251798, whose legal name, description and URL all say 300 ml, with the EAN Rossmann lists for the product. Only its `Pojemność` is wrong, so §1's "not clean" mapping was a wrong size field, not a wrong EAN. A shared EAN can still come with another size: the lip balm 742817 ("5,5 ml") carries EAN 9005800362939, which Rossmann lists for its 4,8 g Soft Rose lip balm (11790). Sizes in different units don't compare, so the matching rule flags the candidate instead of accepting it.
- Prices: `price`, `price_sale` and `price_omnibus` are strings, and `price_amount`, `price_sale_amount` and `price_omnibus_amount` their numbers. `price_sale*` is there only during a sale, while `price_omnibus*` can come without one: 4 of the 5 items carry it, 218807 with no sale. No field carries a sale's end: `CurrentProductPromotions` lists campaign codes, not dates. `currency` is `["PLN"]`.
- Orderable online: `availability` is 1 on all 5 items, including 251798, which Hebe lists but doesn't sell online. `online_flag` (`[true]` or `[false]`) tells them apart, as do `invAllocation` (stock, `[0]` for 251798) and `searchable` (`[false]` for 251798).
- Pinned items by `ID`: without `q`, `f[]=type:item` and one repeated `f[]=ID:<id>` per item return those items, and `hit_fields` trims each hit to the attributes it names (the probe's one-hit answer was 756 bytes). An id Hebe doesn't have gives a 200 JSON answer with 0 hits. Verified with the two ids below, sent with a longer `hit_fields` list; the app asks for these four fields, verified with one id through the app on 2026-10-04, and larger batches are untested.

```
GET https://live.luigisbox.com/search?tracker_id=421168-505233&f[]=type:item&f[]=ID:000000000000218807&f[]=ID:000000000000251798&size=2&hit_fields=price_amount,price_sale_amount,price_omnibus_amount,online_flag
```

- The `searchable` limit: on a request without `q`, the tracker adds `searchable:true` to the filters, as the answer's echoed `filters` show, and drops an explicit `f[]=searchable:false`. So an item Hebe doesn't sell online returns 0 hits on the pinned path, exactly like an unknown id: of the two ids above, only 218807 came back. A request with `q` has no such filter and returns such items, so the app never offers them: a pinned one's price could never be refreshed.
- Dead ends: SFCC `Search-UpdateGrid` returns HTTP 410 (disabled); no OCAPI/SCAPI `client_id` exposed in the page; robots.txt explicitly disallows AI crawlers (ClaudeBot, CCBot, Bytespider, Scrapy, …).

### 2.3 Super-Pharm (superpharm.pl)

- Platform: Magento 2 + Algolia (extension v3.9.1). The `algoliaConfig` JSON embedded in every page carries `applicationId: "EP43QPDX9Q"`, `indexName: "spprod_drugstore_pl_simple"` and a **search-only** `apiKey` (base64 secured key that embeds `tagFilters`). Key seen on 2026-09-17, and the same on 2026-10-05: `NjRmYmE4ZDZhMDg5ODhkMjg1MzIzM2M1NzUwODE1MGFmN2E4NTllNjM2MmJmMzdhZmJkODQ3MmUzNTg4ZWZjOHRhZ0ZpbHRlcnM9`.
- The key is stable. This note first said it rotates with deployments, which no second key ever showed (corrected 2026-10-05):
  - It decodes to a 64-character hex HMAC followed by `tagFilters=` and nothing else, so it carries no `validUntil` and lives as long as the key Super-Pharm made it from.
  - It was the same, byte for byte, 18 days after the first sighting, on the same extension version (v3.9.1, in the page's `algoliaConfig`).
  - From extension v3.14.0 on, the extension adds a 24-hour `validUntil`, so after such an upgrade the key would change daily (the extension's source).
  - The app keeps it as a constant (`SUPER_PHARM_SEARCH_KEY` in `src/lib/services/shops/super-pharm.ts`). Algolia answers a key it no longer accepts with 403, as its API specification and issue threads show (this app's answer was never recorded), which stops the shop until the owner copies the page's new key into the code and switches the shop back on (`context/deployment/deploy-plan.md`, "Super-Pharm stopped with HTTP 403").
- The Magento index for products is `<indexName>_products`, i.e. **`spprod_drugstore_pl_simple_products`**. Replicas: `..._price_default_asc`, `..._price_default_desc`, `..._created_at_desc`. A separate `spprod_pharmacy_pl` index serves apteka.superpharm.pl.

```
POST https://EP43QPDX9Q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query
Headers: X-Algolia-Application-Id: EP43QPDX9Q
         X-Algolia-API-Key: <apiKey from algoliaConfig>
         Content-Type: application/json
Body:    {"params":"query=nivea%20soft&hitsPerPage=20"}
```

- The route is this POST, Algolia's documented search of one index; a GET on the index is its legacy, discouraged form. Every search and every price request goes to this one URL, so the app's tests tell them apart by their bodies. The app's bodies also send `analytics=false`, which keeps its requests out of Super-Pharm's search statistics, `attributesToRetrieve` with only the attributes it reads, and `attributesToHighlight=[]`, and its price requests send `enableRules=false` too (see the query rules below).
- Hit fields: `name, sku, url, brand, capacity ("300 ml"), farmax_capacity (300), price.PLN.{default, default_formated, default_historical_min_price_formated (Omnibus), special_from_date, special_to_date}, in_stock, inStoreOnly, showRedPrice, badges, rating_summary, reviews_count, categories, thumbnail_url, variant_skus, variant_attribute, isProductRx, pharmaceuticalFlag, algoliaLastUpdateAtCET, objectID`.
- No EAN in the index. The product page JSON-LD has it: `"gtin13":"4005900009319"` plus `offers.price`, `availability`, `priceValidUntil`. An EAN query finds nothing (0 hits for 4005900009319 on 2026-10-05), so the app never sends one.
- Sample hit (trimmed, 2026-09-17; on 2026-10-05 the same item, `objectID` "10132", was on promotion without its regular price, see below):

```json
{
  "name": "Nivea Soft Krem nawilżający (Pudełko)",
  "sku": "39477",
  "brand": "Nivea",
  "capacity": "300 ml",
  "farmax_capacity": 300,
  "in_stock": 1,
  "price": {
    "PLN": { "default": 36.99, "default_formated": "36,99 zł", "default_historical_min_price_formated": false }
  },
  "url": "https://www.superpharm.pl/nivea-soft-krem-nawilzajacy-pudelko-39477"
}
```

- Re-checked on 2026-10-05: 7 requests from the developer machine, one at a time and at least 2.5 s apart, with the gate's User-Agent and the owner's approval: robots.txt and the homepage, then 5 to Algolia, three probes and two of the adapter's own requests. The Algolia answers became the `super-pharm-*.json` fixtures, which `src/lib/services/shops/super-pharm.test.ts` lists. A check through the app on the local production preview followed, also approved: 4 requests through the gate, a tap's search, the first refetch after a pick, a list refresh and a re-pin's search. One more curl request followed on 2026-10-06, approved by the owner: the adapter's price request with the query rules off (below). Later on 2026-10-06, at 11:49 UTC and also approved, 7 more Algolia requests, 3 s apart: the name searches a product's lookup sends, each for a Rossmann product's brand, name and size with 10 hits. Their answers, kept whole, became the `super-pharm-lookup-*.json` fixtures (`context/archive/2026-10-06-match-by-name/research.md` §5).
- Ids, sizes and links:
  - `objectID` is the Magento product id ("10132" for Nivea Soft 300 ml), not the `sku` ("39477", which ends the URL's slug). The app pins the `objectID`.
  - `capacity` is the size with its unit, as the shop shows it, and it's searchable: "NIVEA Soft 300 ml" found exactly the 300 ml item. `farmax_capacity` (300) has no unit, so the app never reads a size from it.
  - Many records have no `capacity`: 27 of the 47 hits of the 7 lookups of 2026-10-06, the right item for Head & Shoulders Classic Clean 400 ml (150930) among them. 14 of the 47 names end with a size, as "Head & Shoulders Szampon do włosów Classic Clean, 400 ml" does, so since 2026-10-06 the app reads a record's size from the end of its name when the record has no `capacity`. A set's name doesn't count: one that says "zestaw" in any case or joins its items with "+" ends with one of its items' sizes, as "Nivea Zestaw You Got This: Deo AP 50 ml + SG 250 ml + Pomadka 4,8 g + Płyn mic. 200 ml" does. Since 2026-10-08 only a "+" between spaces joins items, so a name with "SPF50+" or "Men+Care" keeps its size, and Hebe's sets follow the same rule (§2.2). A `capacity` that doesn't read as a size, or isn't text, gives no size, since the name's could be one item's, while one left out, `false`, `null` or blank counts as none (2026-10-07).
  - `url` is absolute, on `www.superpharm.pl`, while `thumbnail_url` is on another host, `media.superpharm.eu`. An image's file name is no evidence of size: the 300 ml item's says 200ml.
- Prices:
  - `price.PLN.default` is a number, the price Super-Pharm sells at, a promotion's included, and `default_formated` is its text.
  - `default_historical_min_price_formated`, the 30-day low, is Polish text with a no-break space before "zł" ("33,99 zł"), or `false` when there's none. It's Super-Pharm's own field, not the extension's.
  - `default_original_formated`, the regular price as text, comes with some promotions only, and no recorded hit has one yet. On 2026-10-05 the 300 ml item was on promotion at 19,49 zł, shown in red (`showRedPrice` 1) with a "Promocja" badge and a 30-day low of 33,99 zł, yet it had no `default_original_formated`, its `special_from_date` was 1480001487 (2016-11-24) and its `special_to_date` `false`. So a sale can come without its regular price or its end, and a record keeps a sale's dates after the sale. The app shows such a sale as a plain price with its 30-day low, and reads `special_to_date` as a promotion's end only beside a regular price, as the extension's own frontend does (`common.js` in v3.9.1).
  - The record carries only the guest price: the page's `priceGroup` is null, and no club or customer-group price comes with it.
  - `algoliaLastUpdateAtCET` is when Super-Pharm last indexed the record, in Polish time ("2026-10-05 11:16:30"): a price is as fresh as its record.
- Orderable online: `in_stock` (1 or 0) and `inStoreOnly` (1 for an item sold only in the shops). Of the 60 hits in the Super-Pharm fixtures, 58 have `in_stock` 1 and, where it was asked for, `inStoreOnly` 0. The other two, both from the lookups of 2026-10-06 and both the right item for a watched product, send `in_stock` as `false`: Head & Shoulders Classic Clean 400 ml (150930), and Creme Care 500 ml (20369), which also has `inStoreOnly` 1. The app counts an item orderable online when `in_stock` is 1 and `inStoreOnly` is 0 or missing, since the extension usually leaves an unset attribute out. It reads a `false`, like any other value but 1 or 0, as not orderable and counts it in an "availability unread" log line, so a match to either item shows a price that can't be named cheapest. The page's config has `areOutOfStockOptionsDisplayed` false, under which the extension deletes an out-of-stock product from the index, so such an item would read as missing rather than not orderable (inferred).
- Pinned items by `objectID` (2026-10-05): an empty `query` with `filters=objectID:<id> OR objectID:<id>` returns those items, and an id Super-Pharm doesn't have is simply left out, with `nbHits` counting only the hits returned. Verified with two ids, one known (a 700-byte answer), and with the request below, three known and one unknown; larger batches are untested. Algolia limits a parameter's value to 512 bytes, so the app asks for at most 20 ids a request, with `hitsPerPage` set to their number and only the price attributes retrieved (`objectID` comes with every hit). It never filters by `sku`, which the extension most likely doesn't declare for filtering (inferred).

```
POST https://EP43QPDX9Q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query
Body: {"params":"query=&filters=objectID%3A96276+OR+objectID%3A96278+OR+objectID%3A10132+OR+objectID%3A999999999&hitsPerPage=4&analytics=false&attributesToRetrieve=price%2Cin_stock%2CinStoreOnly&attributesToHighlight=%5B%5D&enableRules=false"}
```

- Query rules: the index runs its query rules on a price request's empty query too. Both pinned answers of 2026-10-05, sent without `enableRules`, report `rulesProcessing` in their `processingTimingsMS`, and a rule could hide an asked item or add one nobody asked for, so the app's price requests send `enableRules=false`. Re-checked on 2026-10-06 with the adapter's own price request, the body above, rules off: 200, the same three hits at the same prices, the unknown id left out, and no `rulesProcessing` in the answer's `processingTimingsMS`. Its answer is the fixture `super-pharm-pinned-rules-off.json`.

- Dead ends: index `spprod_drugstore_pl_simple` → "does not exist"; `spprod_drugstore_pl_products` → 0 hits; listing indices with the search key → 403 (expected). Search page URL is `/catalogsearch/result/?q=`; `/szukaj` and `/search` are 404.

### 2.4 dm (dm.pl)

- Platform: dm's shared "dmtech" services. Same API as dm.de, with `pl` as the market segment. The site's own `/search` is disallowed in robots.txt, but the API lives on a different host.

```
GET https://product-search.services.dmtech.com/pl/search?query=nivea%20soft&pageSize=30
GET https://product-search.services.dmtech.com/pl/search?query=4005900009319          # GTIN query works (count: 1)
```

- Non-browser clients are redirected (302) to `/pl/search/crawl?...`, which returns the same JSON — follow redirects. `sort=price_asc` also triggers the redirect.
- Response: `{ products[], facets, count, currentPage, pageSize, totalPages }`.
- `products[]`: `gtin, dan (dm article number), brandName, title (includes size, e.g. "Krem intensywnie nawilżający Soft, 300 ml"), tileData{ price{ price{ current{ value: "18,95 zł" } }, tileInfos: ["0,3 l (63,17 zł za 1 l)"] }, a11yLabel, images[], isPharmacy, self, trackingData }, context`.
- Price is a formatted string → parse `"18,95 zł"`.
- Dead ends: `products.dm.de/product/pl/{dan}` and `/product/pl/gtin/{gtin}` → 404; `/pl/products/dans/{dan}` → 404.

### 2.5 Drogerie Natura (drogerienatura.pl)

- Platform: Magento 2 + Luigi's Box (`TrackerId: "703598-939363"` in the page). robots.txt disallows `/catalogsearch/*` for crawlers, but the Luigi's Box API is separate.

```
GET https://live.luigisbox.com/search?tracker_id=703598-939363&q=nivea%20soft&size=20
GET https://live.luigisbox.com/search?tracker_id=703598-939363&q=4005900009319      # EAN query works
```

- Hit attributes: `title, brand[], manufacturer, sku, ean[], size[] ("300.0000"), size_unit[] ("ml"), price ("22.99 zł"), price_amount, price_old, price_old_amount, lowest_price[] (Omnibus), lowest_price_date[], discount_price_percentage_amount, availability, quantity, web_url, image_link, categories_*`. `url` is the SKU (e.g. `NV89063`).
- Sample hit (trimmed):

```json
{
  "url": "NV89063",
  "attributes": {
    "title": "NIVEA SOFT krem intensywnie nawilżający 300 ml",
    "brand": ["NIVEA"],
    "ean": ["4005900009319"],
    "size": ["300.0000"],
    "size_unit": ["ml"],
    "price": "22.99 zł",
    "price_amount": 22.99,
    "lowest_price": ["23.990000"],
    "availability": 1
  }
}
```

- Pinned items by SKU (2026-09-28): `f[]=type:product&f[]=sku:NV89063` without `q` returns exactly that item, and a SKU Natura doesn't have gives 0 hits. Luigi's Box combines filters on the same field with OR ([Search API docs](https://docs.luigisbox.com/search/api/v1/search/)), so one repeated `f[]=sku:<SKU>` per SKU returns several items in one request. Verified with two SKUs; the docs allow `size` up to 200, and larger batches are untested.

```
GET https://live.luigisbox.com/search?tracker_id=703598-939363&f[]=type:product&f[]=sku:NV89063&f[]=sku:NV81063&size=2&hit_fields=sku,price_amount,price_old_amount,lowest_price,availability
```

- `hit_fields` returns only the attributes it names, plus `title`: a hit shrinks from about 20 KB to about 350 characters.
- `lowest_price` is reported without a promotion too: NV81063 has `price_amount` 17.99, no `price_old_amount` and `lowest_price` `["10.990000"]`. Whether it covers the 30 days before a reduction or a rolling 30 days is unconfirmed.

### 2.6 Ziko Dermo (zikodermo.pl)

- Platform: AptusShop. Search `https://www.zikodermo.pl/szukaj?controller=search&s=<q>` returns server-rendered HTML with `class="product-name"`, `class="price-value"` (current) and `class="price-crossed"` (old price). Small chain; plain HTML scraping is enough if needed.

## 3. Blocked shops

### 3.1 Sephora.pl

- SFCC headless storefront behind **Akamai Bot Manager** (`Server: AkamaiGHost`, cookies `_abck`, `bm_sz`, `bm_s`, `akacd_HEADLESS_SFCC_PROD`). Every URL, including the homepage, returns 403 "Access Denied" to curl.
- Real search path (learned from the redirect) is `/wyniki-wyszukiwania?q=`; `/szukaj` and `/search` are 404.
- Routes: real browser (Playwright with a persistent Chrome profile, residential IP) or a scraping API. Sephora has a shop account on Ceneo (`ceneo.pl/sklepy/sephora.pl-s21483`), but it did not appear on the Dior Sauvage product page, so coverage via Ceneo is uncertain.

### 3.2 Douglas.pl

- Akamai (`akavpau_VP-PL` visitor-prioritisation cookie, `X-DGL-RequestID`). All paths, including `/api/v2/products/search`, return `400 Bad Request – Request Too Long` for non-browser TLS/header fingerprints.
- Douglas exposes partner/marketplace APIs (Channable integration for sellers) — seller-side, not usable for price lookups.
- Ceneo lists Douglas offers (present on the Dior Sauvage page).

### 3.3 Notino.pl

- Cloudflare managed challenge (`Cf-Mitigated: challenge`, "Just a moment…"), HTTP 403 for curl.
- **Official affiliate program** with an XML product feed via affiliate networks (e.g. VIVnetworks, CJ) — the legitimate bulk route for Notino prices: https://www.notino.pl/affiliate-program/
- Notino offers appear on Ceneo product pages.

## 4. Aggregators

### 4.1 Ceneo.pl

- HTML fetchable with plain curl (search: `https://www.ceneo.pl/;szukaj-<query>`, product: `https://www.ceneo.pl/<productId>`). Pages contain "captcha" scripts → expect rate limiting under load.
- Offer rows on product pages carry `data-shop`, `data-offer`, `data-price`, `data-productid`, `data-shopofferscount`, sometimes `data-shopurl`. Shops observed: Nivea Soft 300 ml → perfumeria.pl, natura.pl, ezebra.pl, allegro.pl, notino.pl; Dior Sauvage 100 ml → douglas.pl, zapachy.pl, allegro.pl, e-glamour.pl, perfumesco, notino.pl, amazon.pl.
- Shop accounts exist for Hebe (s34788), Super-Pharm (s24894), apteka.superpharm.pl (s28272), Natura (s25987), Notino (s751), Douglas (s24349), Sephora (s21483). **Rossmann has no Ceneo shop.** Per-product coverage depends on what each shop submits to Ceneo.
- Search by EAN (`/;szukaj-4005900009319`) returned an empty result page → use text search.
- Ceneo Partner (affiliate) API: https://pp.ceneo.pl/api, docs https://partnerzyapi.ceneo.pl/Pomoc/Service?name=PartnerService. OAuth 2.0 client credentials, OData (ATOM XML or `$format=json`). Methods: `Products`, `Categories`, `GetProducts` (search by name, category, price range), `GetBooks`. Returns `LowestPrice / HighestPrice / BasketPrice` and shop count per product — **no per-shop offers, no EAN search**. Access only for publishers sending traffic to Ceneo.
- Ceneo Business API (biznes.ceneo.pl/api) is for sellers listing on Ceneo (offer updates, competitor price analysis; some methods paid, from ~500 PLN/month).

### 4.2 Skąpiec.pl

- Search page renders, but results for a drugstore query were dominated by Amazon.pl offers; none of the drugstore chains showed up. Low value for this use case.

### 4.3 Other options

- Commercial scraping APIs with ready-made actors: Apify (rossmann.pl, hebe.pl, notino.pl, douglas.de, dm), Bright Data, Spider Cloud. Paid per run, handle bot protection.
- Google Shopping via a SERP API (SerpApi, Oxylabs) for cross-shop prices; paid.
- Allegro REST API (developer.allegro.pl, `GET /offers/listing?phrase=`) — official, needs app registration + OAuth; many drugstore products are sold there.

## 5. robots.txt notes (2026-09-17)

- rossmann.pl: `User-agent: *` allowed except account/checkout paths; the `/products/...` API is not mentioned.
- hebe.pl: explicit `Disallow: /` for AI/scraper agents (Applebot-Extended, Bytespider, CCBot, ClaudeBot, Diffbot, FacebookBot, Meta-ExternalAgent, omgili, ImagesiftBot, Scrapy).
- superpharm.pl: Magento defaults, in one `User-agent: *` group with no rule for an AI crawler. Re-checked on 2026-10-05: it now also disallows `/catalogsearch/` and `/catalogsearch/result/`, the site's own search page, which the app never reads (its search is Algolia's API); the homepage and the product pages stay allowed.
- dm.pl: `Disallow: /search` (site path; the API host is separate).
- drogerienatura.pl: `Disallow: /catalogsearch/*` (site path; Luigi's Box is separate).
- sephora.pl: disallows many SFCC parameter URLs; irrelevant because Akamai blocks anyway.

## 6. Matching "name + size" across shops

1. Resolve the user's input once to a canonical product with an **EAN**: query Rossmann `v4/api/Products` (returns `eanNumber[]` + `unit`) or dm (returns `gtin` + size in title). Let the user pick if several sizes/variants match. Since 2026-10-09 the app's search asks Rossmann, Natura, Hebe and Super-Pharm at once, each with its own search for 10 hits, and joins their items into one entry per product (`searchEntriesOf` in `src/lib/services/product-search.ts`): the shops come in that order and each shop's items in its own ranking, and each later shop's items are judged against an entry's first item by the matching rule (steps 5 and 6), a Rossmann, Natura or Hebe item joining only with an EAN it shares, and a Super-Pharm item by the name check of step 6. An item two entries would take joins neither. The user picks an entry, whose first item becomes the product, so a product may carry no EAN, as no Super-Pharm item does. Eight answers were recorded on 2026-10-06 at 10:37:35–10:38:00 UTC, with the owner's approval: one request at a time and 3 s apart, from the developer machine, with the gate's User-Agent and `Accept: application/json`, following no redirect, each the adapter's own search for 10 hits, kept whole as the `<shop>-search-nivea-soft.json` and `<shop>-search-aa-laab.json` fixtures. On them, "nivea soft" comes to 23 entries from 27 items, joining Rossmann 26900 with Natura NV89063 and Super-Pharm 10132, Natura NV890500 with Hebe 218807, and Natura NV80758 with Super-Pharm 20461; the owner's "AA LAAB 100% Centella B12 Żel do mycia twarzy nawilżający" comes to 11 entries from 17 items, joining Rossmann 419343 with Hebe 450251 and Super-Pharm 105870, and four Natura items with their Hebe twins; and no join is wrong (`src/lib/services/product-search.test.ts`). A shop's 10 hits are only its first answers: Hebe's for "nivea soft" held 7 query suggestions, so the search showed 3 of the 58 items Hebe reported.
2. Look up the EAN directly where supported: Hebe (Luigi's Box `q=<EAN>`), Natura (`q=<EAN>`), dm (`query=<GTIN>`). Where it finds nothing, or a shop's search can't find an EAN (Rossmann, Super-Pharm), search by name, 10 hits. Since 2026-10-08 the query names the product's brand, name and size text once each (`nameQuery` in `src/lib/services/shop-matching.ts`), since a name from Natura, Hebe or Super-Pharm often holds the brand and the size already, as "NIVEA SOFT krem intensywnie nawilżający 300 ml" does: the brand goes first only when the name doesn't start with it, and the size text last, in place of the size the name ends with, so "…500ml" becomes "… 500 ml". A query over 80 characters is cut in the name, at a word, so the brand and the size stay.
3. Rossmann: text search, then keep items whose `eanNumber` contains the EAN. Since 2026-10-08 a product picked in another shop is matched at Rossmann as at the other shops: one search by name (step 2), never by EAN (§2.1), whose items, each with its offer, go to the matching rule. A query in the words of the product's own shop can find nothing at Rossmann although it sells the product, as Super-Pharm's Sky High Cosmic Black did (§2.1); the lookup then stores that Rossmann found nothing, a known limit (the owner's call of 2026-10-08).
4. Super-Pharm: Algolia text search by brand, name and size (`capacity` is searchable, §2.3), sent when the user opens a product with no Super-Pharm decision (since 2026-10-06; until then only a tap on its card sent it). With no EAN in the index, an item is accepted on its own only by the name check of step 6, and otherwise the user picks, from the best name fits first; the app reads no product page for its `gtin13` (2026-10-05).
5. Normalise sizes before comparing: Rossmann `"300 ml"`, Hebe the size its legal name ends with (`"300 ml"`; its `Pojemność` litres are unreliable, §2.2), Natura `size`+`size_unit`, Super-Pharm `"300 ml"` / `300`, dm text inside `title`. Convert to ml / g / pcs.
6. Fallback matching when EAN data is missing (Super-Pharm) or wrong: brand + normalised name tokens + size within ±5 %. Hebe's one reported case was a wrong size field, not a wrong EAN (§2.2). Since 2026-10-06 the app accepts an item by a stricter form, only where EANs can't decide because the item or the product has none, and only when no item is accepted by EAN: the item needs the product's size (within 0.1 %, not ±5 %) and a brand that doesn't differ, and every word of its name must be in the product's name or caption, at least two of them, and, since 2026-10-07, a word of the product's own name and every word its caption writes with a capital letter or a digit, where Rossmann writes the shade or strength (`pickMatch` in `src/lib/services/matching.ts` states the whole rule, its tie-break included). It never overrules a shared EAN, so it catches no wrong EAN. In the 15 recorded Super-Pharm cases it accepts the right item for 10 and no wrong one (`src/lib/services/shops/super-pharm.test.ts`). Since 2026-10-08, for a product without a caption, as every product picked in another shop than Rossmann is, every word of the product's name must be in the item's name instead, there being no caption to mark the shade or strength: on the recorded "nivea soft" answers, the earlier form accepted a plainer sibling for 4 products picked in Natura or Super-Pharm, a refill's bottle twice and a plain cream for an SPF15 one twice, which this one leaves to the user (`src/lib/services/matching.test.ts`).
7. Keep Omnibus / promo fields separately: Hebe `price_sale`, `price_omnibus`; Natura `price_old_amount`, `lowest_price`; Super-Pharm `default_historical_min_price_formated`; Rossmann `oldPrice`, `lastLowestPrice`, `promotionFrom` / `promotionTo` (not `promotion`, which tags a campaign; §2.1).

## 7. Caveats

- All five working endpoints are **internal and undocumented**. Index names, tracker ids, Algolia keys and response shapes can change without notice. Implement one adapter per shop with a health check (known EAN → expected fields) and read dynamic values (Algolia key, Luigi's Box tracker) from the live page.
  - The app keeps the tracker ids and Super-Pharm's key as constants instead (§2.2, §2.3, §2.5), so a change shows as a refusal. A tracker Luigi's Box no longer knows answers 404, logged as "tracker id rejected". A key Algolia no longer accepts answers 403, which stops Super-Pharm until the owner updates the key and switches the shop back on (`context/deployment/deploy-plan.md`, "Super-Pharm stopped with HTTP 403").
- Terms of use of the shops generally prohibit automated access; low-volume personal use is common practice, a commercial product would need permission or official feeds (Notino affiliate feed, Ceneo partner API, Allegro API).
- Be polite: cache results (prices change at most a few times per day), stay around 1 request/s or less per host, set a descriptive User-Agent, back off on 429/5xx.
- Online price ≠ shelf price. Rossmann marks `differentPricesInShop: true`; Rossmann and Hebe have app-only / loyalty prices; Super-Pharm has club prices, though its index record carries only the guest price (2026-10-05, §2.3). `shopNumber` (Rossmann) allows store-level checks.
- Hebe's size attribute (`Pojemność`) was wrong for at least one product, and one EAN can come with another size in another shop (§2.2, 2026-10-02) → never trust a single identifier blindly; cross-check size.

## 8. Recommendation for the MVP

- Start with the five open sources (Rossmann, Hebe, Super-Pharm, dm, Natura). They already answer "where is it cheapest" for drugstore products and need no browser automation.
- Architecture: `resolve(name, size) → EAN candidates` → `adapters[shop].byEan / .search` → `normalise(size, price)` → table sorted by price. One adapter ≈ 30–60 lines each.
- Defer Sephora / Douglas / Notino. When needed, add them via Ceneo product pages (Douglas, Notino) or the Notino affiliate feed, and only then consider Playwright or a paid scraping API.

## 9. Egress from Cloudflare Workers (2026-09-23)

- **Method:**
  - A throwaway Worker on the project's Cloudflare account: the same account and workers.dev subdomain as the app, so the same egress and `CF-Worker` header. It was deleted afterwards.
  - One request per target, 2 s apart, no retries.
  - User-Agent `DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)`, the descriptive one §7 recommends.
  - Every request ran in the WAW (Warsaw) data center.
  - The Rossmann detail row came later, on 2026-09-28: one request from a second throwaway Worker on the same account, with the same User-Agent and no redirects followed, also deleted afterwards.

| Target               | Request                                              | Status              | Time   | Expected field       | Notes                                 |
| -------------------- | ---------------------------------------------------- | ------------------- | ------ | -------------------- | ------------------------------------- |
| Rossmann             | `v4/api/Products?search=nivea%20soft&pageSize=1`     | 200 JSON            | 172 ms | `items` ✓            |                                       |
| Rossmann detail      | `v2/api/Products/26900?shopNumber=null`              | 200 JSON            | –      | `price` ✓            | 2026-09-28; time not recorded         |
| Hebe (Luigi's Box)   | `live.luigisbox.com/search`, tracker `421168-505233` | 200 JSON            | 346 ms | `hits` ✓             |                                       |
| Natura (Luigi's Box) | `live.luigisbox.com/search`, tracker `703598-939363` | 200 JSON            | 279 ms | `hits` ✓             |                                       |
| dm                   | `product-search.services.dmtech.com/pl/search`       | **403** HTML, 134 B | 345 ms | ✗                    | no redirect to `/crawl`; see below    |
| Super-Pharm page     | `www.superpharm.pl/`                                 | 200 HTML, 1.8 MB    | 41 ms  | `algoliaConfig` ✓    | search key extracted at runtime       |
| Super-Pharm Algolia  | `EP43QPDX9Q-dsn.algolia.net/…/simple_products/query` | 200 JSON            | 369 ms | `hits` ✓             | works with the key read from the page |
| Hebe page            | `www.hebe.pl/`                                       | 200 HTML, 1.3 MB    | 127 ms | Luigi's Box script ✓ |                                       |
| Natura page          | `www.drogerienatura.pl/`                             | 200 HTML, 3.3 MB    | 66 ms  | tracker id ✓         | one redirect                          |

- **dm control request:** the same request with the same User-Agent from the developer machine got a 302 to `/pl/search/crawl`, the normal behaviour described in §2.4.
  - So dm's 403 targets Cloudflare Workers traffic (its IP ranges or the `CF-Worker` header), not the User-Agent.
  - The API sits behind Google Cloud (`Via: 1.1 google`).
- **Implications:**
  - Rossmann, Hebe, Super-Pharm and Natura work from Workers as-is. That includes reading the Super-Pharm search key and the tracker pages at runtime, with no CPU-limit errors on the Free plan.
  - dm can't be fetched from Workers. The risk register's fallback (a proxy with a fixed egress IP) needs a decision first. Routing around a block aimed at Cloudflare traffic may count as circumventing bot protection, which the project rules forbid ("stop for a shop that blocks").
  - Until that's decided, treat dm as blocked in production and don't retry it.
  - **Decision 2026-09-24:** dm is dropped from the MVP, with no proxy; the PRD's FR-013 carries the update.
  - The pages that carry dynamic keys are large (Super-Pharm 1.8 MB, Natura 3.3 MB). Cache the extracted key and tracker ids instead of re-reading a page for every request.

## Appendix A – curl commands used

```bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

# Rossmann
curl -s -A "$UA" 'https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&page=1&pageSize=5'
curl -s -A "$UA" 'https://www.rossmann.pl/products/v2/api/Products/26900?shopNumber=null'

# Hebe (Luigi's Box)
curl -s -A "$UA" 'https://live.luigisbox.com/search?tracker_id=421168-505233&q=nivea%20soft&size=5'

# Drogerie Natura (Luigi's Box)
curl -s -A "$UA" 'https://live.luigisbox.com/search?tracker_id=703598-939363&q=4005900009319&size=3'

# Super-Pharm (Algolia) - key read from algoliaConfig in the page HTML
curl -s -X POST 'https://EP43QPDX9Q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query' \
  -H 'X-Algolia-Application-Id: EP43QPDX9Q' -H "X-Algolia-API-Key: $KEY" -H 'Content-Type: application/json' \
  --data '{"params":"query=nivea%20soft&hitsPerPage=5"}'

# dm
curl -sL -A "$UA" 'https://product-search.services.dmtech.com/pl/search?query=nivea%20soft&pageSize=5'
curl -sL -A "$UA" 'https://product-search.services.dmtech.com/pl/search?query=4005900009319'

# Ceneo (HTML)
curl -sL -A "$UA" 'https://www.ceneo.pl/;szukaj-nivea+soft+300ml'
curl -sL -A "$UA" 'https://www.ceneo.pl/32996224'
```

## Appendix B – evidence of bot protection

```
# Sephora
HTTP/1.1 403 Forbidden
Server: AkamaiGHost
Set-Cookie: akacd_HEADLESS_SFCC_PROD=...; Set-Cookie: _abck=...; Set-Cookie: bm_sz=...
<TITLE>Access Denied</TITLE> ... errors.edgesuite.net/18.dd3ad417...

# Douglas
HTTP/1.1 400 Bad Request
Set-Cookie: akavpau_VP-PL=...; X-DGL-RequestID: 0.8a3c655f...
<h2>Bad Request - Request Too Long</h2>

# Notino
HTTP/1.1 403 Forbidden
Cf-Mitigated: challenge
Server: cloudflare
<title>Just a moment...</title>
```

## Appendix C – dead ends (so nobody re-probes them)

- Rossmann: `/products/api/Products/v1/GetProducts`, `/products/api/v3/products`, `/v4/api/Products` (root), `/shop/v4/api/Products`, `/api/v1/Catalog`, `/products/api/v1/Catalog`, `/products/api/v3/Suggestion` → 404. `_next/data/<buildId>/szukaj.json` needs the current buildId (308 without it) and is unnecessary given the API.
- Hebe: `Search-UpdateGrid` → 410; search HTML has no prices; `cdn.luigisbox.com/search` → 404 (use `live.luigisbox.com`).
- Super-Pharm: indices `spprod_drugstore_pl_simple` (missing), `spprod_drugstore_pl_products` (empty), `spprod_drugstore_pl_default_products` (missing).
- dm: `products.dm.de/product/pl/...` → 404.
- Ceneo: EAN search → empty; Partner API has no offers endpoint.
- Kontigo: `kontigo.com.pl` / `www.kontigo.com.pl` do not resolve; `kontigo.pl` has a mismatched certificate.
