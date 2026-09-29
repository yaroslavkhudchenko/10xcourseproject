import { describe, expect, it } from "vitest";
import { isJsonMediaType, refuseJsonRequest } from "@/lib/json-request";

const OWN_ORIGIN = "https://drogeria.example";

/** The headers of a JSON post from the app's own page, as a browser sends them, changed by `changes`. */
function headers(changes: Record<string, string | null> = {}): Headers {
  const all: Record<string, string | null> = {
    "Content-Type": "application/json",
    Origin: OWN_ORIGIN,
    "Sec-Fetch-Site": "same-origin",
    ...changes,
  };
  const result = new Headers();
  for (const [name, value] of Object.entries(all)) {
    if (value !== null) {
      result.set(name, value);
    }
  }
  return result;
}

describe("refuseJsonRequest", () => {
  it.each<{ request: string; changes: Record<string, string | null> }>([
    { request: "a JSON post from the app's own page", changes: {} },
    { request: "one with a charset", changes: { "Content-Type": "application/json; charset=UTF-8" } },
    { request: "one in capitals", changes: { "Content-Type": "Application/JSON" } },
    { request: "one without Origin or Sec-Fetch-Site", changes: { Origin: null, "Sec-Fetch-Site": null } },
  ])("lets $request through", ({ changes }) => {
    expect(refuseJsonRequest(headers(changes), OWN_ORIGIN)).toBeNull();
  });

  it.each<{ request: string; changes: Record<string, string | null> }>([
    { request: "another site's", changes: { Origin: "https://example.org", "Sec-Fetch-Site": "cross-site" } },
    { request: "one the browser calls cross-site", changes: { Origin: null, "Sec-Fetch-Site": "cross-site" } },
    {
      request: "one from another origin",
      changes: { Origin: "https://evil.drogeria.example", "Sec-Fetch-Site": null },
    },
    { request: "one from an opaque origin", changes: { Origin: "null" } },
    // A form from another site is refused as another site's before its type counts.
    {
      request: "another site's form",
      changes: { Origin: "https://example.org", "Content-Type": "application/x-www-form-urlencoded" },
    },
  ])("refuses $request with 403", ({ changes }) => {
    expect(refuseJsonRequest(headers(changes), OWN_ORIGIN)).toBe(403);
  });

  it.each<{ request: string; changes: Record<string, string | null> }>([
    { request: "a form", changes: { "Content-Type": "application/x-www-form-urlencoded" } },
    { request: "plain text", changes: { "Content-Type": "text/plain" } },
    { request: "a lookalike type", changes: { "Content-Type": "application/json-patch+json" } },
    { request: "no type at all", changes: { "Content-Type": null } },
  ])("refuses $request from the app's own page with 415", ({ changes }) => {
    expect(refuseJsonRequest(headers(changes), OWN_ORIGIN)).toBe(415);
  });
});

describe("isJsonMediaType", () => {
  it("reads the media type without its parameters", () => {
    expect(isJsonMediaType("application/json;charset=utf-8")).toBe(true);
    expect(isJsonMediaType(" application/json ")).toBe(true);
    expect(isJsonMediaType("text/html; charset=utf-8")).toBe(false);
    expect(isJsonMediaType(null)).toBe(false);
  });
});
