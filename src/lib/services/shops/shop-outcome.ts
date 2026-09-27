import type { GateOutcome, ShopUnavailable } from "@/types";

// Shared by the shop adapters, so every shop explains a refused or failed call in the same terms.

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
