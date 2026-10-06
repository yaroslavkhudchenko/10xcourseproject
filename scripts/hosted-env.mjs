// The rules every script that may reach a hosted project shares: which URLs may carry a key, which keys are secret,
// what an app's origin is, and the production checks' settings (readCheckEnv). scripts/owner-link.mjs and
// scripts/check-production.mjs import them from here, and scripts/hosted-env.test.mjs tests them. Zero dependencies and
// no side effects: importing it reads nothing and asks no one.

import { Buffer } from "node:buffer";

/** The hosts that may be reached over plain http: this machine, where the local stack and the dev server run. */
export const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Whether `value` is an https URL, or an http one on this machine (LOCAL_HOSTS). Any other http URL is refused, so a
 * typo such as http://<ref>.supabase.co can't send the secret key in clear, nor an APP_URL print a link that opens
 * over plain http.
 * @param {string} value
 * @returns {boolean}
 */
export function isSecureUrl(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === "https:" || (protocol === "http:" && LOCAL_HOSTS.includes(hostname));
  } catch {
    return false;
  }
}

/**
 * Whether `key` is a secret key, which the admin API needs: a new `sb_secret_…` key, or a legacy JWT whose role is
 * service_role. A publishable key (`sb_publishable_…`), an anon JWT and anything else aren't. The JWT is only read
 * here, not verified: Auth verifies it.
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

/**
 * The app's origin, from an APP_URL that is exactly an https origin, or an http one on this machine such as
 * http://localhost:4321 (isSecureUrl), with at most a trailing slash; null for one with a path, a query, a hash or
 * credentials.
 * @param {string} value
 * @returns {string | null}
 */
export function appOriginOf(value) {
  if (!isSecureUrl(value)) return null;
  const url = new URL(value);
  return url.href === `${url.origin}/` ? url.origin : null;
}

/** Why a check refuses CHECK_SUPABASE_KEY: it holds a secret key, never a check's to carry. */
const SECRET_KEY_REFUSAL =
  "CHECK_SUPABASE_KEY is a secret key: use the project's publishable key, never a secret or service_role one";

/**
 * The settings of a check that reads a deployment signed out, from `env` (process.env), with only what `needs` asks
 * for, every setting by default:
 * - `app`: the app's origin (`appOrigin`), from CHECK_APP_URL, which must be exactly an https origin, or an http one
 *   on this machine (appOriginOf), since a same-origin post must send it as its Origin.
 * - `supabase`: the project's URL without a trailing slash (`supabaseUrl`), from CHECK_SUPABASE_URL, which must be
 *   secure (isSecureUrl), and its publishable key (`key`), from CHECK_SUPABASE_KEY, which must not be a secret one
 *   (isSecretKey): a check reads only what anyone may, and a secret key, which bypasses RLS, never goes where a build
 *   log or a terminal could show it.
 * Each value is read without the whitespace around it, so a pasted key's stray space can't hide its prefix. Gives
 * `{ refusal }` instead when a needed variable is missing or blank, naming every one that is, or when one is refused,
 * naming that variable; a refusal never holds a value. A variable the caller doesn't need isn't required or checked,
 * except that a secret CHECK_SUPABASE_KEY is refused wherever it's set, so a misplaced one is always noticed.
 * @param {Record<string, string | undefined>} env
 * @param {{ app?: boolean, supabase?: boolean }} [needs]
 * @returns {{ appOrigin?: string, supabaseUrl?: string, key?: string } | { refusal: string }}
 */
export function readCheckEnv(env, { app = false, supabase = false } = { app: true, supabase: true }) {
  const anyKey = env.CHECK_SUPABASE_KEY?.trim() ?? "";
  if (anyKey !== "" && isSecretKey(anyKey)) return { refusal: SECRET_KEY_REFUSAL };
  const names = [...(app ? ["CHECK_APP_URL"] : []), ...(supabase ? ["CHECK_SUPABASE_URL", "CHECK_SUPABASE_KEY"] : [])];
  const values = Object.fromEntries(names.map((name) => [name, env[name]?.trim() ?? ""]));
  const missing = names.filter((name) => values[name] === "");
  if (missing.length > 0) return { refusal: `set ${missing.join(", ")} in this command's environment` };

  /** @type {{ appOrigin?: string, supabaseUrl?: string, key?: string }} */
  const settings = {};
  if (app) {
    const appOrigin = appOriginOf(values.CHECK_APP_URL);
    if (appOrigin === null) {
      return {
        refusal:
          "CHECK_APP_URL isn't the app's https origin with no path (http only for localhost or 127.0.0.1, such as http://localhost:4321)",
      };
    }
    settings.appOrigin = appOrigin;
  }
  if (supabase) {
    if (!isSecureUrl(values.CHECK_SUPABASE_URL)) {
      return { refusal: "CHECK_SUPABASE_URL isn't the project's https URL (http only for localhost or 127.0.0.1)" };
    }
    settings.supabaseUrl = values.CHECK_SUPABASE_URL.replace(/\/+$/, "");
    settings.key = values.CHECK_SUPABASE_KEY;
  }
  return settings;
}
