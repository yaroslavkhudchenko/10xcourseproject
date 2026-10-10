import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";

// Test helper: a route's context as Astro hands it over, the app's own origin its requests come from, and a form posted
// from its pages, defined once for every route's tests.

/** The app's own origin, which a route's form posts and JSON requests come from unless a test says otherwise. */
export const APP = "https://drogeria.example";

/** A route's context, as Astro hands it over: the request, its URL, the request's Supabase client and `redirect`. */
export function contextOf(request: Request, supabase: SupabaseClient | null): APIContext {
  return {
    request,
    url: new URL(request.url),
    locals: { supabase, user: null },
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext;
}

/** A form's fields, each posted once or, like a candidate's `eans`, once per value. */
export type FormFields = Record<string, string | string[]>;

/** A form posted from the app's own page to one of its routes, such as `/api/watchlist/matches`. */
export function formPost(path: string, fields: FormFields): Request {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      body.append(name, each);
    }
  }
  return new Request(`${APP}${path}`, {
    method: "POST",
    headers: { Origin: APP, "Sec-Fetch-Site": "same-origin" },
    body,
  });
}
