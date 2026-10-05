// The owner's invite and recovery links: makes a link the owner hands to a person, who opens it, presses "Ustaw hasło"
// and chooses their password, with no email sent and no secret key in the app. Run it on the owner's own machine, with
// the project's secret key in the shell's environment only, never in .env or .dev.vars, which the build copies into
// dist/server. `read -rs` takes the key without showing it or keeping it in the shell's history:
//
//   read -rs SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY
//   SUPABASE_URL=<project URL> APP_URL=<app origin> node scripts/owner-link.mjs <invite|recovery> <email>
//   unset SUPABASE_SECRET_KEY
//
// - invite: a new account, which gets its first password from the link. Auth refuses an email that already has an
//   account (email_exists): make a recovery link for it.
// - recovery: a new password for an account that has one. Auth refuses an email without an account (user_not_found):
//   make an invite link for it.
//
// It asks Auth's admin API for the link (generateLink), which sends no email, and prints only the app's link,
// `<APP_URL>/auth/confirm?token_hash=<token>&type=<invite|recovery>`, on stdout, so it can be piped on its own, with a
// reminder on stderr. That link's format is the confirm page's contract (src/pages/auth/confirm.astro, confirmFormSchema
// in src/lib/services/auth.ts): change them together. The link works once, for as long as the project's Email OTP
// Expiration (86400 s, so 24 hours), and a newer link of the same type for the same email replaces it. The script
// refuses every bad input before it creates a client or asks anything, prints neither the key nor Auth's error
// objects, and writes no file.

import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";

const USAGE =
  "Usage: read -rs SUPABASE_SECRET_KEY && export SUPABASE_SECRET_KEY, then SUPABASE_URL=<project URL> APP_URL=<app origin> node scripts/owner-link.mjs <invite|recovery> <email>";

// What a handed-over link is for, and the shape of Auth's hashed token, the hex SHA-224 of the email and the link's
// code, as the confirm page takes them (LINK_TYPES and confirmFormSchema in src/lib/services/auth.ts).
const LINK_TYPES = ["invite", "recovery"];
const TOKEN_HASH = /^[0-9a-f]{56}$/;
// An email, roughly: something, an @, a domain with a dot, no spaces. Auth checks it again.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// What to do instead when Auth refuses a link for one of these codes.
const HINTS = {
  email_exists: "this email already has an account: make a recovery link for it",
  user_not_found: "no account has this email: make an invite link for it",
};

/**
 * Prints why the script stops, with the usage, and exits before anything is asked.
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.error(`owner-link: ${reason}\n${USAGE}`);
  process.exit(1);
}

// The hosts that may be reached over plain http: this machine, where the local stack and the dev server run.
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Whether `value` is an https URL, or an http one on this machine (LOCAL_HOSTS). Any other http URL is refused, so a
 * typo such as http://<ref>.supabase.co can't send the secret key in clear, nor an APP_URL print a link that opens
 * over plain http.
 * @param {string} value
 * @returns {boolean}
 */
function isSecureUrl(value) {
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
function isSecretKey(key) {
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
function appOriginOf(value) {
  if (!isSecureUrl(value)) return null;
  const url = new URL(value);
  return url.href === `${url.origin}/` ? url.origin : null;
}

const args = process.argv.slice(2);
if (args.length !== 2) refuse("give the link's type and the person's email, and nothing else");
const [type, email] = args;
const { SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL } = process.env;
const missing = Object.entries({ SUPABASE_URL, SUPABASE_SECRET_KEY, APP_URL })
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length > 0) refuse(`set ${missing.join(", ")} in this command's environment`);
if (!LINK_TYPES.includes(type)) refuse(`the link's type is invite or recovery, not ${JSON.stringify(type)}`);
if (email.length > 254 || !EMAIL.test(email)) refuse(`${JSON.stringify(email)} isn't an email`);
if (!isSecureUrl(SUPABASE_URL)) {
  refuse("SUPABASE_URL isn't the project's https URL (http only for localhost or 127.0.0.1)");
}
if (!isSecretKey(SUPABASE_SECRET_KEY)) {
  refuse("SUPABASE_SECRET_KEY isn't a secret key: use an sb_secret_… key, never the publishable or anon one");
}
const appOrigin = appOriginOf(APP_URL);
if (appOrigin === null) {
  refuse(
    "APP_URL isn't the app's https origin with no path (http only for localhost or 127.0.0.1, such as http://localhost:4321)",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await supabase.auth.admin.generateLink({ type, email });
if (error) {
  // Only the code, or the status without one: Auth's error object can carry the request it answered.
  const code = error.code ?? (error.status ? `HTTP ${String(error.status)}` : "no answer");
  const hint = Object.hasOwn(HINTS, code) ? `: ${HINTS[code]}` : "";
  console.error(`owner-link: Auth refused the ${type} link (${code})${hint}`);
  process.exit(1);
}

const tokenHash = data.properties?.hashed_token;
const linkType = data.properties?.verification_type;
if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash) || !LINK_TYPES.includes(linkType)) {
  console.error(
    "owner-link: Auth's answer holds no token and type the confirm page takes (56 hex digits, invite or recovery), so there's no link to print",
  );
  process.exit(1);
}
console.log(`${appOrigin}/auth/confirm?${new URLSearchParams({ token_hash: tokenHash, type: linkType }).toString()}`);
console.error(
  "Single use, for 24 hours from now while the project's Email OTP Expiration is 86400 s; a newer link of the same type for this email replaces it.",
);
