import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * The request's Supabase client, or null when the env is missing. Build one per request: `@supabase/ssr` passes its
 * cache headers to `setAll` once per client, and they are copied into `responseHeaders` for the response.
 */
export function createClient(requestHeaders: Headers, cookies: AstroCookies, responseHeaders?: Headers) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "");
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
        // Sent whenever auth cookies change: Cache-Control, Expires and Pragma that keep the response out of caches.
        Object.entries(headers).forEach(([key, value]) => {
          responseHeaders?.set(key, value);
        });
      },
    },
  });
}
