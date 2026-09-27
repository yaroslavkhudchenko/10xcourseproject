/** A shop the deployment calls. The ids match the rows seeded into `public.shops`. */
export type ShopId = "rossmann" | "hebe" | "super-pharm" | "natura";

/**
 * What one request through the shop gate (`src/lib/services/shop-gate.ts`) came to. Only `ok` carries the shop's
 * response; every other kind means the call produced no price.
 *
 * - `skipped`: the gate didn't call the shop. The per-minute cap was reached (`capped`), the shop is paused after a
 *   429 (`paused`, with `until`), it's stopped after a block (`stopped`), or the request counter couldn't be reached
 *   (`unavailable`).
 * - `rate-limited`: the shop answered 429, and the gate paused it.
 * - `blocked`: the shop answered 403 or a bot challenge, and the gate stopped it until the owner re-enables it.
 * - `failed`: the request timed out, failed on the network, or got another non-2xx status (`http`).
 */
export type GateOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "skipped"; reason: "capped" | "paused" | "stopped" | "unavailable"; until?: string }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "blocked"; status: number }
  | { kind: "failed"; reason: "timeout" | "network" | "http"; status?: number };
