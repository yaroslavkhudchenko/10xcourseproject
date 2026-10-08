import { expect, type Mock } from "vitest";
import type { ShopGateLogEntry } from "@/lib/services/shop-gate";
import type { ReplayEntry } from "@/lib/services/testing/replay-fetch";
import type { PriceCheck, ProductSearch, ShopSearch } from "@/types";

// Test helper: the shop answers no recording holds, which a test serves through the replay (replay-fetch.ts) or, for a
// body that never ends, beside it (stallingFetch), and the readers of what the gate and the adapters made of an answer,
// defined once for every shop's tests.

/** A shop's answer as the replay serves it, for whichever request a test gives it: its status, headers and body. */
export type ServedAnswer = Omit<Extract<ReplayEntry, { status: number }>, "url" | "requestBody">;

/** A bot challenge, which Cloudflare marks with `cf-mitigated: challenge` whatever its status. */
export const CHALLENGE: ServedAnswer = {
  status: 200,
  headers: { "cf-mitigated": "challenge" },
  body: "<html>Just a moment...</html>",
};

/** A page where Rossmann's JSON should be, as a moved route, or a page in front of the API, would answer. */
export const NOT_FOUND_PAGE =
  '<!DOCTYPE html><html lang="pl"><head><title>Rossmann</title></head><body>Nie znaleziono strony</body></html>';

/**
 * A fetch that answers each of `urls` with a 200 whose headers come at once and whose body begins and never ends: it
 * errors only once the request's signal aborts, with the signal's reason, as a body a time limit cuts off does. Every
 * other request goes to `other`, such as a replay (createReplayFetch). A stalled request without a signal, whose body
 * would never end, is refused, though the gate's requests always carry one.
 */
export function stallingFetch(urls: readonly string[], other: typeof fetch): typeof fetch {
  const stalled = new Set(urls.map((url) => new URL(url).href));
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = input instanceof Request ? input.url : new URL(input).href;
    if (!stalled.has(href)) {
      return other(input, init);
    }
    const signal = init?.signal;
    if (!signal) {
      return Promise.reject(
        new Error(`stalling-fetch: a request for ${href} has no signal, so its body would never end`),
      );
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // The body's first bytes, then nothing more until the signal aborts.
        controller.enqueue(new TextEncoder().encode('{"data":{"id":'));
        const cutOff = () => {
          const reason: unknown = signal.reason;
          controller.error(reason);
        };
        if (signal.aborted) {
          cutOff();
        } else {
          signal.addEventListener("abort", cutOff, { once: true });
        }
      },
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
  };
}

/** How many seconds from now an answer's pause ends; it must be a pause with its end. */
export function pauseSecondsOf(answer: ProductSearch | ShopSearch | PriceCheck | undefined): number {
  if (answer?.kind !== "unavailable" || answer.reason !== "paused" || answer.until === undefined) {
    throw new Error(`expected a pause with its end, got ${JSON.stringify(answer)}`);
  }
  return (Date.parse(answer.until) - Date.now()) / 1000;
}

/** The outcome of each of the gate's own log lines. */
export function gateOutcomes(gateLog: Mock<(entry: ShopGateLogEntry) => void>): ShopGateLogEntry["outcome"][] {
  return gateLog.mock.calls.map(([entry]) => entry.outcome);
}

/** The one log line a test expects, parsed. */
export function loggedLine(warn: { mock: { calls: unknown[][] } }): unknown {
  expect(warn.mock.calls).toHaveLength(1);
  return JSON.parse(String(warn.mock.calls[0][0]));
}

/** Every log line, parsed. */
export function loggedLines(warn: { mock: { calls: unknown[][] } }): unknown[] {
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
}
