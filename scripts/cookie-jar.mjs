// One browser's cookies, for the scripts that sign in through the app's own form (scripts/smoke.mjs and
// scripts/check-two-users.mjs): it sends back what the app set, and forgets a cookie the app expires. Dependency-free,
// like the scripts that use it.

/**
 * A cookie jar: `header()` gives the Cookie header to send, and `store(response)` keeps every cookie a response set,
 * deleting one it expired with `Max-Age=0`.
 */
export function cookieJar() {
  const cookies = new Map();
  return {
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    /** @param {Response} response */
    store(response) {
      for (const raw of response.headers.getSetCookie()) {
        const [pair, ...attributes] = raw.split(";");
        const [name, ...value] = pair.split("=");
        if (attributes.some((attribute) => /max-age=0/i.test(attribute.trim()))) cookies.delete(name.trim());
        else cookies.set(name.trim(), value.join("="));
      }
    },
  };
}
