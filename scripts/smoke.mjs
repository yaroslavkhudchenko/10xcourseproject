// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server bound to the local Supabase: `npm run smoke`, which reads
// SUPABASE_URL and SUPABASE_KEY from .env when it's there; BASE_URL defaults to http://localhost:4321.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const jar = new Map();

// The app lets no one register, so the smoke user comes from Auth's own sign-up, on the Supabase the server is bound
// to. That signs a user up, so smoke only ever runs against the local stack, like the database checks.
const { SUPABASE_URL, SUPABASE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("FAIL  SUPABASE_URL and SUPABASE_KEY must be set (.env)");
  process.exit(1);
}
const { hostname } = new URL(SUPABASE_URL);
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  console.log(`FAIL  refusing to run against ${hostname}: point SUPABASE_URL at the local Supabase`);
  process.exit(1);
}

// Local sign-up is on with email confirmation off (supabase/config.toml), so Auth answers a sign-up with a session.
// It gives null once the user exists, else the reason it doesn't, and only that is printed: the answer holds tokens.
async function signUpSmokeUser() {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return `no answer from ${SUPABASE_URL}`;
  }
  const answer = await response.json().catch(() => null);
  if (response.ok && answer?.access_token) return null;
  const reason =
    answer?.error_code ??
    answer?.msg ??
    answer?.message ??
    "no session returned (is email confirmation off in supabase/config.toml?)";
  return `${response.status} ${reason}`;
}

const signUpFailure = await signUpSmokeUser();
console.log(`${signUpFailure ? "FAIL" : "PASS"}  sign up the smoke user through Auth  -> ${signUpFailure ?? email}`);
if (signUpFailure) process.exit(1);

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
    referrerPolicy: response.headers.get("referrer-policy") ?? "",
  };
}

// A product id no one has: its page answers 404 before any lookup.
const missingProductId = "00000000-0000-4000-8000-000000000000";
const missingProduct = `/watchlist/${missingProductId}`;

// The sign-in page with the page a sign-in goes back to, as signInHref writes it (src/lib/services/watchlist-rows.ts).
const signInBackTo = (path) => `/auth/signin?next=${encodeURIComponent(path)}`;
// The sign-in form's post, from the app's own origin unless a step says otherwise. Each one that signs in replaces the
// session's cookies; none asks a shop, since smoke follows no redirect.
const signIn = (form, options) => request("/api/auth/signin", { method: "POST", form, ...options });

// The product page island's price refresh. Every post names the product no one has, with a shop item as the island
// names the one its page shows, so none reaches a shop.
const pricesRoute = "/api/watchlist/prices";
const priceRefresh = (options) => request(pricesRoute, { method: "POST", ...options });
const missingProductPrice = { itemId: missingProductId, shop: "rossmann", shopItemId: "900000000" };

// The list's "Odśwież ceny", a plain form post. The smoke user's list stays empty, so it has nothing to refresh.
const listRefresh = (options) => request("/api/watchlist/refresh", { method: "POST", form: {}, ...options });

// "Usuń z listy" on a product's page, a plain form post. It names the product no one has unless a step says otherwise.
const removal = (options) =>
  request("/api/watchlist/remove", { method: "POST", form: { itemId: missingProductId }, ...options });

// A handed-over link's "Ustaw hasło", a plain form post of the link's token and type. Smoke has no secret key, so it
// holds no real link: a malformed token, which never reaches Auth, or one in the right shape that no one was given,
// which Auth refuses after one /verify call.
const confirmLink = (form, options) => request("/api/auth/confirm", { method: "POST", form, ...options });
const unknownToken = "0".repeat(56);

// The set-password form's post. Its password differs from the smoke user's, so a route that let a password session set
// one would change it, and the smoke user's own password would stop signing in.
const setPassword = (options) =>
  request("/api/auth/set-password", { method: "POST", form: { password: "Smoke-New-Passw0rd!" }, ...options });

// No signed-in step searches (the one `q` is a visitor's, whom the middleware sends to sign-in before the page runs),
// opens a product that exists or refreshes its price, and the list refresh runs on an empty list, so the smoke test
// never calls a shop; no removal names a product anyone has, so no step deletes anything. One confirm step asks Auth's
// /verify about a token no one was given, and no step sets a password. A step's location is where the redirect starts,
// or, with `exact`, all of it, so a step can check a redirect carries no code.
const steps = [
  ["home sends a visitor to sign-in", () => request("/"), { status: 302, location: "/auth/signin", exact: true }],
  // The starter's demo page is gone, so it answers 404, not a redirect to sign-in.
  ["dashboard answers 404", () => request("/dashboard"), { status: 404 }],
  // No one registers through the app: the sign-up page and the page that said an email was sent are gone too.
  ["sign-up page answers 404", () => request("/auth/signup"), { status: 404 }],
  ["check-your-email page answers 404", () => request("/auth/confirm-email"), { status: 404 }],
  ["watchlist redirects anonymous user", () => request("/watchlist"), { status: 302, location: "/auth/signin" }],
  [
    // The way back keeps the list's filter and drops everything else, the search among it.
    "watchlist redirects anonymous user with its filter as the way back",
    () => request("/watchlist?f=check&q=x"),
    { status: 302, location: "/auth/signin?next=%2Fwatchlist%3Ff%3Dcheck", exact: true },
  ],
  [
    "product page redirects anonymous user with itself as the way back",
    () => request(missingProduct),
    { status: 302, location: signInBackTo(missingProduct), exact: true },
  ],
  [
    // An API route goes to the plain sign-in page, which the product's island reads as an ended session.
    "price refresh redirects anonymous user",
    () => priceRefresh({ json: missingProductPrice }),
    { status: 302, location: "/auth/signin", exact: true },
  ],
  [
    "list price refresh redirects anonymous user",
    () => listRefresh(),
    { status: 302, location: "/auth/signin", exact: true },
  ],
  ["removal redirects anonymous user", () => removal(), { status: 302, location: "/auth/signin", exact: true }],
  [
    // Only a session a handed-over link just opened may set a password, so a visitor goes to the plain sign-in page.
    "set-password page redirects anonymous user",
    () => request("/auth/set-password"),
    { status: 302, location: "/auth/signin", exact: true },
  ],
  [
    "set-password route redirects anonymous user",
    () => setPassword(),
    { status: 302, location: "/auth/signin", exact: true },
  ],
  [
    // The link's page only shows its button, so opening it uses nothing. Its address holds a token, so no cache keeps
    // it, and its requests name only the site as their referrer: strict-origin, since under no-referrer a browser
    // posts the page's own form with `Origin: null`, which Astro's checkOrigin refuses.
    "confirm page renders, isn't cacheable and keeps its address out of referrers",
    () => request("/auth/confirm"),
    { status: 200, cacheControl: "no-store", referrerPolicy: "strict-origin" },
  ],
  [
    // A token that isn't 56 lowercase hex digits never reaches Auth: the page's own code.
    "confirm rejects a malformed link without asking Auth",
    () => confirmLink({ token_hash: "not-a-token", type: "invite" }),
    { status: 302, location: "/auth/confirm?error=invalid", exact: true },
  ],
  [
    // One /verify call: Auth answers a link no one was given as one that expired, and the redirect carries no token.
    "confirm of a link no one was given says it expired",
    () => confirmLink({ token_hash: unknownToken, type: "invite" }),
    { status: 302, location: "/auth/confirm?error=expired", exact: true },
  ],
  [
    // Astro's checkOrigin is the confirm route's only defence against a form posted from another site.
    "confirm posted from another site is refused",
    () => confirmLink({ token_hash: unknownToken, type: "invite" }, { origin: "https://evil.example" }),
    { status: 403 },
  ],
  [
    // No one registers through the app: the smoke user came from Auth's own sign-up, before the steps.
    "sign-up route answers 404",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 404 },
  ],
  [
    // Astro's checkOrigin is the sign-in route's only defence against a form posted from another site.
    "signin posted from another site is refused",
    () => signIn({ email, password: "wrong" }, { origin: "https://evil.example" }),
    { status: 403 },
  ],
  [
    // The page's own code, never Auth's message.
    "signin rejects wrong password",
    () => signIn({ email, password: "wrong" }),
    { status: 302, location: "/auth/signin?error=invalid", exact: true },
  ],
  [
    "signin accepts correct password and goes back to the page it was sent from",
    () => signIn({ email, password, next: `${missingProduct}?f=check` }),
    { status: 302, location: `${missingProduct}?f=check`, exact: true },
  ],
  // A way back that isn't the list's or a product's page with at most its filter lands on the list: another site, or a
  // re-pin that would make the product's page ask a shop.
  ...["https://evil.example/watchlist", "//evil.example/watchlist", `${missingProduct}?repin=natura`].map((next) => [
    `signin with the way back ${next} goes to the list`,
    () => signIn({ email, password, next }),
    { status: 302, location: "/watchlist", exact: true },
  ]),
  ["home sends a signed-in user to the list", () => request("/"), { status: 302, location: "/watchlist", exact: true }],
  [
    "sign-in page sends a signed-in user on to the list",
    () => request("/auth/signin"),
    { status: 302, location: "/watchlist", exact: true },
  ],
  [
    // Signed in by password, not by a handed-over link: set-password never becomes a page that changes a password.
    "set-password page sends a password session to the list",
    () => request("/auth/set-password"),
    { status: 302, location: "/watchlist", exact: true },
  ],
  [
    "set-password route sends a password session to the list before changing anything",
    () => setPassword(),
    { status: 302, location: "/watchlist", exact: true },
  ],
  [
    // The proof that the route changed nothing: the smoke user's own password still signs in.
    "the smoke user's own password still signs in after set-password",
    () => signIn({ email, password }),
    { status: 302, location: "/watchlist", exact: true },
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
  [
    // Astro's checkOrigin is the removal route's only defence against a form posted from another site.
    "removal posted from another site is refused",
    () => removal({ origin: "https://evil.example" }),
    { status: 403 },
  ],
  [
    // An id that isn't a UUID only comes from a crafted post: the route removes nothing and adds no code.
    "removal with an id that isn't a UUID goes to the list with no code",
    () => removal({ form: { itemId: "not-a-uuid", f: "promo" } }),
    { status: 302, location: "/watchlist", exact: true },
  ],
  [
    "removal of a product no one has says it wasn't on the list, keeping the filter",
    () => removal({ form: { itemId: missingProductId, f: "check" } }),
    { status: 302, location: "/watchlist?f=check&removed=gone", exact: true },
  ],
  [
    // Lands on sign-in with "Wylogowano." (SIGNED_OUT_PARAM in src/lib/notices.ts).
    "signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/auth/signin?signed-out=1", exact: true },
  ],
  ["watchlist redirects after signout", () => request("/watchlist"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined ||
      (expected.exact ? actual.location === expected.location : actual.location.startsWith(expected.location))) &&
    (expected.cacheControl === undefined || actual.cacheControl.includes(expected.cacheControl)) &&
    (expected.referrerPolicy === undefined || actual.referrerPolicy === expected.referrerPolicy);
  const shown = actual.location || [actual.cacheControl, actual.referrerPolicy].filter(Boolean).join(" ");
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${shown}`);
  if (!ok) {
    failed++;
    const wanted = [expected.location, expected.cacheControl, expected.referrerPolicy].filter(Boolean).join(" ");
    console.log(`      expected ${expected.status} ${wanted}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
