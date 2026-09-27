import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createShopGate, shopGateFor, type ShopGateDeps, type ShopGateLogEntry } from "@/lib/services/shop-gate";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";

// Every shop answer here is synthetic and served by the replay fetch; no test reaches a live shop.
const USER_AGENT = "DrogeriaRadar/0.1 (+https://github.com/yaroslavkhudchenko/10xcourseproject)";
const ROSSMANN_SEARCH = "https://www.rossmann.pl/products/v4/api/Products?search=nivea%20soft&pageSize=1";
const HEBE_SEARCH = "https://live.luigisbox.com/search?tracker_id=421168-505233&q=nivea%20soft";
const NATURA_SEARCH = "https://live.luigisbox.com/search?tracker_id=703598-939363&q=nivea%20soft";

interface SetupOptions {
  reservation?: unknown;
  entries?: ReplayEntry[];
  timeoutMs?: number;
}

/** A gate over spies. Its only inputs are the reservation's answer and the recorded shop responses. */
function setup({ reservation = { outcome: "allowed" }, entries = [], timeoutMs }: SetupOptions = {}) {
  const reserve = vi.fn<ShopGateDeps["reserve"]>(() => Promise.resolve(reservation));
  const reportBlock = vi.fn<ShopGateDeps["reportBlock"]>(() => Promise.resolve());
  const fetchMock = vi.fn(createReplayFetch(entries));
  const log = vi.fn<(entry: ShopGateLogEntry) => void>();
  const gate = createShopGate({ reserve, reportBlock, fetch: fetchMock, log, timeoutMs });
  return { gate, reserve, reportBlock, fetchMock, log };
}

/** The URL of the first request the replay fetch got, so a test can't pass on the wrong request. */
function requestedUrl(fetchMock: Mock<typeof fetch>): string {
  const [input] = fetchMock.mock.calls[0];
  return input instanceof Request ? input.url : new URL(input).href;
}

interface RpcAnswer {
  data: unknown;
  error: { message: string } | null;
}

/** A Supabase client stub whose rpc answers from a table and records every call and the time limit it got. */
function stubClient(answers: Partial<Record<string, RpcAnswer>>) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((fn: string, _args: Record<string, unknown>) => ({
    abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(answers[fn] ?? { data: null, error: { message: `no stubbed answer for ${fn}` } });
    },
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, signals };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shop gate: reservation", () => {
  it("fetches an allowed request with the descriptive User-Agent and hands back the response", async () => {
    const body = '{"data":{"items":[]}}';
    const { gate, reserve, fetchMock, log } = setup({ entries: [{ url: ROSSMANN_SEARCH, status: 200, body }] });

    const outcome = await gate.fetch("rossmann", ROSSMANN_SEARCH, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });

    if (outcome.kind !== "ok") {
      throw new Error(`expected ok, got ${outcome.kind}`);
    }
    expect(await outcome.response.text()).toBe(body);
    expect(reserve).toHaveBeenCalledWith("rossmann");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl(fetchMock)).toBe(ROSSMANN_SEARCH);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("User-Agent")).toBe(USER_AGENT);
    expect(headers.get("Accept")).toBe("application/json");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    { reservation: { outcome: "capped" }, expected: { kind: "skipped", reason: "capped" } },
    {
      reservation: { outcome: "paused", until: "2026-09-27T12:15:00+00:00" },
      expected: { kind: "skipped", reason: "paused", until: "2026-09-27T12:15:00+00:00" },
    },
    { reservation: { outcome: "stopped" }, expected: { kind: "skipped", reason: "stopped" } },
  ])(
    "skips the shop without fetching when the reservation is $reservation.outcome",
    async ({ reservation, expected }) => {
      const { gate, fetchMock, log } = setup({ reservation, entries: [{ url: ROSSMANN_SEARCH, status: 200 }] });

      expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual(expected);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it("fails closed without fetching when the reservation call rejects", async () => {
    const { gate, reserve, fetchMock, log } = setup({ entries: [{ url: ROSSMANN_SEARCH, status: 200 }] });
    reserve.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual({ kind: "skipped", reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0].note).toContain("ECONNREFUSED");
  });

  it.each([
    { answer: "a shop missing from public.shops", reservation: { outcome: "unknown_shop" } },
    { answer: "an unknown outcome", reservation: { outcome: "maybe" } },
    { answer: "a pause without its end", reservation: { outcome: "paused" } },
    { answer: "no result", reservation: null },
  ])("fails closed without fetching on $answer", async ({ reservation }) => {
    const { gate, fetchMock, log } = setup({ reservation, entries: [{ url: ROSSMANN_SEARCH, status: 200 }] });

    expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual({ kind: "skipped", reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("is unavailable without a Supabase client and never calls the shop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(createReplayFetch([{ url: ROSSMANN_SEARCH, status: 200 }]));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await shopGateFor(null).fetch("rossmann", ROSSMANN_SEARCH);

    expect(outcome).toEqual({ kind: "skipped", reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
    // The default logger writes the outcome as one JSON line.
    expect(warn).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ event: "shop-gate", shopId: "rossmann", outcome });
  });
});

describe("shop gate: rate limits", () => {
  it("pauses the shop on a 429 with Retry-After in seconds", async () => {
    const { gate, reportBlock } = setup({
      entries: [{ url: HEBE_SEARCH, status: 429, headers: { "Retry-After": "120" } }],
    });

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "rate-limited", retryAfterSeconds: 120 });
    expect(reportBlock).toHaveBeenCalledWith("hebe", "rate_limited", 120);
  });

  it("pauses the shop on a 503 that says when to come back", async () => {
    const { gate, reportBlock } = setup({
      entries: [{ url: HEBE_SEARCH, status: 503, headers: { "Retry-After": "120" } }],
    });

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "rate-limited", retryAfterSeconds: 120 });
    expect(reportBlock).toHaveBeenCalledWith("hebe", "rate_limited", 120);
  });

  it("computes the pause from a Retry-After HTTP date", async () => {
    const retryAt = new Date(Date.now() + 300_000).toUTCString();
    const { gate, reportBlock } = setup({
      entries: [{ url: HEBE_SEARCH, status: 429, headers: { "Retry-After": retryAt } }],
    });

    const outcome = await gate.fetch("hebe", HEBE_SEARCH);

    if (outcome.kind !== "rate-limited") {
      throw new Error(`expected rate-limited, got ${outcome.kind}`);
    }
    // An HTTP date has whole seconds only, so five minutes ahead reads as 299 or 300 seconds.
    expect(outcome.retryAfterSeconds).toBeGreaterThanOrEqual(299);
    expect(outcome.retryAfterSeconds).toBeLessThanOrEqual(300);
    expect(reportBlock).toHaveBeenCalledWith("hebe", "rate_limited", outcome.retryAfterSeconds);
  });

  it.each([
    { retryAfter: undefined, seconds: 900 },
    { retryAfter: "0", seconds: 1 },
    { retryAfter: "604800", seconds: 86_400 },
    // Not an HTTP date, although Date.parse would read it as one in 2001.
    { retryAfter: "1.5", seconds: 900 },
  ])("pauses for $seconds s when Retry-After is $retryAfter", async ({ retryAfter, seconds }) => {
    const headers = retryAfter === undefined ? undefined : { "Retry-After": retryAfter };
    const { gate, reportBlock } = setup({ entries: [{ url: HEBE_SEARCH, status: 429, headers }] });

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "rate-limited", retryAfterSeconds: seconds });
    expect(reportBlock).toHaveBeenCalledWith("hebe", "rate_limited", seconds);
  });
});

describe("shop gate: blocks", () => {
  it("stops the shop on a 403", async () => {
    const { gate, reportBlock } = setup({ entries: [{ url: HEBE_SEARCH, status: 403 }] });

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "blocked", status: 403 });
    expect(reportBlock).toHaveBeenCalledWith("hebe", "blocked", undefined, "HTTP 403");
  });

  it.each([503, 429])("stops the shop on a bot challenge served with status %i", async (status) => {
    const { gate, reportBlock } = setup({
      entries: [{ url: HEBE_SEARCH, status, headers: { "cf-mitigated": "challenge" } }],
    });

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "blocked", status });
    expect(reportBlock).toHaveBeenCalledTimes(1);
    expect(reportBlock).toHaveBeenCalledWith("hebe", "blocked", undefined, "challenge");
  });
});

describe("shop gate: failures", () => {
  it("returns failed/http on a 500 without reporting a block", async () => {
    const { gate, reportBlock } = setup({ entries: [{ url: ROSSMANN_SEARCH, status: 500 }] });

    expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual({ kind: "failed", reason: "http", status: 500 });
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it("returns failed/timeout when the shop doesn't answer in time", async () => {
    const { gate, reportBlock } = setup({ entries: [{ url: ROSSMANN_SEARCH, error: "timeout" }], timeoutMs: 20 });

    expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual({ kind: "failed", reason: "timeout" });
    expect(reportBlock).not.toHaveBeenCalled();
  });

  it("returns failed/network when the request fails", async () => {
    const { gate, fetchMock } = setup({ entries: [{ url: ROSSMANN_SEARCH, error: "network" }] });

    expect(await gate.fetch("rossmann", ROSSMANN_SEARCH)).toEqual({ kind: "failed", reason: "network" });
    // An unrecorded URL would end as a network failure too, so check that the recorded one was requested.
    expect(requestedUrl(fetchMock)).toBe(ROSSMANN_SEARCH);
  });
});

describe("shop gate: guards", () => {
  it.each([
    { url: "https://example.com/search?q=nivea", why: "a foreign host" },
    { url: HEBE_SEARCH, why: "another shop's host" },
    { url: "http://www.rossmann.pl/products/v4/api/Products", why: "plain http" },
    { url: "https://www.rossmann.pl:8443/products/v4/api/Products", why: "a non-default port" },
    { url: "https://user:pass@www.rossmann.pl/products/v4/api/Products", why: "credentials in the URL" },
  ])("throws a TypeError for $why, before reserving", async ({ url }) => {
    const { gate, reserve, fetchMock } = setup();

    await expect(gate.fetch("rossmann", url)).rejects.toThrow(TypeError);
    expect(reserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never follows a redirect, even when the caller asks it to", async () => {
    const { gate, fetchMock, reportBlock, log } = setup({
      entries: [{ url: ROSSMANN_SEARCH, status: 302, headers: { Location: "https://elsewhere.example/q?nivea" } }],
    });

    const outcome = await gate.fetch("rossmann", ROSSMANN_SEARCH, { redirect: "follow" });

    expect(outcome).toEqual({ kind: "failed", reason: "http", status: 302 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.redirect).toBe("manual");
    expect(reportBlock).not.toHaveBeenCalled();
    // The log names only the host the redirect pointed to.
    expect(log.mock.calls[0][0].note).toBe("redirect to elsewhere.example not followed");
  });

  it("calls fetch detached, because workerd's global fetch rejects any other `this`", async () => {
    const { gate, fetchMock } = setup({ entries: [{ url: ROSSMANN_SEARCH, status: 200 }] });

    await gate.fetch("rossmann", ROSSMANN_SEARCH);

    expect(fetchMock.mock.contexts).toEqual([undefined]);
  });

  it("keeps the outcome when reporting the block fails, and logs the failure", async () => {
    const { gate, reportBlock, log } = setup({ entries: [{ url: HEBE_SEARCH, status: 403 }] });
    reportBlock.mockRejectedValue(new Error("report_shop_block: connection refused"));

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "blocked", status: 403 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0].note).toContain("connection refused");
  });
});

describe("shop gate: Supabase binding", () => {
  it("reserves and reports through the migration's functions and parameter names", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, rpc, signals } = stubClient({
      reserve_shop_request: { data: { outcome: "allowed" }, error: null },
      report_shop_block: { data: null, error: null },
    });
    const gate = shopGateFor(client);
    // Stubbed after the gate exists: the binding looks up the global fetch on every call.
    vi.stubGlobal(
      "fetch",
      createReplayFetch([
        { url: HEBE_SEARCH, status: 403 },
        { url: NATURA_SEARCH, status: 429, headers: { "Retry-After": "120" } },
      ]),
    );

    expect(await gate.fetch("hebe", HEBE_SEARCH)).toEqual({ kind: "blocked", status: 403 });
    expect(await gate.fetch("natura", NATURA_SEARCH)).toEqual({ kind: "rate-limited", retryAfterSeconds: 120 });
    expect(rpc.mock.calls).toEqual([
      ["reserve_shop_request", { p_shop_id: "hebe" }],
      [
        "report_shop_block",
        { p_shop_id: "hebe", p_kind: "blocked", p_retry_after_seconds: null, p_detail: "HTTP 403" },
      ],
      ["reserve_shop_request", { p_shop_id: "natura" }],
      [
        "report_shop_block",
        { p_shop_id: "natura", p_kind: "rate_limited", p_retry_after_seconds: 120, p_detail: null },
      ],
    ]);
    // Every database call carries a time limit, so a stalled counter can't hold the gate open.
    expect(signals).toHaveLength(4);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("fails closed when reserve_shop_request returns an error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, rpc } = stubClient({
      reserve_shop_request: { data: null, error: { message: "permission denied for function reserve_shop_request" } },
    });
    const fetchMock = vi.fn(createReplayFetch([{ url: ROSSMANN_SEARCH, status: 200 }]));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await shopGateFor(client).fetch("rossmann", ROSSMANN_SEARCH);

    expect(outcome).toEqual({ kind: "skipped", reason: "unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("replay fetch", () => {
  it("rejects a URL that wasn't recorded, so a test never reaches the network", async () => {
    const replay = createReplayFetch([{ url: ROSSMANN_SEARCH, status: 200 }]);

    await expect(replay("https://www.rossmann.pl/products/v4/api/Products?search=other")).rejects.toThrow(
      /no recorded response/,
    );
  });
});
