import { describe, expect, it } from "vitest";
import {
  failureOf,
  fontPathOf,
  GROUPS,
  needsOf,
  pageVerdict,
  redirectVerdict,
  selectGroups,
  settingsVerdict,
  statusVerdict,
} from "./check-production.mjs";

// The production check's rules, none of which sends a request: which groups a run checks and what they need, how a
// step judges an answer, and what it shows of it. What it shows lands in CI's public logs and in Workers Builds' logs,
// so no verdict holds a body, a key or the Supabase URL, and an answer the check can't read fails.

/**
 * An answer as the check reads it (Answer in check-production.mjs): a 200 without headers or a body, unless a test
 * says otherwise.
 * @param {object} [overrides]
 */
function answer(overrides = {}) {
  return { status: 200, location: "", cacheControl: "", referrerPolicy: "", body: null, ...overrides };
}

describe("selectGroups, the groups a run checks", () => {
  it("checks every group, in order, without an argument", () => {
    expect(selectGroups([])).toEqual({ groups: ["pages", "sign-in", "settings"] });
    expect(GROUPS).toEqual(["pages", "sign-in", "settings"]);
  });

  it.each([
    { args: ["--only=settings"], groups: ["settings"] },
    { args: ["--only=settings,pages"], groups: ["pages", "settings"] },
    { args: ["--only=sign-in, pages,"], groups: ["pages", "sign-in"] },
    { args: ["--skip=settings"], groups: ["pages", "sign-in"] },
    { args: ["--skip=pages,sign-in"], groups: ["settings"] },
  ])("takes $args", ({ args, groups }) => {
    expect(selectGroups(args)).toEqual({ groups });
  });

  it.each([
    { why: "a group that doesn't exist", args: ["--only=setings"] },
    { why: "a list with a group that doesn't exist", args: ["--skip=pages,shops"] },
    { why: "a list that names no group", args: ["--only=,"] },
    { why: "--only and --skip together", args: ["--only=pages", "--skip=settings"] },
    { why: "--only twice", args: ["--only=pages", "--only=settings"] },
    { why: "skipping every group", args: ["--skip=pages,sign-in,settings"] },
    { why: "an argument it doesn't know", args: ["--all"] },
    { why: "a bare argument, such as a pasted key", args: ["sb_publishable_made-up"] },
  ])("refuses $why, repeating no argument", ({ args }) => {
    const result = selectGroups(args);
    expect(result).toEqual({ refusal: expect.any(String) });
    for (const arg of args) {
      expect(result.refusal).not.toContain(arg);
    }
  });
});

describe("needsOf, the settings a run needs", () => {
  it.each([
    { groups: ["pages"], needs: { app: true, supabase: false } },
    { groups: ["sign-in"], needs: { app: true, supabase: false } },
    { groups: ["settings"], needs: { app: false, supabase: true } },
    { groups: ["pages", "sign-in", "settings"], needs: { app: true, supabase: true } },
  ])("needs $needs for $groups", ({ groups, needs }) => {
    expect(needsOf(groups)).toEqual(needs);
  });
});

describe("redirectVerdict and statusVerdict, a step's status and redirect", () => {
  it("passes a 302 to exactly the expected place", () => {
    expect(redirectVerdict(answer({ status: 302, location: "/auth/signin" }), "/auth/signin")).toEqual({
      ok: true,
      observed: "302 /auth/signin",
    });
  });

  it.each([
    { why: "a redirect that carries more", status: 302, location: "/auth/signin?next=%2Fwatchlist" },
    { why: "a redirect elsewhere", status: 302, location: "/watchlist" },
    { why: "another kind of redirect", status: 307, location: "/auth/signin" },
  ])("fails $why, showing it", ({ status, location }) => {
    expect(redirectVerdict(answer({ status, location }), "/auth/signin")).toEqual({
      ok: false,
      observed: `${String(status)} ${location}`,
    });
  });

  it("fails a page where a redirect was expected", () => {
    expect(redirectVerdict(answer(), "/auth/signin")).toEqual({ ok: false, observed: "200" });
  });

  it("passes only the expected status, showing where a redirect went", () => {
    expect(statusVerdict(answer({ status: 404 }), 404)).toEqual({ ok: true, observed: "404" });
    expect(statusVerdict(answer({ status: 302, location: "/auth/signin" }), 404)).toEqual({
      ok: false,
      observed: "302 /auth/signin",
    });
  });
});

describe("pageVerdict, a page's status, headers and text", () => {
  const signIn = {
    holds: ['lang="pl"', "Zaloguj się"],
    lacks: ["funkcje uwierzytelniania są wyłączone", "/auth/signup"],
  };
  const signInHtml = '<html lang="pl"><body><form><button>Zaloguj się</button></form></body></html>';
  const banner = "<strong>Uwaga:</strong> Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.";

  it("passes a page that holds what it must and nothing it mustn't", () => {
    expect(pageVerdict(answer({ body: signInHtml }), signIn)).toEqual({ ok: true, observed: "200" });
  });

  it("fails a page with the configuration banner, naming its words and showing nothing else of the page", () => {
    expect(pageVerdict(answer({ body: signInHtml.replace("<body>", `<body>${banner}`) }), signIn)).toEqual({
      ok: false,
      observed: "200; holding 'funkcje uwierzytelniania są wyłączone'",
    });
  });

  it("fails a page that misses its text, naming what it misses", () => {
    expect(pageVerdict(answer({ body: '<html lang="en"><a href="/auth/signup">x</a></html>' }), signIn)).toEqual({
      ok: false,
      observed: `200; missing 'lang="pl"', 'Zaloguj się'; holding '/auth/signup'`,
    });
  });

  it("fails an answer that isn't a 200, even with the page's text", () => {
    expect(pageVerdict(answer({ status: 500, body: signInHtml }), signIn)).toEqual({ ok: false, observed: "500" });
  });

  it("checks the headers it names, and shows them", () => {
    const link = { holds: ["Ustaw hasło"], cacheControl: "no-store", referrerPolicy: "strict-origin" };
    const body = "<button>Ustaw hasło</button>";
    expect(pageVerdict(answer({ cacheControl: "no-store", referrerPolicy: "strict-origin", body }), link)).toEqual({
      ok: true,
      observed: "200 no-store strict-origin",
    });
    expect(pageVerdict(answer({ cacheControl: "public", referrerPolicy: "no-referrer", body }), link)).toEqual({
      ok: false,
      observed: "200 public no-referrer",
    });
    expect(pageVerdict(answer({ body }), link)).toEqual({
      ok: false,
      observed: "200 no Cache-Control no Referrer-Policy",
    });
  });
});

describe("settingsVerdict, Auth's sign-up refusal", () => {
  // Auth's settings, trimmed, with a value the check must never show.
  const settings = (overrides = {}) =>
    JSON.stringify({
      external: { email: true, phone: false },
      disable_signup: true,
      mailer_autoconfirm: false,
      site_url: "https://private.example",
      ...overrides,
    });

  it("passes sign-up refused with the email provider on, showing those two values only", () => {
    expect(settingsVerdict(answer({ body: settings() }))).toEqual({
      ok: true,
      observed: "200 disable_signup=true email=true",
    });
  });

  it.each([
    { why: "open sign-up, as the local stack has it", overrides: { disable_signup: false }, shown: "false email=true" },
    { why: "the email provider off", overrides: { external: { email: false } }, shown: "true email=false" },
    { why: "no sign-up setting", overrides: { disable_signup: undefined }, shown: "missing email=true" },
    {
      why: "a sign-up setting that isn't true or false",
      overrides: { disable_signup: "true" },
      shown: "unreadable email=true",
    },
    { why: "no email provider", overrides: { external: null }, shown: "true email=missing" },
  ])("fails $why", ({ overrides, shown }) => {
    expect(settingsVerdict(answer({ body: settings(overrides) }))).toEqual({
      ok: false,
      observed: `200 disable_signup=${shown}`,
    });
  });

  it.each([
    { why: "HTML", body: "<html>https://private.example</html>", shown: "200 unreadable: not JSON" },
    { why: "empty", body: "", shown: "200 unreadable: not JSON" },
    { why: "JSON null", body: "null", shown: "200 unreadable: not a JSON object" },
    { why: "a JSON list", body: "[true]", shown: "200 unreadable: not a JSON object" },
  ])("fails an answer that is $why as unreadable, never as values that are missing", ({ body, shown }) => {
    expect(settingsVerdict(answer({ body }))).toEqual({ ok: false, observed: shown });
  });

  it("fails an answer that isn't a 200, showing only its status", () => {
    expect(settingsVerdict(answer({ status: 401, body: '{"message":"Invalid API key"}' }))).toEqual({
      ok: false,
      observed: "401",
    });
  });
});

describe("fontPathOf, the first web font a page names", () => {
  it("takes the first, from an @font-face rule or a preload link", () => {
    const head =
      '<style>@font-face{src:url("/_astro/fonts/29eb36ed7b476a63.woff2") format("woff2")}</style>' +
      '<link rel="preload" href="/_astro/fonts/64ce27dafebe0e3a.woff2" as="font" type="font/woff2" crossorigin>';
    expect(fontPathOf(head)).toBe("/_astro/fonts/29eb36ed7b476a63.woff2");
  });

  it("finds none in a page that names no .woff2 font", () => {
    expect(fontPathOf('<link rel="preload" href="/_astro/fonts/29eb36ed7b476a63.woff">')).toBeNull();
    expect(fontPathOf("<html></html>")).toBeNull();
  });
});

describe("failureOf, what a step that threw shows", () => {
  it("names the timeout", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(failureOf(timeout)).toBe("timed out after 10 s");
  });

  it("names a network error by its code, never by its message, which holds the address", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54321"), { code: "ECONNREFUSED" });
    expect(failureOf(new TypeError("fetch failed", { cause }))).toBe("no answer (ECONNREFUSED)");
  });

  it("shows only the name of an error whose message holds a URL or a key", () => {
    expect(failureOf(new TypeError("Failed to parse URL from https://abcdefghijklmnop.supabase.co/auth/v1"))).toBe(
      "threw TypeError",
    );
    expect(failureOf(new TypeError('"sb_publishable_made-up\n" is an invalid header value.'))).toBe("threw TypeError");
  });

  it("shows no code or name that isn't an identifier", () => {
    expect(failureOf(Object.assign(new Error("x"), { code: "https://abcdefghijklmnop.supabase.co" }))).toBe(
      "threw Error",
    );
    expect(failureOf("https://abcdefghijklmnop.supabase.co")).toBe("threw");
  });
});
