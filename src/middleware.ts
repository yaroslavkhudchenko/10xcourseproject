import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/watchlist", "/api/watchlist"];

export const onRequest = defineMiddleware(async (context, next) => {
  // The request's only Supabase client. Pages and routes use locals.supabase, so the cache headers @supabase/ssr sends
  // when it writes auth cookies are collected here and reach the response.
  const responseHeaders = new Headers();
  const supabase = createClient(context.request.headers, context.cookies, responseHeaders);
  context.locals.supabase = supabase;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  const response = await next();
  responseHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  // A signed-in response can carry the user's data, so no cache may keep it.
  if (context.locals.user) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
});
