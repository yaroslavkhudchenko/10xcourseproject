import { afterEach, describe, expect, it, vi } from "vitest";
import { gateUnavailable, shopResponded } from "@/lib/services/shops/shop-outcome";
import type { GateOutcome, ShopUnavailable } from "@/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gateUnavailable", () => {
  it.each<{ when: string; outcome: Exclude<GateOutcome, { kind: "ok" }>; expected: ShopUnavailable }>([
    {
      when: "the cap is reached",
      outcome: { kind: "skipped", reason: "capped" },
      expected: { kind: "unavailable", reason: "busy" },
    },
    {
      when: "the shop is paused",
      outcome: { kind: "skipped", reason: "paused", until: "2026-09-27T20:15:00+00:00" },
      expected: { kind: "unavailable", reason: "paused", until: "2026-09-27T20:15:00+00:00" },
    },
    {
      when: "the shop is stopped",
      outcome: { kind: "skipped", reason: "stopped" },
      expected: { kind: "unavailable", reason: "stopped" },
    },
    {
      when: "the counter can't be reached",
      outcome: { kind: "skipped", reason: "unavailable" },
      expected: { kind: "unavailable", reason: "failed" },
    },
    {
      when: "the shop blocks the call",
      outcome: { kind: "blocked", status: 403 },
      expected: { kind: "unavailable", reason: "stopped" },
    },
    {
      when: "the call times out",
      outcome: { kind: "failed", reason: "timeout" },
      expected: { kind: "unavailable", reason: "failed" },
    },
    {
      when: "the network fails",
      outcome: { kind: "failed", reason: "network" },
      expected: { kind: "unavailable", reason: "failed" },
    },
    {
      when: "the shop answers another error status",
      outcome: { kind: "failed", reason: "http", status: 404 },
      expected: { kind: "unavailable", reason: "failed" },
    },
  ])("says $expected.reason when $when", ({ outcome, expected }) => {
    expect(gateUnavailable(outcome)).toEqual(expected);
  });

  it("turns a rate limit into a pause that ends when its Retry-After has passed", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-27T20:00:00.000Z"));

    expect(gateUnavailable({ kind: "rate-limited", retryAfterSeconds: 120 })).toEqual({
      kind: "unavailable",
      reason: "paused",
      until: "2026-09-27T20:02:00.000Z",
    });
  });
});

// Whether the shop gave a response, whatever it says, which a refresh asking Rossmann one product at a time counts by.
describe("shopResponded", () => {
  it.each<{ when: string; outcome: GateOutcome; responded: boolean }>([
    { when: "the shop answers", outcome: { kind: "ok", response: new Response("{}") }, responded: true },
    {
      when: "the shop answers an error status",
      outcome: { kind: "failed", reason: "http", status: 500 },
      responded: true,
    },
    { when: "the shop blocks the call", outcome: { kind: "blocked", status: 403 }, responded: true },
    {
      when: "the shop asks for a pause",
      outcome: { kind: "rate-limited", retryAfterSeconds: 120 },
      responded: true,
    },
    { when: "the call times out", outcome: { kind: "failed", reason: "timeout" }, responded: false },
    { when: "the network fails", outcome: { kind: "failed", reason: "network" }, responded: false },
    { when: "the cap is reached", outcome: { kind: "skipped", reason: "capped" }, responded: false },
    {
      when: "the shop is paused",
      outcome: { kind: "skipped", reason: "paused", until: "2026-09-27T20:15:00+00:00" },
      responded: false,
    },
    { when: "the shop is stopped", outcome: { kind: "skipped", reason: "stopped" }, responded: false },
    { when: "the counter can't be reached", outcome: { kind: "skipped", reason: "unavailable" }, responded: false },
  ])("says $responded when $when", ({ outcome, responded }) => {
    expect(shopResponded(outcome)).toBe(responded);
  });
});
