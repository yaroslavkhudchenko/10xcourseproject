import { describe, expect, it } from "vitest";
import { withHeaders } from "@/lib/response-headers";

const noStore = () => new Headers({ "Cache-Control": "private, no-store" });

describe("withHeaders", () => {
  it("sets headers on an ordinary response in place", () => {
    const response = new Response("ok");

    const result = withHeaders(response, noStore());

    expect(result).toBe(response);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("copies a response whose headers are read-only, keeping its status and location", () => {
    // Response.redirect() hands back headers that can't be changed.
    const redirect = Response.redirect("https://drogeria.example/auth/signin", 302);

    const result = withHeaders(redirect, noStore());

    expect(result).not.toBe(redirect);
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://drogeria.example/auth/signin");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
