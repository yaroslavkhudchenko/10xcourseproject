import type { SupabaseClient } from "@supabase/supabase-js";
import type { GateOutcome, ShopId } from "@/types";

// The shop gate: every request from the deployment to a shop goes through `gate.fetch`. It reserves a slot under the
// deployment-wide per-shop cap, calls the shop with an honest User-Agent and a timeout, classifies the answer, and
// pauses or stops a shop that refuses. This is the one place the politeness rules live.

/** The hosts each shop's requests may go to, lowercase as `URL` normalises them. */
export const SHOP_HOSTS: Record<ShopId, readonly string[]> = {
  rossmann: ["www.rossmann.pl"],
  hebe: ["www.hebe.pl", "live.luigisbox.com", "scripts.luigisbox.com"],
  natura: ["www.drogerienatura.pl", "live.luigisbox.com"],
  "super-pharm": ["www.superpharm.pl", "ep43qpdx9q-dsn.algolia.net"],
};

// The descriptive User-Agent the research note asks for (§7); the egress probes used the same one (§9).
const USER_AGENT = "DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)";
const DEFAULT_TIMEOUT_MS = 8000;
// The same default and bounds that report_shop_block applies to a pause.
const DEFAULT_RETRY_AFTER_SECONDS = 900;
const MAX_RETRY_AFTER_SECONDS = 86_400;
// How long a reservation or a block report may take before the gate gives up on the counter.
const COUNTER_TIMEOUT_MS = 2000;

/** A refusal as report_shop_block records it: `rate_limited` pauses the shop, `blocked` stops it. */
export type ShopBlockKind = "rate_limited" | "blocked";

/**
 * The log entry for a gate call that didn't end in `ok`. The query string is left out, since it can hold a user's
 * search, and every all-digit path segment is logged as `:id`, since Rossmann's product id names a product.
 */
export interface ShopGateLogEntry {
  event: "shop-gate";
  shopId: ShopId;
  host: string;
  /** The URL's path with every all-digit segment as `:id`, such as `/products/v2/api/Products/:id`. */
  path: string;
  outcome: Exclude<GateOutcome, { kind: "ok" }>;
  /** Why the gate failed closed, what the request failed with, or why reporting a block failed. */
  note?: string;
}

export interface ShopGateDeps {
  /** Reserves one request slot. Resolves to reserve_shop_request's result; rejects when the counter can't be reached. */
  reserve: (shopId: ShopId) => Promise<unknown>;
  /** Records a shop's refusal through report_shop_block. */
  reportBlock: (shopId: ShopId, kind: ShopBlockKind, retryAfterSeconds?: number, detail?: string) => Promise<void>;
  fetch: typeof fetch;
  /** Milliseconds before a shop request is aborted. Defaults to 8000. */
  timeoutMs?: number;
  /** Gets one entry for every call that didn't end in `ok`. Defaults to a JSON line on `console.warn`. */
  log?: (entry: ShopGateLogEntry) => void;
}

export interface ShopGate {
  /**
   * Calls a shop politely and resolves to the outcome. Rejects with a TypeError, before reserving anything, unless the
   * URL is plain https to one of the shop's hosts. The timeout covers reading an `ok` response's body too, so read it
   * promptly.
   */
  fetch: (shopId: ShopId, url: string | URL, init?: RequestInit) => Promise<GateOutcome>;
}

type Reservation =
  { outcome: "allowed" | "capped" | "stopped" | "unknown_shop" } | { outcome: "paused"; until: string };

/** Builds a gate over injected dependencies. `shopGateFor` wires them to Supabase and the global `fetch`. */
export function createShopGate(deps: ShopGateDeps): ShopGate {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = deps.log ?? logJsonLine;
  // Called detached: workerd's global fetch throws "Illegal invocation" when it's called as another object's method.
  const { fetch: send } = deps;

  // A failed report must not change the outcome, so its error only goes into the log entry.
  async function report(...args: Parameters<ShopGateDeps["reportBlock"]>): Promise<string | undefined> {
    try {
      await deps.reportBlock(...args);
      return undefined;
    } catch (error) {
      return `report failed: ${describeError(error)}`;
    }
  }

  return {
    async fetch(shopId, url, init) {
      const target = new URL(url);
      // Plain https on the default port, without credentials, to one of the shop's hosts.
      const plain = target.protocol === "https:" && target.port === "" && !target.username && !target.password;
      if (!plain || !SHOP_HOSTS[shopId].includes(target.hostname)) {
        // A programming error: the gate never sends a request to a host outside the shop's list.
        throw new TypeError(`${target.protocol}//${target.host} is not a ${shopId} URL`);
      }
      const settle = (outcome: ShopGateLogEntry["outcome"], note?: string): GateOutcome => {
        log({ event: "shop-gate", shopId, host: target.hostname, path: loggedPath(target.pathname), outcome, note });
        return outcome;
      };

      // Reserve before touching the network. Anything but a clear answer fails closed.
      let reserved: unknown;
      try {
        reserved = await deps.reserve(shopId);
      } catch (error) {
        return settle({ kind: "skipped", reason: "unavailable" }, `reserve failed: ${describeError(error)}`);
      }
      const reservation = readReservation(reserved);
      if (!reservation) {
        return settle({ kind: "skipped", reason: "unavailable" }, "unrecognised reservation result");
      }
      if (reservation.outcome === "unknown_shop") {
        return settle({ kind: "skipped", reason: "unavailable" }, "no public.shops row for this shop");
      }
      if (reservation.outcome === "paused") {
        return settle({ kind: "skipped", reason: "paused", until: reservation.until });
      }
      if (reservation.outcome !== "allowed") {
        return settle({ kind: "skipped", reason: reservation.outcome });
      }

      const timeout = AbortSignal.timeout(timeoutMs);
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", USER_AGENT);
      let response: Response;
      try {
        response = await send(target, {
          ...init,
          headers,
          // Never follow a redirect: its next hop would skip the host check and the reservation.
          redirect: "manual",
          signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
      } catch (error) {
        // Only the gate's own timer makes a timeout. Any other rejection, a caller's abort included, is a network one.
        return settle({ kind: "failed", reason: timeout.aborted ? "timeout" : "network" }, describeError(error));
      }

      // A bot challenge stops the shop whatever the status, even on a 429: the shop asks us to stop, not to slow down.
      const challenged = response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";
      if (challenged || response.status === 403) {
        discard(response);
        const detail = challenged ? "challenge" : `HTTP ${response.status}`;
        const failure = await report(shopId, "blocked", undefined, detail);
        return settle({ kind: "blocked", status: response.status }, failure);
      }
      // A 503 that says when to come back asks us to slow down, just like a 429 (research note §7).
      if (response.status === 429 || (response.status === 503 && response.headers.has("Retry-After"))) {
        discard(response);
        const seconds = parseRetryAfter(response.headers.get("Retry-After"));
        const failure = await report(shopId, "rate_limited", seconds);
        return settle({ kind: "rate-limited", retryAfterSeconds: seconds }, failure);
      }
      if (response.ok) {
        return { kind: "ok", response };
      }
      discard(response);
      return settle({ kind: "failed", reason: "http", status: response.status }, redirectNote(response, target));
    },
  };
}

/**
 * The gate for one request, bound to that request's Supabase client. The user's session makes both functions run as
 * `authenticated`, the only role allowed to execute them. Without a client every call is skipped as `unavailable` and
 * no shop is called.
 */
export function shopGateFor(supabase: SupabaseClient | null): ShopGate {
  if (!supabase) {
    return createShopGate({
      reserve: () => Promise.reject(new Error("Supabase is not configured")),
      reportBlock: () => Promise.resolve(),
      fetch: () => Promise.reject(new TypeError("no shop is called without Supabase")),
    });
  }
  return createShopGate({
    reserve: async (shopId) => {
      const result = await supabase
        .rpc("reserve_shop_request", { p_shop_id: shopId })
        .abortSignal(AbortSignal.timeout(COUNTER_TIMEOUT_MS));
      if (result.error) {
        throw new Error(`reserve_shop_request: ${result.error.message}`);
      }
      const reservation: unknown = result.data;
      return reservation;
    },
    reportBlock: async (shopId, kind, retryAfterSeconds, detail) => {
      const { error } = await supabase
        .rpc("report_shop_block", {
          p_shop_id: shopId,
          p_kind: kind,
          p_retry_after_seconds: retryAfterSeconds ?? null,
          p_detail: detail ?? null,
        })
        .abortSignal(AbortSignal.timeout(COUNTER_TIMEOUT_MS));
      if (error) {
        throw new Error(`report_shop_block: ${error.message}`);
      }
    },
    // Looked up on every call rather than captured, so tests can stub the global.
    fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  });
}

/** Narrows reserve_shop_request's result. Anything else is null, which the gate treats as unavailable. */
function readReservation(value: unknown): Reservation | null {
  if (typeof value !== "object" || value === null || !("outcome" in value)) {
    return null;
  }
  const { outcome } = value;
  if (outcome === "paused") {
    return "until" in value && typeof value.until === "string" ? { outcome, until: value.until } : null;
  }
  if (outcome === "allowed" || outcome === "capped" || outcome === "stopped" || outcome === "unknown_shop") {
    return { outcome };
  }
  return null;
}

/** Reads Retry-After as delta-seconds or an HTTP date. Missing or unreadable means 900 s; the result is 1-86400 s. */
function parseRetryAfter(header: string | null): number {
  const value = header?.trim() ?? "";
  let seconds = DEFAULT_RETRY_AFTER_SECONDS;
  if (/^\d+$/.test(value)) {
    seconds = Number(value);
  } else if (/[a-z]/i.test(value)) {
    // Every HTTP date names a weekday and a month. Date.parse alone would also read "1.5" or "-5" as dates in 2001.
    const retryAt = Date.parse(value);
    if (!Number.isNaN(retryAt)) {
      seconds = Math.ceil((retryAt - Date.now()) / 1000);
    }
  }
  return Math.min(Math.max(seconds, 1), MAX_RETRY_AFTER_SECONDS);
}

/** Frees the connection behind a response the caller never gets. A body that can't be cancelled is left alone. */
function discard(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

/** A path as the log shows it: every all-digit segment, such as a product id, becomes `:id`. */
function loggedPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) ? ":id" : segment))
    .join("/");
}

/** Names where a redirect the gate didn't follow pointed. Only the host: the rest of a Location can hold a search. */
function redirectNote(response: Response, from: URL): string | undefined {
  const location = response.status >= 300 && response.status < 400 ? response.headers.get("Location") : null;
  if (location === null) {
    return undefined;
  }
  try {
    return `redirect to ${new URL(location, from).host} not followed`;
  } catch {
    return "redirect not followed";
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function logJsonLine(entry: ShopGateLogEntry): void {
  // eslint-disable-next-line no-console -- the gate's one log line; Workers observability collects console output.
  console.warn(JSON.stringify(entry));
}
