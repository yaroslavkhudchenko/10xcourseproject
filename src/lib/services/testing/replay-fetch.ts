// Test helper: shop lookups are tested against recorded shop responses served by this fetch, never against live shops.

/** One recorded answer for a URL, or a simulated failure. */
export type ReplayEntry =
  | { url: string; status: number; headers?: Record<string, string>; body?: string }
  | { url: string; error: "timeout" | "network" };

/**
 * Builds a fetch that answers recorded URLs only, with a fresh Response on every call. Any other URL rejects, so a test
 * can never reach the network. `error: "timeout"` never answers and rejects once the request's signal aborts;
 * `error: "network"` rejects at once with the TypeError fetch throws.
 */
export function createReplayFetch(entries: readonly ReplayEntry[]): typeof fetch {
  const recorded = entries.map((entry) => ({ href: new URL(entry.url).href, entry }));
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = input instanceof Request ? input.url : new URL(input).href;
    const entry = recorded.find((candidate) => candidate.href === href)?.entry;
    if (!entry) {
      return Promise.reject(new Error(`replay-fetch: no recorded response for ${href}`));
    }
    if ("error" in entry) {
      return entry.error === "timeout" ? waitForAbort(init?.signal) : Promise.reject(new TypeError("fetch failed"));
    }
    return Promise.resolve(new Response(entry.body ?? null, { status: entry.status, headers: entry.headers }));
  };
}

/** Behaves like a request that never answers: rejects with the signal's reason once it aborts. */
function waitForAbort(signal: AbortSignal | null | undefined): Promise<never> {
  if (!signal) {
    return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  }
  return new Promise<never>((_resolve, reject) => {
    const abort = () => {
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError");
}
