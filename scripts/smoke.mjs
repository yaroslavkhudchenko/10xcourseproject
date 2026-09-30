// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

// Every request comes from the app's own origin unless a step says otherwise. A body is a form or JSON.
async function request(path, { method = "GET", form, json, origin = BASE_URL } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: origin,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
  });
  storeCookies(response);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
  };
}

// A product id no one has: its page answers 404 before any lookup.
const missingProductId = "00000000-0000-4000-8000-000000000000";
const missingProduct = `/watchlist/${missingProductId}`;

// The product page island's price refresh. Every post names the product no one has, so none reaches a shop.
const pricesRoute = "/api/watchlist/prices";
const priceRefresh = (options) => request(pricesRoute, { method: "POST", ...options });
const missingProductPrice = { itemId: missingProductId, shop: "rossmann" };

// The list's "Odśwież ceny", a plain form post. The smoke user's list stays empty, so it has nothing to refresh.
const listRefresh = (options) => request("/api/watchlist/refresh", { method: "POST", form: {}, ...options });

// No step searches (no `q`), opens a product that exists or refreshes its price, and the list refresh runs on an empty
// list, so the smoke test never calls a shop. A step's location is where the redirect starts, or, with `exact`, all of
// it, so a step can check a redirect carries no code.
const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["watchlist redirects anonymous user", () => request("/watchlist"), { status: 302, location: "/auth/signin" }],
  ["product page redirects anonymous user", () => request(missingProduct), { status: 302, location: "/auth/signin" }],
  [
    "price refresh redirects anonymous user",
    () => priceRefresh({ json: missingProductPrice }),
    { status: 302, location: "/auth/signin" },
  ],
  ["list price refresh redirects anonymous user", () => listRefresh(), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/watchlist" },
  ],
  [
    "watchlist renders for signed-in user and isn't cacheable",
    () => request("/watchlist"),
    { status: 200, cacheControl: "no-store" },
  ],
  [
    // Astro's checkOrigin is the decision route's only defence against a form posted from another site.
    "decision form posted from another site is refused",
    () =>
      request("/api/watchlist/matches", {
        method: "POST",
        form: { itemId: missingProductId, shop: "natura", action: "decline" },
        origin: "https://evil.example",
      }),
    { status: 403 },
  ],
  ["product page answers 404 for a product that doesn't exist", () => request(missingProduct), { status: 404 }],
  ["product page answers 404 for an id that isn't a UUID", () => request("/watchlist/not-a-uuid"), { status: 404 }],
  [
    // Posted from the app's own origin, so Astro's checkOrigin lets the form through and the route refuses its type.
    "price refresh refuses a form body",
    () => priceRefresh({ form: missingProductPrice }),
    { status: 415 },
  ],
  [
    "price refresh refuses a body that isn't a product and a shop",
    () => priceRefresh({ json: { itemId: "not-a-uuid", shop: "dm" } }),
    { status: 400 },
  ],
  [
    "price refresh answers 404 for a product that doesn't exist, and isn't cacheable",
    () => priceRefresh({ json: missingProductPrice }),
    { status: 404, cacheControl: "no-store" },
  ],
  [
    // Astro's checkOrigin lets JSON through whatever its origin, so the route refuses other sites itself.
    "price refresh posted from another site is refused",
    () => priceRefresh({ json: missingProductPrice, origin: "https://example.org" }),
    { status: 403 },
  ],
  [
    "list price refresh of an empty list refreshes nothing",
    () => listRefresh(),
    { status: 302, location: "/watchlist?list-prices=none" },
  ],
  [
    // A `back` that isn't a product's id only comes from a crafted post: the route refreshes nothing and adds no code.
    "list price refresh with a crafted way back goes to the list with no code",
    () => listRefresh({ form: { back: "not-a-uuid", f: "promo" } }),
    { status: 302, location: "/watchlist", exact: true },
  ],
  [
    // A product's id is a way back even when no one has that product; the empty list still refreshes nothing.
    "list price refresh from a product's page goes back to it",
    () => listRefresh({ form: { back: missingProductId } }),
    { status: 302, location: `${missingProduct}?list-prices=none`, exact: true },
  ],
  [
    // Astro's checkOrigin is the refresh route's only defence against a form posted from another site.
    "list price refresh posted from another site is refused",
    () => listRefresh({ origin: "https://evil.example" }),
    { status: 403 },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined ||
      (expected.exact ? actual.location === expected.location : actual.location.startsWith(expected.location))) &&
    (expected.cacheControl === undefined || actual.cacheControl.includes(expected.cacheControl));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location || actual.cacheControl}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""} ${expected.cacheControl ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
