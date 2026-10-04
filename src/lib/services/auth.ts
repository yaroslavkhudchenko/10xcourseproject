import type { AuthError } from "@supabase/supabase-js";
import { z } from "astro/zod";
import { ERROR_PARAM, SIGN_OUT_PARAM, SIGNED_OUT_PARAM, type SignInErrorCode, type SignOutCode } from "@/lib/notices";
import { DEFAULT_RETURN_PATH } from "@/lib/services/return-path";
import { filterHref, NEXT_PARAM, SIGN_IN_PATH } from "@/lib/services/watchlist-rows";

// The sign-in rules, for the sign-in route and the sign-out route: the form's checks, Auth's answers as the app's own
// codes, which the sign-in page turns into its own text (notices.ts), so neither Auth's English message nor a crafted
// link's words reach it, and where each post goes back to.

// Auth sets no password longer than 72 bytes, bcrypt's limit, so a longer one can't be anyone's: the form refuses one of
// more than 72 characters before asking Auth.
const PASSWORD_MAX_LENGTH = 72;

/**
 * The sign-in form as its page posts it: the email, trimmed, which must be an email; the password, 1 to 72 characters;
 * and the page a sign-in goes back to (`next`), which the route reads on its own with returnPathOf, so a refused
 * sign-in keeps it.
 */
export const signInFormSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  next: z.string().optional(),
});

/** A sign-in form's fields, once they passed their checks. */
export type SignInFields = z.infer<typeof signInFormSchema>;

/** Reads a posted sign-in form, or null when any field fails its check, a field that isn't text included. */
export function parseSignInForm(form: FormData): SignInFields | null {
  const parsed = signInFormSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    next: form.get(NEXT_PARAM) ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

/** What authErrorCodeOf reads of an Auth error: its code and its HTTP status. Its message, Auth's English, never counts. */
export type AuthErrorFacts = Partial<Pick<AuthError, "code" | "status">>;

/** The codes an answer from Auth can come to: every sign-in code but `config`, which means there was no one to ask. */
export type AuthErrorCode = Exclude<SignInErrorCode, "config">;

/**
 * The app's code for Auth's refusal of a sign-in, read from its code and status only. Auth answers a wrong password, an
 * unknown email and a user without a password alike (`invalid_credentials`), so all three are `invalid`. Too many
 * requests (429, or `over_request_rate_limit`) are `busy`: Auth counts them by the address it sees, the Worker's, which
 * every user of the deployment shares. Anything else is `failed`, an error without a code or a status included.
 */
export function authErrorCodeOf({ code, status }: AuthErrorFacts): AuthErrorCode {
  if (code === "invalid_credentials") {
    return "invalid";
  }
  if (status === 429 || code === "over_request_rate_limit") {
    return "busy";
  }
  return "failed";
}

/**
 * Where a refused sign-in goes back to: the sign-in page with the code of why (`?error=invalid`), then the page the
 * sign-in was to go back to (`next`), so the next try keeps it, unless that's the list, where a sign-in goes anyway.
 * `next` must already be one returnPathOf gave.
 */
export function signInErrorHref(code: SignInErrorCode, next: string): string {
  const query = new URLSearchParams({ [ERROR_PARAM]: code });
  if (next !== DEFAULT_RETURN_PATH) {
    query.set(NEXT_PARAM, next);
  }
  return `${SIGN_IN_PATH}?${query.toString()}`;
}

/**
 * What a sign-out came to: the session is gone (`done`), Auth answered an error, so the session may still be there
 * (`failed`), or there's no Supabase, so there was no session to end (`config`).
 */
export type SignOutOutcome = "done" | "failed" | "config";

/**
 * Where a sign-out goes: the sign-in page with "Wylogowano." once the session is gone (`?signed-out=1`); the list with
 * its notice that the sign-out didn't go through (`?sign-out=failed`), never "Wylogowano.", when Auth answered an error;
 * and the plain sign-in page without Supabase.
 */
export function signOutBackTo(outcome: SignOutOutcome): string {
  switch (outcome) {
    case "done":
      return `${SIGN_IN_PATH}?${new URLSearchParams({ [SIGNED_OUT_PARAM]: "1" }).toString()}`;
    case "failed":
      return filterHref(DEFAULT_RETURN_PATH, "all", { [SIGN_OUT_PARAM]: "failed" satisfies SignOutCode });
    case "config":
      return SIGN_IN_PATH;
  }
}
