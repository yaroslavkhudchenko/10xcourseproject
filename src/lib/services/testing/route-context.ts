import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";

// Test helper: a route's context as Astro hands it over, and the app's own origin its requests come from, defined once
// for every route's tests.

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
