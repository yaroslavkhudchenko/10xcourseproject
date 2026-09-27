import type { APIRoute } from "astro";

export const POST: APIRoute = async (context) => {
  // The middleware's client, so the cache headers that come with the cleared session cookies reach this response.
  const supabase = context.locals.supabase;
  if (supabase) {
    await supabase.auth.signOut();
  }
  return context.redirect("/");
};
