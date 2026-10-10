import { vi, type Mock } from "vitest";
import { createReplayFetch, type ReplayEntry } from "@/lib/services/testing/replay-fetch";
import { stubSupabase, type StubRelation } from "@/lib/services/testing/stub-supabase";

// Test helper: the world the real gate (shopGateFor) runs in for a route or a page that reaches a shop, and the readers
// of what it reserved and what the shops were sent, defined once for every test that needs them. The stand-in database
// (stub-supabase.ts) answers the reads and the gate's counter, and the shops answer recordings (replay-fetch.ts) through
// the global fetch the gate calls, which `world` stubs and keeps here, so the readers of what was sent take no argument.
// A test that calls `world` unstubs the globals after each test (`vi.unstubAllGlobals`).

// The fetch the shops answer through, as the last `world` stubbed it.
let fetchMock: Mock<typeof fetch>;

/**
 * A test's world: the stand-in database with `relations`, the gate's counter answering `outcome` (allowed unless said
 * otherwise), and the shops answering `recordings` through the global fetch the gate calls.
 */
export function world(relations: Record<string, StubRelation>, recordings: ReplayEntry[], outcome = "allowed") {
  fetchMock = vi.fn(createReplayFetch(recordings));
  vi.stubGlobal("fetch", fetchMock);
  return stubSupabase({
    relations,
    rpc: {
      reserve_shop_request: () => ({ data: { outcome } }),
      report_shop_block: () => ({ data: null }),
    },
  });
}

/**
 * The URLs the shops were sent, in order, whether or not a recording answered them: a request the replay doesn't know
 * reads as `failed/network`, so a test that needs every shop answered asserts what the answers came to too, such as a
 * route's `done` code.
 */
export function served(): string[] {
  return fetchMock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));
}

/** The bodies sent to `url`, in order: one Algolia URL answers every Super-Pharm request, told apart by its body. */
export function bodiesSentTo(url: string): unknown[] {
  return fetchMock.mock.calls.flatMap(([input, init]) =>
    (input instanceof Request ? input.url : String(input)) === url ? [init?.body] : [],
  );
}

/** The shops the gate reserved a request for, in order. */
export function reservations(queries: unknown[][][]): unknown[] {
  return queries.flatMap(([[kind, name, args]]) => (kind === "rpc" && name === "reserve_shop_request" ? [args] : []));
}
