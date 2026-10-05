import type { APIRoute } from "astro";
import { parsePasswordForm, passwordErrorCodeOf, setPasswordBackTo, setPasswordRedirectOf } from "@/lib/services/auth";

// The set-password form's post, a plain form, so Astro's checkOrigin refuses one from another site; the middleware sends
// a visitor to sign-in. Only a session a handed-over link opened within the last 60 minutes may set the account's
// password: any other, a password sign-in's included, goes to the list before its form is read or Auth is asked to
// change anything (setPasswordRedirectOf), so this never becomes a way to change a signed-in user's password. A saved
// password lands on the list with "Hasło zapisane."; a refused one goes back to the form with a code the page turns
// into its own text, never Auth's message and never the password (setPasswordBackTo). It asks no shop.
export const POST: APIRoute = async (context) => {
  // The middleware's client, so the cache headers that come with the updated session cookies reach this response.
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(setPasswordBackTo("config"));
  }
  const redirect = await setPasswordRedirectOf(supabase, Date.now());
  if (redirect !== null) {
    return context.redirect(redirect);
  }
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(setPasswordBackTo("invalid"));
  }
  const password = parsePasswordForm(form);
  if (password === null) {
    return context.redirect(setPasswordBackTo("invalid"));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return context.redirect(setPasswordBackTo(passwordErrorCodeOf(error)));
  }
  return context.redirect(setPasswordBackTo("saved"));
};
