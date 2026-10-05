import { describe, expect, it, vi } from "vitest";
import { createShopGate } from "@/lib/services/shop-gate";
import { createReplayFetch } from "@/lib/services/testing/replay-fetch";

// Every request and answer here is synthetic; no test reaches a live shop. An Algolia search, as Super-Pharm's is, is a
// POST to one URL for every query, so only its body tells two searches apart.
const QUERY_URL = "https://ep43qpdx9q-dsn.algolia.net/1/indexes/spprod_drugstore_pl_simple_products/query";
const SOFT_SEARCH = JSON.stringify({ params: "query=nivea+soft&hitsPerPage=3" });
const CREME_SEARCH = JSON.stringify({ params: "query=nivea+creme&hitsPerPage=3" });
const SOFT_ANSWER = JSON.stringify({ hits: [{ objectID: "10132" }] });
const CREME_ANSWER = JSON.stringify({ hits: [] });

/** A POST with the given body, as an adapter sends a search. */
const post = (body: BodyInit): RequestInit => ({ method: "POST", body });

describe("replay fetch: request bodies", () => {
  it("answers two requests to one URL each by its own body", async () => {
    const replay = createReplayFetch([
      { url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER },
      { url: QUERY_URL, requestBody: CREME_SEARCH, status: 200, body: CREME_ANSWER },
    ]);

    const creme = await replay(QUERY_URL, post(CREME_SEARCH));
    const soft = await replay(QUERY_URL, post(SOFT_SEARCH));

    expect(await creme.text()).toBe(CREME_ANSWER);
    expect(await soft.text()).toBe(SOFT_ANSWER);
  });

  it("answers a request without a body only from an entry that names none", async () => {
    const replay = createReplayFetch([
      { url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER },
      { url: QUERY_URL, status: 405 },
    ]);

    expect((await replay(QUERY_URL)).status).toBe(405);
    // A body of null is no body, as fetch reads it.
    expect((await replay(QUERY_URL, { body: null })).status).toBe(405);
  });

  it("never answers a request without a body from an entry that names one", async () => {
    const replay = createReplayFetch([{ url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER }]);

    await expect(replay(QUERY_URL)).rejects.toThrow(`replay-fetch: no recorded response for ${QUERY_URL}`);
  });

  it.each([
    { entry: "names no body", requestBody: undefined },
    { entry: "names another body", requestBody: CREME_SEARCH },
    { entry: "names a body one character longer", requestBody: `${SOFT_SEARCH} ` },
  ])("never answers a request with a body from an entry that $entry", async ({ requestBody }) => {
    const replay = createReplayFetch([{ url: QUERY_URL, requestBody, status: 200, body: SOFT_ANSWER }]);

    await expect(replay(QUERY_URL, post(SOFT_SEARCH))).rejects.toThrow(
      `replay-fetch: no recorded response for ${QUERY_URL} with body ${SOFT_SEARCH}`,
    );
  });

  it.each([
    { kind: "URLSearchParams", body: new URLSearchParams("query=nivea+soft") },
    { kind: "a Blob", body: new Blob([SOFT_SEARCH]) },
    { kind: "bytes", body: new TextEncoder().encode(SOFT_SEARCH) },
  ])("rejects a body that isn't text, such as $kind, though its URL is recorded", async ({ body }) => {
    const replay = createReplayFetch([
      { url: QUERY_URL, status: 200, body: CREME_ANSWER },
      { url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER },
    ]);

    await expect(replay(QUERY_URL, post(body))).rejects.toThrow(
      `replay-fetch: a request body must be text to match a recording, for ${QUERY_URL}`,
    );
  });

  it("rejects a Request that carries its own body, which is a stream rather than text", async () => {
    const replay = createReplayFetch([
      { url: QUERY_URL, status: 200, body: CREME_ANSWER },
      { url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER },
    ]);

    await expect(replay(new Request(QUERY_URL, post(SOFT_SEARCH)))).rejects.toThrow(
      `replay-fetch: a request body must be text to match a recording, for ${QUERY_URL}`,
    );
  });
});

describe("replay fetch: through the gate", () => {
  it("serves a POST by the body the gate passes on, as an adapter sends one", async () => {
    const fetchMock = vi.fn(
      createReplayFetch([
        { url: QUERY_URL, requestBody: SOFT_SEARCH, status: 200, body: SOFT_ANSWER },
        { url: QUERY_URL, requestBody: CREME_SEARCH, status: 200, body: CREME_ANSWER },
      ]),
    );
    const gate = createShopGate({
      reserve: () => Promise.resolve({ outcome: "allowed" }),
      reportBlock: () => Promise.resolve(),
      fetch: fetchMock,
      log: () => undefined,
    });

    const outcome = await gate.fetch("super-pharm", QUERY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: CREME_SEARCH,
    });

    if (outcome.kind !== "ok") {
      throw new Error(`expected ok, got ${outcome.kind}`);
    }
    expect(await outcome.response.text()).toBe(CREME_ANSWER);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([CREME_SEARCH]);
  });
});
