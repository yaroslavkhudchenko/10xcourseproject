import type { APIRoute } from "astro";
import { authErrorCodeOf, parseSignInForm, signInErrorHref } from "@/lib/services/auth";
import { DEFAULT_RETURN_PATH, returnPathOf } from "@/lib/services/return-path";
import { NEXT_PARAM } from "@/lib/services/watchlist-rows";

// The sign-in form's post, a plain form, so Astro's checkOrigin refuses one from another site. A signed-in user goes on
// to the page the form names, which returnPathOf keeps to the list or one of its products with at most the list's
// filter, so the page they land on asks a shop only what opening it themselves would. A refused sign-in goes back to
// the sign-in page with a code the page turns into its own text, never Auth's message, and with that same page for the
// next try (signInErrorHref). It asks no shop.
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(signInErrorHref("invalid", DEFAULT_RETURN_PATH));
  }
  // Read on its own, so a refused sign-in keeps it.
  const next = returnPathOf(form.get(NEXT_PARAM));
  // The middleware's client, so the cache headers that come with the new session cookies reach this response.
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(signInErrorHref("config", next));
  }
  const fields = parseSignInForm(form);
  if (fields === null) {
    return context.redirect(signInErrorHref("invalid", next));
  }

  const { error } = await supabase.auth.signInWithPassword({ email: fields.email, password: fields.password });
  if (error) {
    return context.redirect(signInErrorHref(authErrorCodeOf(error), next));
  }
  return context.redirect(next);
};
