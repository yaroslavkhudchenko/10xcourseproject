# Polish drugstore & perfumery price sources: API investigation

- Date of investigation: 2026-09-17
- Goal: given a product name + size, fetch the current price from each Polish drugstore / perfumery so a "where to buy" list can be built.
- Method: live probes with plain `curl` (desktop Chrome User-Agent, no cookies, no login), inspection of page HTML and JS bundles for the endpoints the sites' own frontends call, plus web research on aggregators and affiliate programs.
- Scope: drugstores first (Rossmann, Hebe, Super-Pharm, dm, Drogerie Natura, Ziko Dermo, Kontigo), perfumeries second (Sephora, Douglas, Notino), aggregators (Ceneo, Skąpiec).

## 1. Summary

| Shop            | How prices can be fetched                                                 | Size / EAN available                                            | Auth                             | Verdict                                                               |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| Rossmann        | internal JSON API `www.rossmann.pl/products/v4/api/Products`              | `unit` string, `eanNumber[]`                                    | none                             | **open, verified**                                                    |
| Hebe            | Luigi's Box search API (`live.luigisbox.com`)                             | `Pojemność` (litres), `EAN[]`                                   | tracker id from page             | **open, verified**                                                    |
| Super-Pharm     | Algolia index `spprod_drugstore_pl_simple_products`                       | `capacity`, `farmax_capacity`; EAN only in product page JSON-LD | public search-only key from page | **open, verified**                                                    |
| dm              | `product-search.services.dmtech.com/pl/search`                            | size inside `title`, `gtin`                                     | none                             | **open, verified**                                                    |
| Drogerie Natura | Luigi's Box search API                                                    | `size` + `size_unit`, `ean[]`                                   | tracker id from page             | **open, verified**                                                    |
| Ziko Dermo      | plain server-rendered HTML (AptusShop)                                    | in HTML                                                         | none                             | scrapable                                                             |
| Sephora.pl      | Akamai Bot Manager, HTTP 403 "Access Denied" on every URL                 | –                                                               | –                                | **blocked** for plain HTTP                                            |
| Douglas.pl      | Akamai, returns fake `400 Request Too Long` to non-browsers               | –                                                               | –                                | **blocked** for plain HTTP                                            |
| Notino.pl       | Cloudflare managed challenge (`Cf-Mitigated: challenge`)                  | –                                                               | –                                | **blocked**; official affiliate XML feed exists                       |
| Ceneo.pl        | HTML search + product pages fetchable; Partner API has no per-shop offers | offers have `data-shop`, `data-price`                           | none (HTML)                      | fallback for Douglas / Notino / Sephora; Rossmann is **not** on Ceneo |
| Skąpiec.pl      | HTML, results dominated by Amazon.pl                                      | –                                                               | none                             | low value                                                             |
| Kontigo         | `kontigo.com.pl` no longer resolves                                       | –                                                               | –                                | chain is gone                                                         |

Proof on one product, **Nivea Soft 300 ml, EAN 4005900009319** (prices on 2026-09-17):

| Shop            | Price        | Notes                                                                                                          |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| dm              | 18,95 zł     | unit price 63,17 zł / l                                                                                        |
| Drogerie Natura | 22,99 zł     | Omnibus lowest 30-day: 23,99 zł                                                                                |
| Rossmann        | 26,99 zł     | `pricePerUnit: "100 ml = 9,00 zł"`, `differentPricesInShop: true`                                              |
| Super-Pharm     | 36,99 zł     | product page JSON-LD confirms `gtin13: 4005900009319`                                                          |
| Hebe            | 24,99 zł (?) | EAN query returned an item with `Pojemność: 0.237` (237 ml) → Hebe's EAN mapping is not clean for this product |

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
- `items[]` fields: `id, rossnetId, brand, brandId, name, caption, fallbackName, fallbackCaption, unit, price, pricePerUnit, vat, eanNumber[], navigateUrl, pictures[], promotion, availability, category, attributes, badges, averageRating, totalReviews, dimensional, hasRichContent, isInOut`.
- Product detail (`v2/api/Products/{id}`) adds: `promotions[], availability ("available"), differentPricesInShop (bool), colorVariants, variants, shelvesNavigateUrl, brandUrls`. `shopNumber=<store id>` should give store-specific price/stock.
- Other routes seen in the bundle, not tested: `/v4/api/Products/filters`, `/api/Products/{id}/additionals`, `/api/shops/{shopNumber}/products/stocks?productsIds=...`, `/api/Shops?...`, `/api/v3/Suggestion?Search=...` (different base), `/api/v1/Catalog?...` (alternative catalog base).
- Limitations: **text search only**. `search=4005900009319` returns 0 items, so resolve by name and filter on `eanNumber` client-side. `v2/api/Products?ids=26900&ids=11790` returned HTTP 400 (parameter format not figured out).
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

- Response: `results.{ query, total_hits, hits[], facets[] }`. Each hit: `url` (Hebe product id, e.g. `000000000000218807`), `attributes{...}`.
- Useful attributes: `title, name[], brand[], ShortDescription[] (contains size text), price, price_amount, price_sale, price_sale_amount, price_omnibus, price_omnibus_amount, AttrOmnibusPrice[], EAN[], Pojemność[] (litres as string, "0.200" = 200 ml), availability, availability_rank, web_url, image_link, ShortProductID[], SupplierCode[], CurrentProductPromotions[], Promocje[], TrustmateAverageGrade, currency`.
- Quirks: the hit list can include a query-suggestion pseudo-hit (`"url":"nivea soft"` with empty attributes) → keep only hits that have `attributes.price`. Prices are strings (`"15.99"`); `price_sale` is the current promo price, `price` the regular one.
- Sample hit (trimmed):

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

- Dead ends: SFCC `Search-UpdateGrid` returns HTTP 410 (disabled); no OCAPI/SCAPI `client_id` exposed in the page; robots.txt explicitly disallows AI crawlers (ClaudeBot, CCBot, Bytespider, Scrapy, …).

### 2.3 Super-Pharm (superpharm.pl)

- Platform: Magento 2 + Algolia (extension v3.9.1). The `algoliaConfig` JSON embedded in every page carries `applicationId: "EP43QPDX9Q"`, `indexName: "spprod_drugstore_pl_simple"` and a **search-only** `apiKey` (base64 secured key that embeds `tagFilters`; it rotates with deployments, so read it from the page at runtime). Key seen on 2026-09-17: `NjRmYmE4ZDZhMDg5ODhkMjg1MzIzM2M1NzUwODE1MGFmN2E4NTllNjM2MmJmMzdhZmJkODQ3MmUzNTg4ZWZjOHRhZ0ZpbHRlcnM9`.
- The Magento index for products is `<indexName>_products`, i.e. **`spprod_drugstore_pl_simple_products`**. Replicas: `..._price_default_asc`, `..._price_default_desc`, `..._created_at_desc`. A separate `spprod_pharmacy_pl` index serves apteka.superpharm.pl.

```
POST https://EP43QPDX9Q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query
Headers: X-Algolia-Application-Id: EP43QPDX9Q
         X-Algolia-API-Key: <apiKey from algoliaConfig>
         Content-Type: application/json
Body:    {"params":"query=nivea%20soft&hitsPerPage=20"}
```

- Hit fields: `name, sku, url, brand, capacity ("300 ml"), farmax_capacity (300), price.PLN.{default, default_formated, default_historical_min_price_formated (Omnibus), special_from_date, special_to_date}, in_stock, showRedPrice, rating_summary, reviews_count, categories, thumbnail_url, variant_skus, variant_attribute, isProductRx, pharmaceuticalFlag, objectID`.
- No EAN in the index. The product page JSON-LD has it: `"gtin13":"4005900009319"` plus `offers.price`, `availability`, `priceValidUntil`.
- Sample hit (trimmed):

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
- superpharm.pl: Magento defaults; `/catalogsearch/result/` not disallowed.
- dm.pl: `Disallow: /search` (site path; the API host is separate).
- drogerienatura.pl: `Disallow: /catalogsearch/*` (site path; Luigi's Box is separate).
- sephora.pl: disallows many SFCC parameter URLs; irrelevant because Akamai blocks anyway.

## 6. Matching "name + size" across shops

1. Resolve the user's input once to a canonical product with an **EAN**: query Rossmann `v4/api/Products` (returns `eanNumber[]` + `unit`) or dm (returns `gtin` + size in title). Let the user pick if several sizes/variants match.
2. Look up the EAN directly where supported: Hebe (Luigi's Box `q=<EAN>`), Natura (`q=<EAN>`), dm (`query=<GTIN>`).
3. Rossmann: text search, then keep items whose `eanNumber` contains the EAN.
4. Super-Pharm: Algolia text search, filter by brand + `farmax_capacity`, confirm via product page `gtin13` when ambiguous.
5. Normalise sizes before comparing: Rossmann `"300 ml"`, Hebe litres `"0.300"`, Natura `size`+`size_unit`, Super-Pharm `"300 ml"` / `300`, dm text inside `title`. Convert to ml / g / pcs.
6. Fallback matching when EAN data is missing or wrong (seen at Hebe): brand + normalised name tokens + size within ±5 %.
7. Keep Omnibus / promo fields separately: Hebe `price_sale`, `price_omnibus`; Natura `price_old_amount`, `lowest_price`; Super-Pharm `default_historical_min_price_formated`; Rossmann `promotion`.

## 7. Caveats

- All five working endpoints are **internal and undocumented**. Index names, tracker ids, Algolia keys and response shapes can change without notice. Implement one adapter per shop with a health check (known EAN → expected fields) and read dynamic values (Algolia key, Luigi's Box tracker) from the live page.
- Terms of use of the shops generally prohibit automated access; low-volume personal use is common practice, a commercial product would need permission or official feeds (Notino affiliate feed, Ceneo partner API, Allegro API).
- Be polite: cache results (prices change at most a few times per day), stay around 1 request/s or less per host, set a descriptive User-Agent, back off on 429/5xx.
- Online price ≠ shelf price. Rossmann marks `differentPricesInShop: true`; Rossmann and Hebe have app-only / loyalty prices; Super-Pharm has club prices. `shopNumber` (Rossmann) allows store-level checks.
- Hebe's EAN attribute was wrong for at least one product → never trust a single identifier blindly; cross-check size.

## 8. Recommendation for the MVP

- Start with the five open sources (Rossmann, Hebe, Super-Pharm, dm, Natura). They already answer "where is it cheapest" for drugstore products and need no browser automation.
- Architecture: `resolve(name, size) → EAN candidates` → `adapters[shop].byEan / .search` → `normalise(size, price)` → table sorted by price. One adapter ≈ 30–60 lines each.
- Defer Sephora / Douglas / Notino. When needed, add them via Ceneo product pages (Douglas, Notino) or the Notino affiliate feed, and only then consider Playwright or a paid scraping API.

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
