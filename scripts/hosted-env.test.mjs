import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { appOriginOf, isSecretKey, isSecureUrl, LOCAL_HOSTS, readCheckEnv } from "./hosted-env.mjs";

// The rules every script that may reach a hosted project shares. A URL that let a key travel in clear, a secret key
// taken for a publishable one, or a refusal that printed what it refused would each put a key where a log or a
// terminal shows it. Every key here is made up: a JWT's payload is only read, never verified, so an unsigned one does.

/**
 * An unsigned three-part JWT whose payload carries `role`, as the legacy anon and service_role keys do.
 * @param {string} role
 * @returns {string}
 */
function jwtWithRole(role) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase-demo", role })}.not-a-signature`;
}

const ANON_KEY = jwtWithRole("anon");
const SERVICE_ROLE_KEY = jwtWithRole("service_role");

describe("isSecureUrl, where a key may travel", () => {
  it.each([
    "https://abcdefghijklmnop.supabase.co",
    "https://drogeria.example/",
    "http://localhost:4321",
    "http://127.0.0.1:54321",
  ])("takes %s", (value) => {
    expect(isSecureUrl(value)).toBe(true);
  });

  it.each([
    { why: "plain http to another host", value: "http://abcdefghijklmnop.supabase.co" },
    { why: "plain http to a host that only starts with localhost", value: "http://localhost.example.com" },
    { why: "plain http to another loopback address", value: "http://127.0.0.2:4321" },
    { why: "plain http to this machine's IPv6 address", value: "http://[::1]:4321" },
    { why: "another scheme", value: "ftp://localhost/" },
    { why: "text that isn't a URL", value: "abcdefghijklmnop.supabase.co" },
  ])("refuses $why", ({ value }) => {
    expect(isSecureUrl(value)).toBe(false);
  });

  it("allows plain http only to localhost and 127.0.0.1", () => {
    expect(LOCAL_HOSTS).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("isSecretKey, the keys that bypass RLS", () => {
  it.each([
    { why: "a new secret key", key: "sb_secret_made-up" },
    { why: "a legacy service_role JWT", key: SERVICE_ROLE_KEY },
  ])("knows $why for one", ({ key }) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each([
    { why: "a publishable key", key: "sb_publishable_made-up" },
    { why: "a legacy anon JWT", key: ANON_KEY },
    { why: "three parts whose payload isn't JSON", key: "header.not-json.signature" },
    { why: "two parts", key: "header.payload" },
    { why: "any other text", key: "made-up" },
  ])("doesn't take $why for one", ({ key }) => {
    expect(isSecretKey(key)).toBe(false);
  });
});

describe("appOriginOf, the app's origin", () => {
  it.each([
    { value: "https://drogeria.example", origin: "https://drogeria.example" },
    { value: "https://drogeria.example/", origin: "https://drogeria.example" },
    { value: "http://localhost:4321", origin: "http://localhost:4321" },
    { value: "http://127.0.0.1:4321/", origin: "http://127.0.0.1:4321" },
  ])("takes $value", ({ value, origin }) => {
    expect(appOriginOf(value)).toBe(origin);
  });

  it.each([
    { why: "an origin with a path", value: "https://drogeria.example/watchlist" },
    { why: "an origin with a query", value: "https://drogeria.example/?f=check" },
    { why: "an origin with a hash", value: "https://drogeria.example/#top" },
    { why: "an origin with credentials", value: "https://owner:made-up@drogeria.example" },
    { why: "plain http to another host", value: "http://drogeria.example" },
  ])("refuses $why", ({ value }) => {
    expect(appOriginOf(value)).toBeNull();
  });
});

// A deployment's settings as the build's variables, or a run by hand, hold them.
const ENV = {
  CHECK_APP_URL: "https://drogeria.example",
  CHECK_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  CHECK_SUPABASE_KEY: "sb_publishable_made-up",
};

describe("readCheckEnv, a check's settings", () => {
  it("reads every setting by default", () => {
    expect(readCheckEnv(ENV)).toEqual({
      appOrigin: "https://drogeria.example",
      supabaseUrl: "https://abcdefghijklmnop.supabase.co",
      key: "sb_publishable_made-up",
    });
  });

  it("reads only the app's origin when only the app is needed", () => {
    expect(readCheckEnv({ CHECK_APP_URL: "http://localhost:4321/" }, { app: true })).toEqual({
      appOrigin: "http://localhost:4321",
    });
  });

  it("reads only Supabase's settings when only Supabase is needed, the local stack's and its anon key included", () => {
    expect(
      readCheckEnv(
        {
          CHECK_APP_URL: "http://drogeria.example",
          CHECK_SUPABASE_URL: "http://127.0.0.1:54321",
          CHECK_SUPABASE_KEY: ANON_KEY,
        },
        { supabase: true },
      ),
    ).toEqual({ supabaseUrl: "http://127.0.0.1:54321", key: ANON_KEY });
  });

  it("reads each value without the whitespace around it, and the Supabase URL without a trailing slash", () => {
    expect(
      readCheckEnv({
        CHECK_APP_URL: " https://drogeria.example/ ",
        CHECK_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co/\n",
        CHECK_SUPABASE_KEY: "  sb_publishable_made-up\n",
      }),
    ).toEqual({
      appOrigin: "https://drogeria.example",
      supabaseUrl: "https://abcdefghijklmnop.supabase.co",
      key: "sb_publishable_made-up",
    });
  });

  it("names every needed variable that is missing or blank", () => {
    expect(readCheckEnv({ CHECK_SUPABASE_URL: "  " })).toEqual({
      refusal: expect.stringContaining("CHECK_APP_URL, CHECK_SUPABASE_URL, CHECK_SUPABASE_KEY"),
    });
  });

  it("asks only for the variables that are needed", () => {
    const result = readCheckEnv({}, { supabase: true });
    expect(result).toEqual({ refusal: expect.stringContaining("CHECK_SUPABASE_URL, CHECK_SUPABASE_KEY") });
    expect(result.refusal).not.toContain("CHECK_APP_URL");
  });

  it.each([
    { why: "an app URL over plain http to another host", variable: "CHECK_APP_URL", value: "http://drogeria.example" },
    { why: "an app URL with a path", variable: "CHECK_APP_URL", value: "https://drogeria.example/watchlist" },
    {
      why: "a Supabase URL over plain http to another host",
      variable: "CHECK_SUPABASE_URL",
      value: "http://abcdefghijklmnop.supabase.co",
    },
    { why: "a Supabase URL that isn't a URL", variable: "CHECK_SUPABASE_URL", value: "abcdefghijklmnop.supabase.co" },
    { why: "a new secret key", variable: "CHECK_SUPABASE_KEY", value: "sb_secret_made-up" },
    { why: "a legacy service_role key", variable: "CHECK_SUPABASE_KEY", value: SERVICE_ROLE_KEY },
    { why: "a secret key behind a stray space", variable: "CHECK_SUPABASE_KEY", value: " sb_secret_made-up" },
  ])("refuses $why, naming the variable and never its value", ({ variable, value }) => {
    const result = readCheckEnv({ ...ENV, [variable]: value });
    expect(result).toEqual({ refusal: expect.stringContaining(variable) });
    expect(result.refusal).not.toContain(value.trim());
  });

  it("refuses a secret key wherever it's set, even when only the app is needed", () => {
    const result = readCheckEnv(
      { CHECK_APP_URL: "https://drogeria.example", CHECK_SUPABASE_KEY: SERVICE_ROLE_KEY },
      {
        app: true,
      },
    );
    expect(result).toEqual({ refusal: expect.stringContaining("CHECK_SUPABASE_KEY") });
    expect(result.refusal).not.toContain(SERVICE_ROLE_KEY);
  });
});
