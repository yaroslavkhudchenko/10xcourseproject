// Test helper: shop lookups are tested against recorded shop responses served by this fetch, never against live shops.

/**
 * One recorded answer for a request, or a simulated failure. A request is its URL and its body: an entry with
 * `requestBody` answers only a request that sends exactly that text, such as a POST search, and an entry without it
 * only a request with no body.
 */
export type ReplayEntry =
  | { url: string; requestBody?: string; status: number; headers?: Record<string, string>; body?: string }
  | { url: string; requestBody?: string; error: "timeout" | "network" };

/**
 * Builds a fetch that answers recorded requests only, with a fresh Response on every call. Any other request rejects,
 * and so does one whose body isn't text, which no recording can name, so a test can never reach the network.
 * `error: "timeout"` never answers and rejects once the request's signal aborts; `error: "network"` rejects at once
 * with the TypeError fetch throws.
 */
export function createReplayFetch(entries: readonly ReplayEntry[]): typeof fetch {
  const recorded = entries.map((entry) => ({
    href: new URL(entry.url).href,
    requestBody: entry.requestBody ?? null,
    entry,
  }));
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = input instanceof Request ? input.url : new URL(input).href;
    // The body given with the call, else a Request's own, which is a stream.
    const body = init?.body ?? (input instanceof Request ? input.body : null);
    if (body !== null && typeof body !== "string") {
      return Promise.reject(new Error(`replay-fetch: a request body must be text to match a recording, for ${href}`));
    }
    const entry = recorded.find((candidate) => candidate.href === href && candidate.requestBody === body)?.entry;
    if (!entry) {
      const sent = body === null ? "" : ` with body ${body}`;
      return Promise.reject(new Error(`replay-fetch: no recorded response for ${href}${sent}`));
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
