# Super-Pharm probe answers (2026-10-05)

Real answers to the owner-approved probes in `../research.md` (§ Probe results), kept for the adapter's fixtures. The adapter's phase cuts its fixtures from these files under test-plan §6.4, then deletes this folder.

| File                            | Probe | Request                                                                                                                                                                 |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p2-homepage-config-script.txt` | P2    | `GET https://www.superpharm.pl/`, 2026-10-05T13:58:07.857Z: only the `<script>` element that declares `const algoliaConfig`, characters 1,332,402–1,372,011 of the page |
| `p3-search-name.json`           | P3    | search, `query=NIVEA%20Soft%20300%20ml&hitsPerPage=10&analytics=false`, 2026-10-05T13:58:10.654Z                                                                        |
| `p5-search-ean.json`            | P5    | search, `query=4005900009319&hitsPerPage=5&analytics=false`, 2026-10-05T13:58:13.656Z                                                                                   |
| `p6-pinned.json`                | P6    | search, `filters=objectID:10132 OR objectID:999999999` with `attributesToRetrieve=objectID,price,in_stock`, 2026-10-05T13:58:16.343Z                                    |

- Every search is `POST https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query` with the search key read in P2.
- The JSON files are the answers as they came. Prettier reformats their whitespace on commit and keeps every number as written.
- The config cut is byte for byte the page's, except Magento's `formKey`, a form token from the cached page, which reads `REDACTED` in both places.
- Headers aren't kept, because they carry Cloudflare's cookies.
