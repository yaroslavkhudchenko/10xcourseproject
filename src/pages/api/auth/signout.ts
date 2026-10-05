import type { APIRoute } from "astro";
import { signOutBackTo } from "@/lib/services/auth";

// "Wyloguj" in the header and the phone's account menu, a plain form, so Astro's checkOrigin refuses one from another
// site. It signs out this device only: the user's sessions on their other devices stay. It lands on the sign-in page
// with "Wylogowano." once the session is gone; when Auth answers an error, which can leave the session in place, it goes
// back to the list with its notice that the sign-out didn't go through (signOutBackTo). It asks no shop.
export const POST: APIRoute = async (context) => {
  // The middleware's client, so the cache headers that come with the cleared session cookies reach this response.
  const supabase = context.locals.supabase;
  if (!supabase) {
    return context.redirect(signOutBackTo("config"));
  }
  const { error } = await supabase.auth.signOut({ scope: "local" });
  return context.redirect(signOutBackTo(error ? "failed" : "done"));
};
