import { z } from "astro/zod";
import { PRODUCT_LIMITS } from "@/lib/services/product-limits";
import type { ShopGate } from "@/lib/services/shop-gate";
import { gateUnavailable } from "@/lib/services/shops/shop-outcome";
import { parseSize } from "@/lib/services/size";
import type { ProductCandidate, ProductSearch } from "@/types";

// Rossmann's own product search (research note §2.1): text only, one page of up to 24 items, several EANs per item.
const SEARCH_URL = "https://www.rossmann.pl/products/v4/api/Products";
// Each item's `navigateUrl` is a path on this site, such as "/Produkt/Kremy-do-twarzy/NIVEA-Soft-…,26900,13049".
const SITE_URL = "https://www.rossmann.pl";
const SITE_HOST = "www.rossmann.pl";
const PAGE_SIZE = 24;
// A search the user waits for gives up after 5 s, well inside the gate's own 8 s limit.
const SEARCH_TIMEOUT_MS = 5000;

// Only the fields the watchlist uses; Rossmann sends many more, which are ignored. Pictures and EANs are checked one by
// one, so an odd value costs a thumbnail or an EAN, never the whole item.
const pictureSchema = z.object({ type: z.number().nullish(), medium: z.string().nullish() });
const itemSchema = z.object({
  id: z.union([z.number(), z.string()]),
  brand: z.string().nullish(),
  name: z.string().nullish(),
  fallbackName: z.string().nullish(),
  caption: z.string().nullish(),
  unit: z.string().nullish(),
  eanNumber: z.array(z.unknown()).nullish(),
  pictures: z.array(z.unknown()).nullish(),
  // Checked on its own too: an odd or missing one costs only the link.
  navigateUrl: z.unknown().optional(),
});
const responseSchema = z.object({
  data: z.object({ items: z.array(z.unknown()), spellCheckHint: z.unknown() }),
});

/**
 * Searches Rossmann through the gate. Resolves to the candidates (possibly none) with Rossmann's spelling hint, or to
 * `unavailable` with the reason: the gate skipped or refused the call, the call failed, or the answer wasn't readable.
 * It never throws. The query must already have passed `searchQuerySchema`.
 */
export async function searchRossmann(gate: ShopGate, query: string): Promise<ProductSearch> {
  const url = `${SEARCH_URL}?search=${encodeURIComponent(query)}&page=1&pageSize=${PAGE_SIZE}`;
  const outcome = await gate.fetch("rossmann", url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (outcome.kind !== "ok") {
    // The gate has already logged why.
    return gateUnavailable(outcome);
  }

  let body: unknown;
  try {
    // Read the body right away: the time limits cover it too.
    body = await outcome.response.json();
  } catch (error) {
    logFailure("unreadable body", error);
    return { kind: "unavailable", reason: "failed" };
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    logFailure("unexpected response shape", parsed.error);
    return { kind: "unavailable", reason: "failed" };
  }

  // Each item is checked on its own, so one odd item doesn't blank the whole search.
  const candidates = parsed.data.data.items.flatMap((item) => {
    const candidate = toCandidate(item);
    return candidate ? [candidate] : [];
  });
  const rawHint = parsed.data.data.spellCheckHint;
  const hint = typeof rawHint === "string" ? clean(rawHint) : null;
  // Rossmann answers a misspelling with results for its correction; a hint equal to the query says nothing new.
  const spellingHint = hint && hint.toLowerCase() !== query.toLowerCase() ? hint : null;
  return { kind: "results", candidates, spellingHint };
}

/** True for an https URL on a rossmann.pl host: the only images the watchlist shows. */
export function isRossmannImage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "rossmann.pl" || hostname.endsWith(".rossmann.pl"));
  } catch {
    return false;
  }
}

/** True for an https URL on Rossmann's shop site: the only product pages "Zobacz w sklepie" links to. */
export function isRossmannProductUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hostname === SITE_HOST;
  } catch {
    return false;
  }
}

/** A Rossmann item as a candidate within PRODUCT_LIMITS, so it can always be added; null when it can't be one. */
function toCandidate(raw: unknown): ProductCandidate | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data;
  const sourceItemId = String(item.id);
  // Some items carry an empty name and keep it in fallbackName instead.
  const name = clean(item.name) ?? clean(item.fallbackName);
  if (!/^\d{1,12}$/.test(sourceItemId) || name === null) {
    return null;
  }
  const sizeText = within(clean(item.unit), PRODUCT_LIMITS.sizeText);
  return {
    source: "rossmann",
    sourceItemId,
    brand: cut(clean(item.brand), PRODUCT_LIMITS.brand),
    name: name.slice(0, PRODUCT_LIMITS.name),
    caption: cut(clean(item.caption), PRODUCT_LIMITS.caption),
    sizeText,
    size: parseSize(sizeText),
    eans: (item.eanNumber ?? [])
      .filter((ean): ean is string => typeof ean === "string" && /^\d{8,14}$/.test(ean))
      .slice(0, PRODUCT_LIMITS.eans),
    productUrl: productUrlFor(item.navigateUrl),
    imageUrl: pickImage(item.pictures ?? []),
  };
}

/**
 * The item's page from its `navigateUrl`, a path on Rossmann's site; null for anything else. A full or
 * protocol-relative URL could point anywhere, so only a path counts, and the result must still be on the site.
 */
function productUrlFor(navigateUrl: unknown): string | null {
  const path = typeof navigateUrl === "string" ? clean(navigateUrl) : null;
  if (path === null || !path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  const url = within(`${SITE_URL}${path}`, PRODUCT_LIMITS.productUrl);
  return url !== null && isRossmannProductUrl(url) ? url : null;
}

/**
 * The front shot's medium-sized image (type 1), or else the first picture's. Only URLs on Rossmann's hosts within the
 * limit count, so a picture without a usable URL is passed over rather than costing the thumbnail.
 */
function pickImage(pictures: unknown[]): string | null {
  const usable = pictures.flatMap((raw) => {
    const picture = pictureSchema.safeParse(raw);
    if (!picture.success) {
      return [];
    }
    const url = within(clean(picture.data.medium), PRODUCT_LIMITS.imageUrl);
    return url !== null && isRossmannImage(url) ? [{ type: picture.data.type, url }] : [];
  });
  return (usable.find((picture) => picture.type === 1) ?? usable.at(0))?.url ?? null;
}

/** Trims a text field, and treats an empty one as missing. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Cuts text to its limit. */
function cut(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

/** Keeps text within its limit, or drops it: a cut-off size or URL would be wrong, not just shorter. */
function within(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

function logFailure(reason: string, error: unknown): void {
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  // eslint-disable-next-line no-console -- one line per unreadable Rossmann answer; Workers observability collects it.
  console.warn(JSON.stringify({ event: "rossmann-search", reason, detail }));
}
