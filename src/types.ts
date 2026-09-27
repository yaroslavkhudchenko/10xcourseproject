/** A shop the deployment calls. The ids match the rows seeded into `public.shops`. */
export type ShopId = "rossmann" | "hebe" | "super-pharm" | "natura";

/**
 * What one request through the shop gate (`src/lib/services/shop-gate.ts`) came to. Only `ok` carries the shop's
 * response; every other kind means the call produced no price.
 *
 * - `skipped`: the gate didn't call the shop. The per-minute cap was reached (`capped`), the shop is paused after a
 *   429 (`paused`, with `until`), it's stopped after a block (`stopped`), or the request counter couldn't be reached
 *   (`unavailable`).
 * - `rate-limited`: the shop answered 429, or 503 with Retry-After, and the gate paused it.
 * - `blocked`: the shop answered 403 or a bot challenge, and the gate stopped it until the owner re-enables it.
 * - `failed`: the request timed out, failed on the network, or got another non-2xx status (`http`).
 */
export type GateOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "skipped"; reason: "capped" | "paused" | "stopped" | "unavailable"; until?: string }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "blocked"; status: number }
  | { kind: "failed"; reason: "timeout" | "network" | "http"; status?: number };

/** The units sizes are compared in: millilitres, grams or pieces. */
export type SizeUnit = "ml" | "g" | "pcs";

/** A size in a comparable unit, parsed from a shop's size text. */
export interface Size {
  value: number;
  unit: SizeUnit;
}

/**
 * One product a shop's search returned, as the user can pick it for their watchlist. Picking it fixes the product's
 * identity; its EANs are only helpers for later shop lookups (FR-004).
 */
export interface ProductCandidate {
  source: ShopId;
  /** The shop's own product id. */
  sourceItemId: string;
  brand: string | null;
  name: string;
  caption: string | null;
  /** The size as the shop wrote it, and parsed when that was possible. */
  sizeText: string | null;
  size: Size | null;
  eans: string[];
  imageUrl: string | null;
}

/** A product on the user's own watchlist, as the list shows it. */
export interface WatchlistItem {
  id: string;
  source: ShopId;
  sourceItemId: string;
  brand: string | null;
  name: string;
  caption: string | null;
  sizeText: string | null;
  imageUrl: string | null;
  /** When the user added it, as an ISO timestamp. */
  addedAt: string;
}

/** What a product search came to: candidates (possibly none) with the shop's spelling hint, or unavailable. */
export type ProductSearch =
  { kind: "results"; candidates: ProductCandidate[]; spellingHint: string | null } | { kind: "unavailable" };
