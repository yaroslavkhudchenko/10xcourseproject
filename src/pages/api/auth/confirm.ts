import type { APIRoute } from "astro";
import { confirmBackTo, confirmErrorCodeOf, parseConfirmForm } from "@/lib/services/auth";

// The button of a handed-over link's page, a plain form, so Astro's checkOrigin refuses one from another site. Only this
// post uses the link: Auth checks its token and, for a link it still takes, signs the person in on this device, and the
// set-password page follows. A token that isn't one never reaches Auth. A link that signs no one in goes back to the
// confirm page with a code the page turns into its own text, never Auth's message, and never with the token, which
// goes into no address the app sends and no log it writes (confirmBackTo). Workers Logs do keep the URL of an opened
// link, token included, an accepted risk the deploy plan names ("Accounts and links (S-07)"). The form posts what the
// link the owner's script prints holds, `<app>/auth/confirm?token_hash=<token>&type=<invite|recovery>`, whose format
// is the confirm page's contract (confirmFormSchema, scripts/owner-link.mjs). It asks no shop.
export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // The body isn't a form at all.
    return context.redirect(confirmBackTo("invalid"));
  }
  // The middleware's client, so the cache headers that come with the new session cookies reach this response.
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(confirmBackTo("config"));
  }
  const link = parseConfirmForm(form);
  if (link === null) {
    return context.redirect(confirmBackTo("invalid"));
  }

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.token_hash, type: link.type });
  if (error) {
    return context.redirect(confirmBackTo(confirmErrorCodeOf(error)));
  }
  // An answer without a session signed no one in, and the set-password page would only send the person to sign-in.
  return context.redirect(confirmBackTo(data.session ? "verified" : "failed"));
};
