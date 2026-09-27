import { z } from "astro/zod";
import type { ShopGate } from "@/lib/services/shop-gate";
import { parseSize } from "@/lib/services/size";
import type { ProductCandidate, ProductSearch } from "@/types";

// Rossmann's own product search (research note §2.1): text only, one page of up to 24 items, several EANs per item.
const SEARCH_URL = "https://www.rossmann.pl/products/v4/api/Products";
const PAGE_SIZE = 24;

// Only the fields the watchlist uses. Rossmann sends many more, which are ignored.
const pictureSchema = z.object({ type: z.number().optional(), medium: z.string().optional() });
const itemSchema = z.object({
  id: z.union([z.number(), z.string()]),
  brand: z.string().nullish(),
  name: z.string().nullish(),
  fallbackName: z.string().nullish(),
  caption: z.string().nullish(),
  unit: z.string().nullish(),
  eanNumber: z.array(z.string()).nullish(),
  pictures: z.array(pictureSchema).nullish(),
});
const responseSchema = z.object({
  data: z.object({ items: z.array(z.unknown()), spellCheckHint: z.string().nullish() }),
});

/**
 * Searches Rossmann through the gate. Resolves to the candidates (possibly none) with Rossmann's spelling hint, or to
 * `unavailable` when the gate skipped the call, the call failed or the answer wasn't readable; it never throws. The
 * query must already have passed `searchQuerySchema`.
 */
export async function searchRossmann(gate: ShopGate, query: string): Promise<ProductSearch> {
  const url = `${SEARCH_URL}?search=${encodeURIComponent(query)}&page=1&pageSize=${PAGE_SIZE}`;
  const outcome = await gate.fetch("rossmann", url, { headers: { Accept: "application/json" } });
  if (outcome.kind !== "ok") {
    // The gate has already logged why.
    return { kind: "unavailable" };
  }

  let body: unknown;
  try {
    // Read the body right away: the gate's timeout covers it too.
    body = await outcome.response.json();
  } catch (error) {
    logFailure("unreadable body", error);
    return { kind: "unavailable" };
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    logFailure("unexpected response shape", parsed.error);
    return { kind: "unavailable" };
  }

  // Each item is checked on its own, so one odd item doesn't blank the whole search.
  const candidates = parsed.data.data.items.flatMap((item) => {
    const candidate = toCandidate(item);
    return candidate ? [candidate] : [];
  });
  const hint = clean(parsed.data.data.spellCheckHint);
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

function toCandidate(raw: unknown): ProductCandidate | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const item = parsed.data;
  // Some items carry an empty name and keep it in fallbackName instead.
  const name = clean(item.name) ?? clean(item.fallbackName);
  if (!name) {
    return null;
  }
  const sizeText = clean(item.unit);
  return {
    source: "rossmann",
    sourceItemId: String(item.id),
    brand: clean(item.brand),
    name,
    caption: clean(item.caption),
    sizeText,
    size: parseSize(sizeText),
    eans: (item.eanNumber ?? []).filter((ean) => /^\d{8,14}$/.test(ean)),
    imageUrl: pickImage(item.pictures ?? []),
  };
}

/** The front shot's medium-sized image (type 1), or the first picture's; anything not on Rossmann's hosts is dropped. */
function pickImage(pictures: z.infer<typeof pictureSchema>[]): string | null {
  const picture = pictures.find((candidate) => candidate.type === 1) ?? pictures.at(0);
  const url = picture?.medium;
  return url && isRossmannImage(url) ? url : null;
}

/** Trims a text field, and treats an empty one as missing. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function logFailure(reason: string, error: unknown): void {
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  // eslint-disable-next-line no-console -- one line per unreadable Rossmann answer; Workers observability collects it.
  console.warn(JSON.stringify({ event: "rossmann-search", reason, detail }));
}
