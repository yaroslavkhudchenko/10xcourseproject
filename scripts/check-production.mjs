// Production check: proves, signed out and read-only, that a deployment of the app answers, protects its pages and
// routes, has its Supabase configuration, signs in with a working key, and that its Auth refuses sign-up. It holds no
// cookie, so nothing it sends is signed in: no request reaches a shop, writes anything or names a product anyone has,
// and its one Auth call is a sign-in for an address no one has, which Auth refuses. Zero dependencies, like
// scripts/smoke.mjs, whose signed-out steps fix most of the answers expected here. Smoke signs a user up, so it only
// ever runs against the local stack; this check runs against any deployment, production included.
//
//   CHECK_APP_URL=<app origin> CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> \
//     node scripts/check-production.mjs [--only=<groups> | --skip=<groups>]
//
// It reads the three variables from its environment only: Workers Builds' build variables after a deploy, or values set
// on the command line for a run by hand. `npm run check:production` runs every group. The groups, in the order they
// run, which --only and --skip take as a comma-separated list:
// - pages: the front door, the protected pages and routes, another site's form post, the removed pages, the sign-in
//   page and its first font, a handed-over link's page, and sign-out. Needs CHECK_APP_URL.
// - sign-in: one sign-in for production-check@example.com, whose answer shows that the Worker's Supabase key works.
//   Needs CHECK_APP_URL.
// - settings: Auth's own settings, which must refuse sign-up and keep the email provider on. Needs CHECK_SUPABASE_URL
//   and CHECK_SUPABASE_KEY, the publishable key: a secret one is refused (readCheckEnv in scripts/hosted-env.mjs).
// CI runs pages and sign-in against the workerd preview, and settings against the local stack, where sign-up stays on
// for the tests, so that run must fail.
//
// Every request is sent without following a redirect, with 10 s for its answer and its body, and once more only when
// no answer came. Each step prints `PASS|FAIL  <step>  -> <what came back>`, never the key, a body or the Supabase URL;
// a step that throws prints its FAIL line too, and the run goes on. Any failure or refusal exits 1.

import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { readCheckEnv } from "./hosted-env.mjs";

const USAGE =
  "Usage: CHECK_APP_URL=<app origin> CHECK_SUPABASE_URL=<project URL> CHECK_SUPABASE_KEY=<publishable key> node scripts/check-production.mjs [--only=<groups> | --skip=<groups>], the groups being pages, sign-in and settings";

/** The check's groups, in the order it runs them. */
export const GROUPS = ["pages", "sign-in", "settings"];

// How long a request may take, its body included, and the pause before its one more try when no answer came. The
// migration gate (scripts/check-migrations-applied.mjs) gives its request the same time, which failureOf names.
export const TIMEOUT_MS = 10_000;
const RETRY_PAUSE_MS = 1_000;

// An error's name or code is shown only in this shape: an identifier, never a message, which can hold a URL or a key.
const IDENTIFIER = /^[A-Za-z]\w{0,63}$/;

/**
 * @typedef {object} Answer What a step reads of an answer, a missing header being empty.
 * @property {number} status
 * @property {string} location
 * @property {string} cacheControl
 * @property {string} referrerPolicy
 * @property {string | null} body The body as text when the step reads it, else null.
 */

/**
 * @typedef {object} Verdict A step's outcome and what it shows of the answer: never a body, a key or the Supabase URL.
 * @property {boolean} ok
 * @property {string} observed
 */

/**
 * @typedef {object} Page What a page step expects of a 200 answer.
 * @property {string[]} [holds] Text its body must hold.
 * @property {string[]} [lacks] Text its body must not hold.
 * @property {string} [cacheControl] Text its Cache-Control must hold.
 * @property {string} [referrerPolicy] Its Referrer-Policy, exactly.
 */

/**
 * @typedef {object} Run A run's settings (readCheckEnv), and what one step hands on: the sign-in page, for its font.
 * @property {string} [appOrigin]
 * @property {string} [supabaseUrl]
 * @property {string} [key]
 * @property {string | null} signInPage
 */

/**
 * @typedef {object} Step
 * @property {string} group
 * @property {string} name
 * @property {string} expected What its FAIL line says it expected.
 * @property {(run: Run) => Promise<Verdict>} check
 */

/**
 * The groups a run checks, from its arguments: every group without one, only those `--only=<groups>` names, or every
 * group but those `--skip=<groups>` names, each a comma-separated list, in the order the check runs them. Gives
 * `{ refusal }` instead for an argument it doesn't know, --only and --skip together or either twice, a list that names
 * no group or a name that isn't a group, and a run left with no group. A refusal repeats no argument.
 * @param {string[]} args
 * @returns {{ groups: string[] } | { refusal: string }}
 */
export function selectGroups(args) {
  /** @type {{ flag: string, names: string[] } | null} */
  let selection = null;
  for (const arg of args) {
    const match = /^--(only|skip)=(.*)$/.exec(arg);
    if (match === null) return { refusal: "give --only=<groups> or --skip=<groups>, or no argument" };
    if (selection !== null) return { refusal: "give --only or --skip once, not both and not twice" };
    const names = match[2]
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    selection = { flag: match[1], names };
  }
  if (selection === null) return { groups: [...GROUPS] };
  const { flag, names } = selection;
  if (names.length === 0) return { refusal: `--${flag} names no group: give pages, sign-in or settings` };
  if (names.some((name) => !GROUPS.includes(name))) {
    return { refusal: `--${flag} names a group that isn't pages, sign-in or settings` };
  }
  const groups =
    flag === "only"
      ? GROUPS.filter((group) => names.includes(group))
      : GROUPS.filter((group) => !names.includes(group));
  return groups.length > 0 ? { groups } : { refusal: "--skip leaves no group to check" };
}

/**
 * Which settings the groups need (readCheckEnv): the app's origin for pages and sign-in, the Supabase project's URL and
 * key for settings.
 * @param {string[]} groups
 * @returns {{ app: boolean, supabase: boolean }}
 */
export function needsOf(groups) {
  return { app: groups.includes("pages") || groups.includes("sign-in"), supabase: groups.includes("settings") };
}

/**
 * Whether an answer is a 302 to exactly `location`, so a redirect that carries a code, or that keeps more of the
 * address than it should, fails.
 * @param {Answer} answer
 * @param {string} location
 * @returns {Verdict}
 */
export function redirectVerdict(answer, location) {
  return { ok: answer.status === 302 && answer.location === location, observed: shownOf(answer) };
}

/**
 * Whether an answer has `status`.
 * @param {Answer} answer
 * @param {number} status
 * @returns {Verdict}
 */
export function statusVerdict(answer, status) {
  return { ok: answer.status === status, observed: shownOf(answer) };
}

/**
 * Whether an answer is the page `page` describes: a 200 whose headers and body are as it says. It shows the status,
 * each header it checks, and the text the body misses or shouldn't hold, never the body itself.
 * @param {Answer} answer
 * @param {Page} page
 * @returns {Verdict}
 */
export function pageVerdict(answer, page) {
  const body = answer.body ?? "";
  const missing = (page.holds ?? []).filter((text) => !body.includes(text));
  const unwanted = (page.lacks ?? []).filter((text) => body.includes(text));
  const shown = [shownOf(answer)];
  let headersOk = true;
  if (page.cacheControl !== undefined) {
    headersOk &&= answer.cacheControl.includes(page.cacheControl);
    shown.push(answer.cacheControl || "no Cache-Control");
  }
  if (page.referrerPolicy !== undefined) {
    headersOk &&= answer.referrerPolicy === page.referrerPolicy;
    shown.push(answer.referrerPolicy || "no Referrer-Policy");
  }
  return {
    ok: answer.status === 200 && headersOk && missing.length === 0 && unwanted.length === 0,
    observed: [
      shown.join(" "),
      ...(missing.length > 0 ? [`missing ${listOf(missing)}`] : []),
      ...(unwanted.length > 0 ? [`holding ${listOf(unwanted)}`] : []),
    ].join("; "),
  };
}

/**
 * Whether Auth's settings refuse sign-up (`disable_signup` true) and keep the email provider on (`external.email`
 * true), which password sign-in needs. It shows the status and, for a 200, those two values only, each true, false,
 * missing or unreadable, never the rest of the answer. A body that isn't a JSON object is unreadable: a failure, never
 * a pass and never values that are merely missing.
 * @param {Answer} answer
 * @returns {Verdict}
 */
export function settingsVerdict(answer) {
  if (answer.status !== 200) return { ok: false, observed: String(answer.status) };
  let settings;
  try {
    settings = JSON.parse(answer.body ?? "");
  } catch {
    return { ok: false, observed: "200 unreadable: not JSON" };
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return { ok: false, observed: "200 unreadable: not a JSON object" };
  }
  const disableSignup = settings.disable_signup;
  const external = settings.external;
  const email = typeof external === "object" && external !== null ? external.email : undefined;
  return {
    ok: disableSignup === true && email === true,
    observed: `200 disable_signup=${flagOf(disableSignup)} email=${flagOf(email)}`,
  };
}

/**
 * The path of the first web font a page names, `/_astro/fonts/<name>.woff2`, as the @font-face rules and preload links
 * Astro's Fonts API puts in its head do (src/layouts/Layout.astro), or null when it names none.
 * @param {string} html
 * @returns {string | null}
 */
export function fontPathOf(html) {
  return /\/_astro\/fonts\/[\w.-]+\.woff2/.exec(html)?.[0] ?? null;
}

/**
 * What a step that threw shows: the timeout, the code of the error that kept an answer from coming (ECONNREFUSED,
 * ENOTFOUND, a TLS error's), else the error's name. Never its message, which can hold the URL it was sent to, the
 * Supabase project's included, or a header's value.
 * @param {unknown} error
 * @returns {string}
 */
export function failureOf(error) {
  const name = error?.name;
  if (name === "TimeoutError") return `timed out after ${TIMEOUT_MS / 1000} s`;
  const code = error?.cause?.code ?? error?.code;
  if (typeof code === "string" && IDENTIFIER.test(code)) return `no answer (${code})`;
  return typeof name === "string" && IDENTIFIER.test(name) ? `threw ${name}` : "threw";
}

/**
 * An answer's status and, for a redirect, where it goes.
 * @param {Answer} answer
 * @returns {string}
 */
function shownOf(answer) {
  return answer.location === "" ? String(answer.status) : `${answer.status} ${answer.location}`;
}

/**
 * @param {string[]} texts
 * @returns {string}
 */
function listOf(texts) {
  return texts.map((text) => `'${text}'`).join(", ");
}

/**
 * A settings value as the check shows it: true or false, missing, or unreadable for anything else, which isn't shown.
 * @param {unknown} value
 * @returns {string}
 */
function flagOf(value) {
  if (typeof value === "boolean") return String(value);
  return value === undefined ? "missing" : "unreadable";
}

/**
 * What a page step expects, as its FAIL line says it.
 * @param {Page} page
 * @returns {string}
 */
function pageExpectation(page) {
  const headers = [page.cacheControl, page.referrerPolicy].filter((value) => value !== undefined);
  return [
    ["200", ...headers].join(" "),
    ...(page.holds?.length ? [`holding ${listOf(page.holds)}`] : []),
    ...(page.lacks?.length ? [`not holding ${listOf(page.lacks)}`] : []),
  ].join("; ");
}

/**
 * Sends one request, without following a redirect and with 10 s for the answer and its body. When no answer comes,
 * because fetch rejects on a network error or the timeout, it sends it once more after a pause; an HTTP answer,
 * whatever its status, is never sent again, so a deployment that answers 500 fails its step at once.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [init]
 */
async function send(url, init = {}) {
  const attempt = () => fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    return await attempt();
  } catch {
    await delay(RETRY_PAUSE_MS);
    return attempt();
  }
}

/**
 * Reads an answer: its status, the headers the steps check, and its body when `read`; an unread body is dropped.
 * @param {Awaited<ReturnType<typeof fetch>>} response
 * @param {boolean} read
 * @returns {Promise<Answer>}
 */
async function answerOf(response, read) {
  const body = read ? await response.text() : null;
  if (!read) await response.body?.cancel().catch(() => undefined);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    referrerPolicy: response.headers.get("referrer-policy") ?? "",
    body,
  };
}

/**
 * A visitor's GET of a path of the app.
 * @param {Run} run
 * @param {string} path
 * @param {{ read?: boolean }} [options]
 * @returns {Promise<Answer>}
 */
async function get(run, path, { read = false } = {}) {
  return answerOf(await send(`${run.appOrigin}${path}`), read);
}

/**
 * A visitor's POST to a path of the app, with a form, JSON or no body. It comes from the app's own origin unless a step
 * names another: Astro's checkOrigin refuses a form, or a post without a body, whose Origin isn't the Worker's own.
 * @param {Run} run
 * @param {string} path
 * @param {{ form?: Record<string, string>, json?: unknown, origin?: string }} [options]
 * @returns {Promise<Answer>}
 */
async function post(run, path, { form, json, origin = run.appOrigin } = {}) {
  const response = await send(`${run.appOrigin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: form ? new URLSearchParams(form).toString() : json === undefined ? undefined : JSON.stringify(json),
  });
  return answerOf(response, false);
}

/**
 * A step that expects a 302 to exactly `location`.
 * @param {string} group
 * @param {string} name
 * @param {(run: Run) => Promise<Answer>} request
 * @param {string} location
 * @returns {Step}
 */
function redirectStep(group, name, request, location) {
  return {
    group,
    name,
    expected: `302 ${location}`,
    check: async (run) => redirectVerdict(await request(run), location),
  };
}

/**
 * A step that expects `status`.
 * @param {string} group
 * @param {string} name
 * @param {(run: Run) => Promise<Answer>} request
 * @param {number} status
 * @returns {Step}
 */
function statusStep(group, name, request, status) {
  return { group, name, expected: String(status), check: async (run) => statusVerdict(await request(run), status) };
}

// A product id no one has, as smoke's. Every step is a visitor's, whom the middleware sends to sign-in before a page or
// a route runs; were one let through, a product no one has would still answer 404 before any lookup, so no step can
// reach a shop.
const MISSING_PRODUCT_ID = "00000000-0000-4000-8000-000000000000";

// The sign-in probe: an address no one has an account for, at a domain kept for examples, and a password the route's
// own check takes (1 to 72 characters, signInFormSchema in src/lib/services/auth.ts), so only Auth can refuse them.
// Neither is a secret.
const PROBE_FORM = { email: "production-check@example.com", password: "production-check-no-such-account" };

// The Polish sign-in form (src/components/auth/SignInView.astro, in src/layouts/Layout.astro's lang="pl"), with no
// banner for a missing Supabase configuration (src/lib/config-status.ts, the only place its words appear) and no way
// to a sign-up page.
/** @type {Page} */
const SIGN_IN_PAGE = {
  holds: ['lang="pl"', 'action="/api/auth/signin"', "E-mail", "Hasło", "Zaloguj się"],
  lacks: ["funkcje uwierzytelniania są wyłączone", "/auth/signup"],
};

// A handed-over link's page (src/pages/auth/confirm.astro): its address holds a token, so no cache may keep it, and the
// requests it makes name only the site as their referrer. Opening it asks no one; only its button would.
/** @type {Page} */
const LINK_PAGE = { holds: ["Ustaw hasło"], cacheControl: "no-store", referrerPolicy: "strict-origin" };

/** @type {Step[]} */
const STEPS = [
  redirectStep("pages", "home sends a visitor to sign-in", (run) => get(run, "/"), "/auth/signin"),
  // The way back keeps the list's filter and nothing else (returnPathFor in src/lib/services/return-path.ts).
  redirectStep(
    "pages",
    "the list sends a visitor to sign-in with itself and its filter as the way back",
    (run) => get(run, "/watchlist?f=check"),
    "/auth/signin?next=%2Fwatchlist%3Ff%3Dcheck",
  ),
  redirectStep(
    "pages",
    "a product's page sends a visitor to sign-in with itself as the way back",
    (run) => get(run, `/watchlist/${MISSING_PRODUCT_ID}`),
    `/auth/signin?next=%2Fwatchlist%2F${MISSING_PRODUCT_ID}`,
  ),
  // Only a session a handed-over link just opened may set a password, so a visitor goes to the plain sign-in page.
  redirectStep(
    "pages",
    "set-password page sends a visitor to sign-in",
    (run) => get(run, "/auth/set-password"),
    "/auth/signin",
  ),
  // An API route sends a visitor to the plain sign-in page before it runs. JSON passes Astro's checkOrigin whatever its
  // Origin, so this is the middleware's answer. The post names the product no one has, with a shop item as the
  // product's island names one.
  redirectStep(
    "pages",
    "price refresh sends a visitor to sign-in",
    (run) =>
      post(run, "/api/watchlist/prices", {
        json: { itemId: MISSING_PRODUCT_ID, shop: "rossmann", shopItemId: "900000000" },
      }),
    "/auth/signin",
  ),
  // Astro's checkOrigin refuses a form posted from another site, before the middleware.
  statusStep(
    "pages",
    "list price refresh posted from another site is refused",
    (run) => post(run, "/api/watchlist/refresh", { form: {}, origin: "https://evil.example" }),
    403,
  ),
  // The starter's demo page is gone, and no one registers through the app. The sign-up post carries no address and no
  // password, so even a sign-up route that came back could make no account.
  statusStep("pages", "dashboard answers 404", (run) => get(run, "/dashboard"), 404),
  statusStep("pages", "sign-up page answers 404", (run) => get(run, "/auth/signup"), 404),
  statusStep("pages", "sign-up route answers 404", (run) => post(run, "/api/auth/signup", { form: {} }), 404),
  {
    group: "pages",
    name: "sign-in page shows the Polish form, with no configuration banner and no sign-up link",
    expected: pageExpectation(SIGN_IN_PAGE),
    check: async (run) => {
      const answer = await get(run, "/auth/signin", { read: true });
      run.signInPage = answer.body;
      return pageVerdict(answer, SIGN_IN_PAGE);
    },
  },
  // The web fonts the build downloaded, served with the Worker's static assets (scripts/check-built-fonts.mjs counts
  // them in the build). Their names are hashes, so the step takes the first the sign-in page names.
  {
    group: "pages",
    name: "the sign-in page's first font is served",
    expected: "200 for the first /_astro/fonts/<name>.woff2 the sign-in page names",
    check: async (run) => {
      if (run.signInPage === null) return { ok: false, observed: "no sign-in page to take it from" };
      const path = fontPathOf(run.signInPage);
      if (path === null) return { ok: false, observed: "the sign-in page names no /_astro/fonts/<name>.woff2" };
      const verdict = statusVerdict(await get(run, path), 200);
      return { ...verdict, observed: `${verdict.observed} for ${path}` };
    },
  },
  // The token is 56 zeros, which Auth never issued, since the page's address lands in Workers Logs.
  {
    group: "pages",
    name: "a link's page offers its button, isn't cacheable and keeps its address out of referrers",
    expected: pageExpectation(LINK_PAGE),
    check: async (run) =>
      pageVerdict(await get(run, `/auth/confirm?token_hash=${"0".repeat(56)}&type=invite`, { read: true }), LINK_PAGE),
  },
  // A visitor has no session to end, so sign-out lands on sign-in with "Wylogowano." without asking Auth; without
  // Supabase it would land on the plain sign-in page. The post has no body, so its Origin gets it past checkOrigin.
  redirectStep(
    "pages",
    "sign-out lands a visitor on sign-in with its notice",
    (run) => post(run, "/api/auth/signout"),
    "/auth/signin?signed-out=1",
  ),
  // The one Auth call. The form passes the route's own check, so `invalid` can only be Auth's invalid_credentials,
  // which proves the Worker reached Auth with a key it takes: a broken key gives `?error=failed`, no Supabase
  // `?error=config`.
  redirectStep(
    "sign-in",
    "Auth refuses a sign-in for an address no one has, so the Worker's key works",
    (run) => post(run, "/api/auth/signin", { form: PROBE_FORM }),
    "/auth/signin?error=invalid",
  ),
  // Auth answers its settings to the publishable key in the apikey header, never as a bearer token. Production refuses
  // sign-up and keeps the email provider on, which password sign-in needs (CLAUDE.md); the local stack keeps sign-up on
  // for its tests, so this step fails there.
  {
    group: "settings",
    name: "Auth refuses sign-up and keeps the email provider on",
    expected: "200 disable_signup=true email=true",
    check: async (run) =>
      settingsVerdict(
        await answerOf(await send(`${run.supabaseUrl}/auth/v1/settings`, { headers: { apikey: run.key } }), true),
      ),
  },
];

/**
 * Runs the steps of `groups`, in order, against the deployment `settings` names (readCheckEnv), printing one line per
 * step and, for a failure, what it expected. A step that throws fails without ending the run. Gives how many failed.
 * @param {string[]} groups
 * @param {{ appOrigin?: string, supabaseUrl?: string, key?: string }} settings
 * @returns {Promise<number>}
 */
export async function runCheck(groups, settings) {
  /** @type {Run} */
  const run = { ...settings, signInPage: null };
  let failed = 0;
  for (const step of STEPS.filter(({ group }) => groups.includes(group))) {
    /** @type {Verdict} */
    let verdict;
    try {
      verdict = await step.check(run);
    } catch (error) {
      verdict = { ok: false, observed: failureOf(error) };
    }
    console.log(`${verdict.ok ? "PASS" : "FAIL"}  ${step.name}  -> ${verdict.observed}`);
    if (!verdict.ok) {
      failed++;
      console.log(`      expected ${step.expected}`);
    }
  }
  console.log(failed ? `\n${failed} production check step(s) failed` : "\nAll production check steps passed");
  return failed;
}

/**
 * Prints why the check stops, with the usage, and exits before any request.
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.error(`check-production: ${reason}\n${USAGE}`);
  process.exit(1);
}

// `node scripts/check-production.mjs [--only=<groups> | --skip=<groups>]`: every refusal comes before any request.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const selection = selectGroups(process.argv.slice(2));
  if ("refusal" in selection) refuse(selection.refusal);
  const settings = readCheckEnv(process.env, needsOf(selection.groups));
  if ("refusal" in settings) refuse(settings.refusal);
  const failed = await runCheck(selection.groups, settings);
  process.exit(failed ? 1 : 0);
}
