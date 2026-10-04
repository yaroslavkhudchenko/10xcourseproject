import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "astro/zod";
import {
  CONFIRM_ERRORS,
  confirmErrorMessage,
  ERROR_PARAM,
  PASSWORD_SET_PARAM,
  SIGN_OUT_PARAM,
  SIGNED_OUT_PARAM,
  type ConfirmErrorCode,
  type PasswordErrorCode,
  type SignInErrorCode,
  type SignOutCode,
} from "@/lib/notices";
import { DEFAULT_RETURN_PATH } from "@/lib/services/return-path";
import { filterHref, NEXT_PARAM, SIGN_IN_PATH } from "@/lib/services/watchlist-rows";

// The auth rules, for the sign-in, sign-out, confirm and set-password routes and pages: the forms' checks, Auth's
// answers as the app's own codes, which each page turns into its own text (notices.ts), so neither Auth's English
// message nor a crafted link's words reach it, which session may set a password, and where each post goes back to.

/**
 * The most a password may have: 72. Auth sets no password longer than 72 bytes, bcrypt's limit, so a longer one can't
 * be anyone's: the sign-in form refuses one of more than 72 characters before asking Auth, and a new password counts
 * its bytes, as Auth does.
 */
export const PASSWORD_MAX_LENGTH = 72;

/** The fewest bytes a new password may have: 8, the least Supabase recommends. Auth's own policy applies on top. */
export const PASSWORD_MIN_LENGTH = 8;

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

/** What the error mappers read of an Auth error: its code and its HTTP status. Its message, Auth's English, never counts. */
export type AuthErrorFacts = Partial<Pick<AuthError, "code" | "status">>;

/** The codes an answer from Auth can come to: every sign-in code but `config`, which means there was no one to ask. */
export type AuthErrorCode = Exclude<SignInErrorCode, "config">;

// Too many requests, a 429 or its code: Auth counts them by the address it sees, the Worker's, which every user of the
// deployment shares.
function tooManyRequests({ code, status }: AuthErrorFacts): boolean {
  return status === 429 || code === "over_request_rate_limit";
}

/**
 * The app's code for Auth's refusal of a sign-in, read from its code and status only. Auth answers a wrong password, an
 * unknown email and a user without a password alike (`invalid_credentials`), so all three are `invalid`. Too many
 * requests (429, or `over_request_rate_limit`) are `busy`: Auth counts them by the address it sees, the Worker's, which
 * every user of the deployment shares. Anything else is `failed`, an error without a code or a status included.
 */
export function authErrorCodeOf(error: AuthErrorFacts): AuthErrorCode {
  if (error.code === "invalid_credentials") {
    return "invalid";
  }
  return tooManyRequests(error) ? "busy" : "failed";
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

// The page a handed-over link opens, whose button posts the link back, and the page the person it signed in chooses
// their password on.
const CONFIRM_PATH = "/auth/confirm";
const SET_PASSWORD_PATH = "/auth/set-password";

/** What a handed-over link is for: an invite, which gives a new account its first password, or a recovery's new one. */
export const LINK_TYPES = ["invite", "recovery"] as const;

/**
 * A handed-over link as the confirm page reads it from its address and its form posts it back: Auth's hashed token
 * (`token_hash`), the hex SHA-224 of the email and the link's code, so 56 lowercase hex digits, and what the link is for
 * (`type`). The link scripts/owner-link.mjs prints, `<app>/auth/confirm?token_hash=<token>&type=<invite|recovery>`, is
 * this schema's contract: change them together.
 */
export const confirmFormSchema = z.object({
  token_hash: z.string().regex(/^[0-9a-f]{56}$/),
  type: z.enum(LINK_TYPES),
});

/** A handed-over link's fields, once they passed their checks. */
export type ConfirmFields = z.infer<typeof confirmFormSchema>;

/**
 * Reads a handed-over link's fields, from the confirm page's address or from the form it posts, or null when either
 * fails its check, a field that isn't text included.
 */
export function parseConfirmForm(fields: { get(name: string): FormDataEntryValue | null }): ConfirmFields | null {
  const parsed = confirmFormSchema.safeParse({ token_hash: fields.get("token_hash"), type: fields.get("type") });
  return parsed.success ? parsed.data : null;
}

/** What the confirm page shows: the button that uses a link (`link`), or the text of why there's none to use (`error`). */
export type ConfirmPage = { link: ConfirmFields; error: null } | { link: null; error: string };

/**
 * What the confirm page at an address shows: the text of the code its last post came back with (`?error=expired`), which
 * wins, since that post's link was already tried; else the button for the link the address holds; else, for an
 * address without a link the page takes, `invalid`'s text. A code the app didn't send counts as none.
 */
export function confirmPageOf(params: URLSearchParams): ConfirmPage {
  const error = confirmErrorMessage(params.get(ERROR_PARAM));
  if (error !== null) {
    return { link: null, error };
  }
  const link = parseConfirmForm(params);
  return link === null ? { link: null, error: CONFIRM_ERRORS.invalid } : { link, error: null };
}

/** The codes an answer from Auth to a handed-over link can come to: `invalid` is the form's, `config` no client's. */
export type ConfirmAuthErrorCode = Exclude<ConfirmErrorCode, "invalid" | "config">;

/**
 * The app's code for Auth's refusal of a handed-over link, read from its code and status only. Auth answers a link that
 * expired, was used already or was never made alike (`otp_expired`), so all three are `expired`. Too many requests are
 * `busy`, and anything else is `failed`, an error without a code or a status included.
 */
export function confirmErrorCodeOf(error: AuthErrorFacts): ConfirmAuthErrorCode {
  if (error.code === "otp_expired") {
    return "expired";
  }
  return tooManyRequests(error) ? "busy" : "failed";
}

/** What a handed-over link's post came to: Auth signed the person in (`verified`), or the code of why it didn't. */
export type ConfirmOutcome = ConfirmErrorCode | "verified";

/**
 * Where a handed-over link's post goes: the set-password page once Auth signed the person in, else the confirm page
 * with the code of why not (`?error=expired`), which the page turns into its own text. The link's token never goes
 * into an address the app sends.
 */
export function confirmBackTo(outcome: ConfirmOutcome): string {
  if (outcome === "verified") {
    return SET_PASSWORD_PATH;
  }
  return `${CONFIRM_PATH}?${new URLSearchParams({ [ERROR_PARAM]: outcome }).toString()}`;
}

// A password's length as Auth counts it: in UTF-8 bytes, so "ą" counts 2.
const UTF8 = new TextEncoder();

/**
 * The set-password form: a new password of 8 to 72 bytes, counted in UTF-8 as Auth counts it, so a password of Polish
 * letters within 72 characters but over 72 bytes gets the page's length text rather than Auth's refusal. It's kept as
 * typed, spaces included.
 */
export const passwordFormSchema = z.object({
  password: z.string().refine((password) => {
    const bytes = UTF8.encode(password).length;
    return bytes >= PASSWORD_MIN_LENGTH && bytes <= PASSWORD_MAX_LENGTH;
  }),
});

/** Reads a posted set-password form's new password, or null when it fails its check, a field that isn't text included. */
export function parsePasswordForm(form: FormData): string | null {
  const parsed = passwordFormSchema.safeParse({ password: form.get("password") });
  return parsed.success ? parsed.data.password : null;
}

// How long after a handed-over link opened a session that session may set a password, and how far ahead of the
// Worker's clock Auth's may run, so a session Auth stamped a moment "after" now still counts.
const LINK_SESSION_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** What linkSessionOf reads of a session's verified claims: only how it was signed in (`amr`). */
export interface SessionClaims {
  readonly amr?: unknown;
}

/**
 * Whether a session's verified claims show that a handed-over link opened it within the last 60 minutes, so it may
 * set the account's password: its `amr` holds an `otp` entry whose timestamp, in Unix seconds as Auth stamps it, is no
 * more than 60 minutes before `now`, in milliseconds as Date.now() gives it, nor more than 5 minutes after it, the
 * clocks' skew. Auth marks a session verifyOtp opened `[{ method: "otp", timestamp }]` and never changes the mark, a
 * refresh included; a password sign-in's is `password`. Anything else is false: a password session, an older link
 * session, no claims, and an `amr` that's missing, not a list, in the form without timestamps (`["otp"]`), or whose
 * entries are odd.
 */
export function linkSessionOf(claims: SessionClaims | null | undefined, now: number): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) {
    return false;
  }
  const entries: readonly unknown[] = amr;
  return entries.some((entry) => {
    if (typeof entry !== "object" || entry === null || !("method" in entry) || !("timestamp" in entry)) {
      return false;
    }
    const { method, timestamp } = entry;
    if (method !== "otp" || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return false;
    }
    const age = now - timestamp * 1000;
    return age >= -CLOCK_SKEW_MS && age <= LINK_SESSION_MS;
  });
}

/**
 * Whether the request's session may set a password: Auth verifies the session's claims (getClaims, through one /user
 * call while the project signs its tokens with a shared secret, as the local stack does), and linkSessionOf judges
 * them. No client, no session and an error from Auth are all false.
 */
export async function isLinkSession(supabase: SupabaseClient | null, now: number): Promise<boolean> {
  if (supabase === null) {
    return false;
  }
  const { data } = await supabase.auth.getClaims();
  return linkSessionOf(data?.claims, now);
}

/**
 * Where a request to the set-password page or its route goes instead, or null when its session may set a password
 * (isLinkSession): any other session, a password sign-in's included, goes to the plain list, before a form is read or
 * Auth is asked to change anything, so the page never becomes a way to change a signed-in user's password.
 */
export async function setPasswordRedirectOf(supabase: SupabaseClient | null, now: number): Promise<string | null> {
  return (await isLinkSession(supabase, now)) ? null : DEFAULT_RETURN_PATH;
}

/** The codes an answer from Auth to a new password can come to: every set-password code but `config`. */
export type PasswordAuthErrorCode = Exclude<PasswordErrorCode, "config">;

/**
 * The app's code for Auth's refusal of a new password, read from its code and status only: one its password policy
 * refuses (`weak_password`) is `weak`, the password the account has already (`same_password`) is `same`, and one longer
 * than 72 bytes (`validation_failed`), which the form's own check stops first, is `invalid`, the length text. Too many
 * requests are `busy`, and anything else is `failed`, an error without a code or a status included.
 */
export function passwordErrorCodeOf(error: AuthErrorFacts): PasswordAuthErrorCode {
  if (error.code === "weak_password") {
    return "weak";
  }
  if (error.code === "same_password") {
    return "same";
  }
  if (error.code === "validation_failed") {
    return "invalid";
  }
  return tooManyRequests(error) ? "busy" : "failed";
}

/** What a set-password post came to: the password is saved (`saved`), or the code of why not. */
export type SetPasswordOutcome = PasswordErrorCode | "saved";

/**
 * Where a set-password post goes: the list with "Hasło zapisane." once the password is saved (`?password-set=1`), else
 * the set-password page with the code of why not (`?error=weak`), never the password. A session that may not set a
 * password goes to the plain list before its form is read (setPasswordRedirectOf).
 */
export function setPasswordBackTo(outcome: SetPasswordOutcome): string {
  if (outcome === "saved") {
    return filterHref(DEFAULT_RETURN_PATH, "all", { [PASSWORD_SET_PARAM]: "1" });
  }
  return `${SET_PASSWORD_PATH}?${new URLSearchParams({ [ERROR_PARAM]: outcome }).toString()}`;
}
