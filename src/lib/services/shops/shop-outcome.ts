import type { GateOutcome, PriceCheck, ShopUnavailable } from "@/types";

// Shared by the shop adapters, so every shop explains a refused or failed call in the same terms.

/**
 * True for an answer that says the shop can't be asked now: busy under the cap, paused or stopped. A price refresh
 * asks that shop nothing more, since the next request could only be refused, or reach a shop that has just refused. A
 * failed call isn't one: the next request may still get through.
 */
export function isRefusal(check: PriceCheck): check is ShopUnavailable {
  return check.kind === "unavailable" && check.reason !== "failed";
}

/**
 * True for a gate outcome that carries the shop's response, whatever it says: an answer to read (`ok`), an error status
 * (`failed` with reason `http`), a block or a rate limit. False when the shop gave none: the call timed out or failed
 * on the network, or the gate skipped it, busy under the cap, paused, stopped, or with a counter it couldn't reach.
 */
export function shopResponded(outcome: GateOutcome): boolean {
  switch (outcome.kind) {
    case "ok":
    case "blocked":
    case "rate-limited":
      return true;
    case "failed":
      return outcome.reason === "http";
    case "skipped":
      return false;
  }
}

/** Says why the gate produced no answer, in the terms the page explains to the user. */
export function gateUnavailable(outcome: Exclude<GateOutcome, { kind: "ok" }>): ShopUnavailable {
  switch (outcome.kind) {
    case "skipped":
      if (outcome.reason === "capped") {
        return { kind: "unavailable", reason: "busy" };
      }
      if (outcome.reason === "paused") {
        return { kind: "unavailable", reason: "paused", until: outcome.until };
      }
      return { kind: "unavailable", reason: outcome.reason === "stopped" ? "stopped" : "failed" };
    case "rate-limited": {
      const until = new Date(Date.now() + outcome.retryAfterSeconds * 1000).toISOString();
      return { kind: "unavailable", reason: "paused", until };
    }
    case "blocked":
      return { kind: "unavailable", reason: "stopped" };
    case "failed":
      return { kind: "unavailable", reason: "failed" };
  }
}
