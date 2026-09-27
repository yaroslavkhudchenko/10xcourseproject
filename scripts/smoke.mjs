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

// Every request comes from the app's own origin unless a step says otherwise.
async function request(path, { method = "GET", form, origin = BASE_URL } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: origin,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
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

// No step searches (no `q`) or opens a product that exists, so the smoke test never calls a shop.
const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["watchlist redirects anonymous user", () => request("/watchlist"), { status: 302, location: "/auth/signin" }],
  ["product page redirects anonymous user", () => request(missingProduct), { status: 302, location: "/auth/signin" }],
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
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location)) &&
    (expected.cacheControl === undefined || actual.cacheControl.includes(expected.cacheControl));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location || actual.cacheControl}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""} ${expected.cacheControl ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
