import {
  AuthApiError,
  AuthError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  CONFIRM_ERROR_CODES,
  CONFIRM_ERRORS,
  confirmErrorMessage,
  ERROR_PARAM,
  LIST_NOTICE_PARAMS,
  PASSWORD_ERROR_CODES,
  PASSWORD_ERRORS,
  PASSWORD_SET_NOTICE,
  PASSWORD_SET_PARAM,
  passwordErrorMessage,
  SET_PASSWORD_NOTICE_PARAMS,
  SIGN_IN_ERROR_CODES,
  SIGN_IN_NOTICE_PARAMS,
  SIGN_OUT_PARAM,
  SIGNED_OUT_PARAM,
  signInErrorMessage,
  signOutErrorMessage,
} from "@/lib/notices";
import {
  authErrorCodeOf,
  confirmBackTo,
  confirmErrorCodeOf,
  confirmFormSchema,
  confirmPageOf,
  isLinkSession,
  LINK_TYPES,
  linkSessionOf,
  parseConfirmForm,
  parsePasswordForm,
  parseSignInForm,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordErrorCodeOf,
  passwordFormSchema,
  setPasswordBackTo,
  setPasswordRedirectOf,
  signInErrorHref,
  signInFormSchema,
  signOutBackTo,
  type AuthErrorFacts,
} from "@/lib/services/auth";
import { DEFAULT_RETURN_PATH, returnPathOf } from "@/lib/services/return-path";
import { NEXT_PARAM, SIGN_IN_PATH } from "@/lib/services/watchlist-rows";

const PRODUCT = "/watchlist/9b9146bf-03e0-44ca-a9fc-1b1811c40ecb";
const SITE = "https://drogeria.example";

/** A sign-in form as its page posts it. */
function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
}

describe("signInFormSchema, the sign-in form's checks", () => {
  it("takes an email, trimmed, a password and no return path", () => {
    expect(signInFormSchema.parse({ email: "  ola@example.com ", password: "tajne" })).toEqual({
      email: "ola@example.com",
      password: "tajne",
    });
  });

  it("takes the page a sign-in goes back to as text", () => {
    expect(signInFormSchema.parse({ email: "ola@example.com", password: "tajne", next: PRODUCT })).toMatchObject({
      next: PRODUCT,
    });
  });

  it.each(["", "   ", "ola", "ola@", "@example.com", "ola example@example.com", "ola@localhost"])(
    "refuses %j, which isn't an email",
    (email) => {
      expect(signInFormSchema.safeParse({ email, password: "tajne" }).success).toBe(false);
    },
  );

  it("takes a password of 1 to 72 characters", () => {
    expect(signInFormSchema.safeParse({ email: "ola@example.com", password: "x" }).success).toBe(true);
    expect(signInFormSchema.safeParse({ email: "ola@example.com", password: "x".repeat(72) }).success).toBe(true);
  });

  it("refuses an empty password and one of 73 characters, longer than any Auth sets", () => {
    expect(signInFormSchema.safeParse({ email: "ola@example.com", password: "" }).success).toBe(false);
    expect(signInFormSchema.safeParse({ email: "ola@example.com", password: "x".repeat(73) }).success).toBe(false);
  });

  it("keeps the password as typed, spaces included", () => {
    expect(signInFormSchema.parse({ email: "ola@example.com", password: " tajne " }).password).toBe(" tajne ");
  });
});

describe("parseSignInForm, a posted sign-in form", () => {
  it("reads the email, the password and the return path", () => {
    expect(parseSignInForm(form({ email: "ola@example.com", password: "tajne", [NEXT_PARAM]: PRODUCT }))).toEqual({
      email: "ola@example.com",
      password: "tajne",
      next: PRODUCT,
    });
  });

  it("reads a form without a return path", () => {
    expect(parseSignInForm(form({ email: "ola@example.com", password: "tajne" }))).toEqual({
      email: "ola@example.com",
      password: "tajne",
    });
  });

  it.each<{ why: string; fields: Record<string, string | File> }>([
    { why: "without an email", fields: { password: "tajne" } },
    { why: "without a password", fields: { email: "ola@example.com" } },
    { why: "with an email that isn't one", fields: { email: "ola", password: "tajne" } },
    { why: "with an email that's a file", fields: { email: new File(["ola@example.com"], "e"), password: "tajne" } },
    { why: "with a password that's a file", fields: { email: "ola@example.com", password: new File(["tajne"], "p") } },
    {
      why: "with a return path that's a file",
      fields: { email: "ola@example.com", password: "tajne", [NEXT_PARAM]: new File([PRODUCT], "n") },
    },
  ])("refuses a form $why", ({ fields }) => {
    expect(parseSignInForm(form(fields))).toBeNull();
  });
});

describe("authErrorCodeOf, Auth's refusal as the app's code", () => {
  it.each<{ why: string; error: AuthErrorFacts; code: string }>([
    { why: "wrong credentials", error: { code: "invalid_credentials", status: 400 }, code: "invalid" },
    { why: "too many requests", error: { code: "over_request_rate_limit", status: 429 }, code: "busy" },
    { why: "a 429 without a code", error: { status: 429 }, code: "busy" },
    { why: "the rate limit's code without a status", error: { code: "over_request_rate_limit" }, code: "busy" },
    { why: "an email that isn't confirmed", error: { code: "email_not_confirmed", status: 400 }, code: "failed" },
    { why: "a banned user", error: { code: "user_banned", status: 400 }, code: "failed" },
    { why: "a server error", error: { code: "unexpected_failure", status: 500 }, code: "failed" },
    { why: "an error without a code or a status", error: {}, code: "failed" },
  ])("reads $why as $code", ({ error, code }) => {
    expect(authErrorCodeOf(error)).toBe(code);
  });

  it("reads the errors Auth's client returns", () => {
    expect(authErrorCodeOf(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"))).toBe("invalid");
    expect(authErrorCodeOf(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"))).toBe(
      "busy",
    );
    expect(authErrorCodeOf(new AuthError("Failed to fetch"))).toBe("failed");
  });

  it("never reads the message, Auth's own English", () => {
    expect(authErrorCodeOf(new AuthApiError("Invalid login credentials", 400, undefined))).toBe("failed");
    expect(authErrorCodeOf(new AuthApiError("Request rate limit reached", 400, "validation_failed"))).toBe("failed");
  });

  it("gives only codes the sign-in page has a text for", () => {
    for (const error of [{ code: "invalid_credentials" }, { status: 429 }, {}]) {
      expect(signInErrorMessage(authErrorCodeOf(error))).not.toBeNull();
    }
  });
});

describe("signInErrorHref, where a refused sign-in goes back to", () => {
  it("names only the code when the sign-in goes back to the list", () => {
    expect(signInErrorHref("invalid", DEFAULT_RETURN_PATH)).toBe("/auth/signin?error=invalid");
    expect(signInErrorHref("config", DEFAULT_RETURN_PATH)).toBe("/auth/signin?error=config");
  });

  it("keeps the page the sign-in was to go back to, after the code", () => {
    expect(signInErrorHref("busy", `${PRODUCT}?f=check`)).toBe(
      `/auth/signin?error=busy&next=${encodeURIComponent(`${PRODUCT}?f=check`)}`,
    );
  });

  it("carries each code and the return path so the sign-in page reads both back", () => {
    for (const code of SIGN_IN_ERROR_CODES) {
      const page = new URL(signInErrorHref(code, `${PRODUCT}?f=promo`), SITE);

      expect(page.pathname).toBe(SIGN_IN_PATH);
      expect(signInErrorMessage(page.searchParams.get(ERROR_PARAM))).not.toBeNull();
      expect(returnPathOf(page.searchParams.get(NEXT_PARAM))).toBe(`${PRODUCT}?f=promo`);
    }
  });

  it("puts its code where the page's address bar forgets it, and the return path where it stays", () => {
    expect(SIGN_IN_NOTICE_PARAMS).toContain(ERROR_PARAM);
    expect(SIGN_IN_NOTICE_PARAMS).not.toContain(NEXT_PARAM);
  });
});

describe("signOutBackTo, where a sign-out goes", () => {
  it("goes to the sign-in page with its notice once the session is gone", () => {
    expect(signOutBackTo("done")).toBe("/auth/signin?signed-out=1");
    expect(new URL(signOutBackTo("done"), SITE).searchParams.has(SIGNED_OUT_PARAM)).toBe(true);
  });

  it("goes back to the list with its error when Auth answered one, never saying it signed out", () => {
    const back = new URL(signOutBackTo("failed"), SITE);

    expect(signOutBackTo("failed")).toBe("/watchlist?sign-out=failed");
    expect(back.searchParams.has(SIGNED_OUT_PARAM)).toBe(false);
    expect(signOutErrorMessage(back.searchParams.get(SIGN_OUT_PARAM))).toBe(
      "Nie udało się wylogować. Spróbuj ponownie.",
    );
    // The list's address bar forgets it once shown.
    expect(LIST_NOTICE_PARAMS).toContain(SIGN_OUT_PARAM);
  });

  it("goes to the plain sign-in page without Supabase, where there was no session to end", () => {
    expect(signOutBackTo("config")).toBe("/auth/signin");
  });
});

// A handed-over link's token as Auth's generateLink gives it: the hex SHA-224 of the email and the link's code.
const TOKEN = "3f1a9c0b7e5d2468ace013579bdf2468ace013579bdf2468ace01357";

describe("confirmFormSchema, a handed-over link's checks", () => {
  it("has a token of 56 hex digits", () => {
    expect(TOKEN).toHaveLength(56);
  });

  it.each(LINK_TYPES)("takes a token of 56 lowercase hex digits for a %s link", (type) => {
    expect(confirmFormSchema.parse({ token_hash: TOKEN, type })).toEqual({ token_hash: TOKEN, type });
  });

  it.each<{ why: string; token: string }>([
    { why: "55 digits", token: TOKEN.slice(1) },
    { why: "57 digits", token: `${TOKEN}0` },
    { why: "uppercase hex", token: TOKEN.toUpperCase() },
    { why: "a digit that isn't hex", token: `g${TOKEN.slice(1)}` },
    { why: "a space around it", token: ` ${TOKEN.slice(1)}` },
    { why: "nothing", token: "" },
    { why: "a malformed token", token: "not-a-token" },
  ])("refuses a token of $why", ({ token }) => {
    expect(confirmFormSchema.safeParse({ token_hash: token, type: "invite" }).success).toBe(false);
  });

  it.each(["signup", "magiclink", "email", "email_change", "INVITE", "", "invite "])(
    "refuses the type %j, which no handed-over link has",
    (type) => {
      expect(confirmFormSchema.safeParse({ token_hash: TOKEN, type }).success).toBe(false);
    },
  );
});

describe("parseConfirmForm, a handed-over link from an address or a form", () => {
  it("reads the link from the confirm page's address, whatever else it holds", () => {
    expect(parseConfirmForm(new URLSearchParams({ token_hash: TOKEN, type: "recovery", f: "check" }))).toEqual({
      token_hash: TOKEN,
      type: "recovery",
    });
  });

  it("reads the link from the form the page posts", () => {
    expect(parseConfirmForm(form({ token_hash: TOKEN, type: "invite" }))).toEqual({
      token_hash: TOKEN,
      type: "invite",
    });
  });

  it.each<{ why: string; fields: Record<string, string | File> }>([
    { why: "without a token", fields: { type: "invite" } },
    { why: "without a type", fields: { token_hash: TOKEN } },
    { why: "with a token that's a file", fields: { token_hash: new File([TOKEN], "t"), type: "invite" } },
    { why: "with a type that's a file", fields: { token_hash: TOKEN, type: new File(["invite"], "t") } },
  ])("refuses a form $why", ({ fields }) => {
    expect(parseConfirmForm(form(fields))).toBeNull();
  });

  it("refuses an address without a link", () => {
    expect(parseConfirmForm(new URLSearchParams())).toBeNull();
  });
});

describe("confirmPageOf, what the confirm page shows", () => {
  it("shows the button for the link its address holds", () => {
    expect(confirmPageOf(new URLSearchParams({ token_hash: TOKEN, type: "invite" }))).toEqual({
      link: { token_hash: TOKEN, type: "invite" },
      error: null,
    });
  });

  it.each(CONFIRM_ERROR_CODES)("shows the text of %s, with no button, after a post that came back with it", (code) => {
    expect(confirmPageOf(new URLSearchParams({ [ERROR_PARAM]: code }))).toEqual({
      link: null,
      error: CONFIRM_ERRORS[code],
    });
  });

  it("lets a code the app sent win over a link in the same address, since that link was already tried", () => {
    expect(confirmPageOf(new URLSearchParams({ token_hash: TOKEN, type: "invite", [ERROR_PARAM]: "expired" }))).toEqual(
      { link: null, error: CONFIRM_ERRORS.expired },
    );
  });

  it("says an address without a link, or with one that isn't, is an invalid link", () => {
    expect(confirmPageOf(new URLSearchParams())).toEqual({ link: null, error: CONFIRM_ERRORS.invalid });
    expect(confirmPageOf(new URLSearchParams({ token_hash: "not-a-token", type: "invite" }))).toEqual({
      link: null,
      error: CONFIRM_ERRORS.invalid,
    });
    expect(confirmPageOf(new URLSearchParams({ token_hash: TOKEN, type: "signup" }))).toEqual({
      link: null,
      error: CONFIRM_ERRORS.invalid,
    });
  });

  it.each(["Email link is invalid or has expired", "toString", "__proto__", "EXPIRED"])(
    "reads the code %j, which the route never sends, as none",
    (code) => {
      expect(confirmPageOf(new URLSearchParams({ token_hash: TOKEN, type: "invite", [ERROR_PARAM]: code }))).toEqual({
        link: { token_hash: TOKEN, type: "invite" },
        error: null,
      });
      expect(confirmPageOf(new URLSearchParams({ [ERROR_PARAM]: code }))).toEqual({
        link: null,
        error: CONFIRM_ERRORS.invalid,
      });
    },
  );
});

describe("confirmErrorCodeOf, Auth's refusal of a handed-over link as the app's code", () => {
  it.each<{ why: string; error: AuthErrorFacts; code: string }>([
    { why: "an expired, used or unknown link", error: { code: "otp_expired", status: 403 }, code: "expired" },
    { why: "too many requests", error: { code: "over_request_rate_limit", status: 429 }, code: "busy" },
    { why: "a 429 without a code", error: { status: 429 }, code: "busy" },
    { why: "the rate limit's code without a status", error: { code: "over_request_rate_limit" }, code: "busy" },
    { why: "a request Auth couldn't read", error: { code: "validation_failed", status: 400 }, code: "failed" },
    { why: "a server error", error: { code: "unexpected_failure", status: 500 }, code: "failed" },
    { why: "an error without a code or a status", error: {}, code: "failed" },
  ])("reads $why as $code", ({ error, code }) => {
    expect(confirmErrorCodeOf(error)).toBe(code);
  });

  it("reads the errors Auth's client returns", () => {
    expect(confirmErrorCodeOf(new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"))).toBe(
      "expired",
    );
    expect(confirmErrorCodeOf(new AuthError("Failed to fetch"))).toBe("failed");
  });

  it("never reads the message, Auth's own English", () => {
    expect(confirmErrorCodeOf(new AuthApiError("Email link is invalid or has expired", 403, undefined))).toBe("failed");
  });

  it("gives only codes the confirm page has a text for", () => {
    for (const error of [{ code: "otp_expired" }, { status: 429 }, {}]) {
      expect(confirmErrorMessage(confirmErrorCodeOf(error))).not.toBeNull();
    }
  });
});

describe("confirmBackTo, where a handed-over link's post goes", () => {
  it("goes to the set-password page once Auth signed the person in", () => {
    expect(confirmBackTo("verified")).toBe("/auth/set-password");
  });

  it("goes back to the confirm page with the code of why not, and no token", () => {
    expect(confirmBackTo("invalid")).toBe("/auth/confirm?error=invalid");
    expect(confirmBackTo("expired")).toBe("/auth/confirm?error=expired");
  });

  it("carries each code so the confirm page shows its text, with no button", () => {
    for (const code of CONFIRM_ERROR_CODES) {
      const page = new URL(confirmBackTo(code), SITE);

      expect(page.pathname).toBe("/auth/confirm");
      expect([...page.searchParams.keys()]).toEqual([ERROR_PARAM]);
      expect(confirmPageOf(page.searchParams)).toEqual({ link: null, error: CONFIRM_ERRORS[code] });
    }
  });
});

describe("passwordFormSchema, a new password's checks", () => {
  // Polish letters take 2 bytes each in UTF-8, as Auth counts a password.
  const POLISH = "ą";

  it(`counts the password in UTF-8 bytes, as Auth does: ${POLISH} is 2`, () => {
    expect(new TextEncoder().encode(POLISH)).toHaveLength(2);
  });

  it("takes a password of 8 to 72 bytes", () => {
    expect(passwordFormSchema.safeParse({ password: "x".repeat(8) }).success).toBe(true);
    expect(passwordFormSchema.safeParse({ password: "x".repeat(72) }).success).toBe(true);
  });

  it("refuses one of 7 bytes and one of 73", () => {
    expect(passwordFormSchema.safeParse({ password: "x".repeat(7) }).success).toBe(false);
    expect(passwordFormSchema.safeParse({ password: "x".repeat(73) }).success).toBe(false);
  });

  it("takes 36 Polish letters, 72 bytes, and refuses 37, 74 bytes in 37 characters", () => {
    expect(passwordFormSchema.safeParse({ password: POLISH.repeat(36) }).success).toBe(true);
    expect(passwordFormSchema.safeParse({ password: POLISH.repeat(37) }).success).toBe(false);
  });

  it("refuses a password of Polish letters within 72 characters but over 72 bytes", () => {
    const password = `Zażółć gęślą jaźń ${POLISH.repeat(30)}`;

    expect(password.length).toBeLessThanOrEqual(72);
    expect(new TextEncoder().encode(password).length).toBeGreaterThan(72);
    expect(passwordFormSchema.safeParse({ password }).success).toBe(false);
  });

  it("takes a password of Polish letters within both", () => {
    expect(passwordFormSchema.safeParse({ password: "Zażółć gęślą jaźń" }).success).toBe(true);
  });

  it("counts bytes at the lower end too: 4 Polish letters are 8 bytes, which the browser's minlength alone refuses", () => {
    expect(passwordFormSchema.safeParse({ password: POLISH.repeat(4) }).success).toBe(true);
    expect(passwordFormSchema.safeParse({ password: `${POLISH.repeat(3)}x` }).success).toBe(false);
  });

  it("keeps the password as typed, spaces included", () => {
    expect(passwordFormSchema.parse({ password: " tajne hasło " }).password).toBe(" tajne hasło ");
  });

  it("words its length text with the bounds it checks", () => {
    expect(passwordErrorMessage("invalid")).toBe(
      `Hasło musi mieć od ${String(PASSWORD_MIN_LENGTH)} do ${String(PASSWORD_MAX_LENGTH)} znaków.`,
    );
  });
});

describe("parsePasswordForm, a posted set-password form", () => {
  it("reads the new password", () => {
    expect(parsePasswordForm(form({ password: "Nowe-Haslo-123" }))).toBe("Nowe-Haslo-123");
  });

  it.each<{ why: string; fields: Record<string, string | File> }>([
    { why: "without a password", fields: {} },
    // 7 bytes: "krótkie", with its 2-byte "ó", would be 8 and pass.
    { why: "with a password too short", fields: { password: "krotkie" } },
    { why: "with a password that's a file", fields: { password: new File(["Nowe-Haslo-123"], "p") } },
  ])("refuses a form $why", ({ fields }) => {
    expect(parsePasswordForm(form(fields))).toBeNull();
  });
});

describe("passwordErrorCodeOf, Auth's refusal of a new password as the app's code", () => {
  it.each<{ why: string; error: AuthErrorFacts; code: string }>([
    { why: "a password Auth's policy refuses", error: { code: "weak_password", status: 422 }, code: "weak" },
    { why: "the account's own password", error: { code: "same_password", status: 422 }, code: "same" },
    { why: "a password over 72 bytes", error: { code: "validation_failed", status: 400 }, code: "invalid" },
    { why: "too many requests", error: { code: "over_request_rate_limit", status: 429 }, code: "busy" },
    { why: "a 429 without a code", error: { status: 429 }, code: "busy" },
    {
      why: "a change that needs a fresh sign-in",
      error: { code: "reauthentication_needed", status: 400 },
      code: "failed",
    },
    { why: "a session Auth no longer has", error: { code: "session_not_found", status: 403 }, code: "failed" },
    { why: "an error without a code or a status", error: {}, code: "failed" },
  ])("reads $why as $code", ({ error, code }) => {
    expect(passwordErrorCodeOf(error)).toBe(code);
  });

  it("reads the errors Auth's client returns", () => {
    expect(passwordErrorCodeOf(new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]))).toBe("weak");
    expect(
      passwordErrorCodeOf(
        new AuthApiError("New password should be different from the old password.", 422, "same_password"),
      ),
    ).toBe("same");
    expect(passwordErrorCodeOf(new AuthSessionMissingError())).toBe("failed");
  });

  it("never reads the message, Auth's own English", () => {
    expect(passwordErrorCodeOf(new AuthApiError("Password should be at least 8 characters.", 422, undefined))).toBe(
      "failed",
    );
  });

  it("gives only codes the set-password page has a text for", () => {
    for (const error of [{ code: "weak_password" }, { code: "same_password" }, { code: "validation_failed" }, {}]) {
      expect(passwordErrorMessage(passwordErrorCodeOf(error))).not.toBeNull();
    }
  });
});

describe("setPasswordBackTo, where a set-password post goes", () => {
  it("goes to the list with its notice once the password is saved", () => {
    const back = new URL(setPasswordBackTo("saved"), SITE);

    expect(setPasswordBackTo("saved")).toBe("/watchlist?password-set=1");
    expect(back.searchParams.has(PASSWORD_SET_PARAM)).toBe(true);
    expect(PASSWORD_SET_NOTICE).toBe("Hasło zapisane.");
    // The list's address bar forgets it once shown.
    expect(LIST_NOTICE_PARAMS).toContain(PASSWORD_SET_PARAM);
  });

  it("goes back to the set-password page with the code of why not, never the password", () => {
    for (const code of PASSWORD_ERROR_CODES) {
      const page = new URL(setPasswordBackTo(code), SITE);

      expect(page.pathname).toBe("/auth/set-password");
      expect([...page.searchParams.keys()]).toEqual([ERROR_PARAM]);
      expect(passwordErrorMessage(page.searchParams.get(ERROR_PARAM))).toBe(PASSWORD_ERRORS[code]);
    }
    // The page's address bar forgets the code once shown.
    expect(SET_PASSWORD_NOTICE_PARAMS).toContain(ERROR_PARAM);
  });
});

// 2026-10-04 12:00:00 UTC, in milliseconds as Date.now() gives it, and in Unix seconds as Auth stamps a session.
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const NOW_SECONDS = NOW / 1000;
const MINUTES = 60;
/** A session's mark that a handed-over link opened it, `secondsAgo` before now. */
const byLink = (secondsAgo: number) => ({ method: "otp", timestamp: NOW_SECONDS - secondsAgo });
/** A session's mark that a password sign-in opened it, `secondsAgo` before now. */
const byPassword = (secondsAgo: number) => ({ method: "password", timestamp: NOW_SECONDS - secondsAgo });

describe("linkSessionOf, whether a session may set a password", () => {
  it.each<{ why: string; amr: unknown[] }>([
    { why: "a link just opened", amr: [byLink(0)] },
    { why: "a link opened 30 minutes ago", amr: [byLink(30 * MINUTES)] },
    { why: "a link opened exactly 60 minutes ago", amr: [byLink(60 * MINUTES)] },
    { why: "a link Auth's clock stamped 30 seconds ahead of the Worker's", amr: [byLink(-30)] },
    { why: "a link Auth's clock stamped 5 minutes ahead", amr: [byLink(-5 * MINUTES)] },
    { why: "a fresh link's mark beside a password's", amr: [byPassword(0), byLink(10)] },
    { why: "a fresh link's mark beside an odd entry", amr: [null, "otp", byLink(10)] },
  ])("lets $why set the password", ({ amr }) => {
    expect(linkSessionOf({ amr }, NOW)).toBe(true);
  });

  it.each<{ why: string; amr: unknown }>([
    { why: "a link opened a second more than 60 minutes ago", amr: [byLink(60 * MINUTES + 1)] },
    { why: "a link opened a day ago", amr: [byLink(24 * 60 * MINUTES)] },
    { why: "a link stamped more than 5 minutes ahead", amr: [byLink(-5 * MINUTES - 1)] },
    { why: "a password sign-in", amr: [byPassword(0)] },
    { why: "an old link's mark beside a fresh password's", amr: [byLink(2 * 60 * MINUTES), byPassword(0)] },
    { why: "an empty amr", amr: [] },
    { why: "an amr without timestamps", amr: ["otp"] },
    { why: "an amr that isn't a list", amr: "otp" },
    { why: "an amr that's one entry, not a list of them", amr: byLink(0) },
    { why: "an amr of null", amr: null },
    { why: "an entry without a method", amr: [{ timestamp: NOW_SECONDS }] },
    { why: "an entry without a timestamp", amr: [{ method: "otp" }] },
    { why: "a timestamp that's text", amr: [{ method: "otp", timestamp: String(NOW_SECONDS) }] },
    { why: "a timestamp that isn't a number", amr: [{ method: "otp", timestamp: Number.NaN }] },
    { why: "an endless timestamp", amr: [{ method: "otp", timestamp: Number.POSITIVE_INFINITY }] },
    { why: "a method in other letters", amr: [{ method: "OTP", timestamp: NOW_SECONDS }] },
    { why: "a magic link's mark", amr: [{ method: "magiclink", timestamp: NOW_SECONDS }] },
    { why: "entries that aren't objects", amr: [null, 42, "otp"] },
  ])("keeps $why off", ({ amr }) => {
    expect(linkSessionOf({ amr }, NOW)).toBe(false);
  });

  it("keeps claims without an amr off, and no claims at all", () => {
    expect(linkSessionOf({}, NOW)).toBe(false);
    expect(linkSessionOf({ amr: undefined }, NOW)).toBe(false);
    expect(linkSessionOf(null, NOW)).toBe(false);
    expect(linkSessionOf(undefined, NOW)).toBe(false);
  });

  it("reads the claims getClaims gives, with the rest of a token's claims beside the amr", () => {
    const claims = { sub: "user", role: "authenticated", aal: "aal1", amr: [byLink(5)], session_id: "s" };

    expect(linkSessionOf(claims, NOW)).toBe(true);
  });
});

/** A client whose getClaims answers `result`, as Auth's client does. */
function claimsClient(result: unknown) {
  const getClaims = vi.fn(() => Promise.resolve(result));
  return { client: { auth: { getClaims } } as unknown as SupabaseClient, getClaims };
}

describe("isLinkSession, the request's session judged from its verified claims", () => {
  it("lets a session a link just opened set the password, asking Auth once", async () => {
    const { client, getClaims } = claimsClient({ data: { claims: { amr: [byLink(0)] } }, error: null });

    await expect(isLinkSession(client, NOW)).resolves.toBe(true);
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("keeps a password session off", async () => {
    const { client } = claimsClient({ data: { claims: { amr: [byPassword(0)] } }, error: null });

    await expect(isLinkSession(client, NOW)).resolves.toBe(false);
  });

  it("keeps a request off when Auth answers an error, or there's no session", async () => {
    const refused = claimsClient({ data: null, error: new AuthApiError("invalid JWT", 403, "bad_jwt") });
    const signedOut = claimsClient({ data: null, error: null });

    await expect(isLinkSession(refused.client, NOW)).resolves.toBe(false);
    await expect(isLinkSession(signedOut.client, NOW)).resolves.toBe(false);
  });

  it("keeps a request off without Supabase", async () => {
    await expect(isLinkSession(null, NOW)).resolves.toBe(false);
  });
});

describe("setPasswordRedirectOf, where a set-password request goes instead", () => {
  it("lets a session a link just opened through to the page and its update", async () => {
    const { client } = claimsClient({ data: { claims: { amr: [byLink(0)] } }, error: null });

    await expect(setPasswordRedirectOf(client, NOW)).resolves.toBeNull();
  });

  it("sends a link session older than an hour to the plain list", async () => {
    const { client } = claimsClient({ data: { claims: { amr: [byLink(61 * MINUTES)] } }, error: null });

    await expect(setPasswordRedirectOf(client, NOW)).resolves.toBe("/watchlist");
  });

  it("sends a password session to the plain list, so set-password never changes a signed-in user's password", async () => {
    const { client } = claimsClient({ data: { claims: { amr: [byPassword(0)] } }, error: null });

    await expect(setPasswordRedirectOf(client, NOW)).resolves.toBe("/watchlist");
  });

  it("sends a request Auth couldn't vouch for, or one without Supabase, to the plain list", async () => {
    const refused = claimsClient({ data: null, error: new AuthApiError("invalid JWT", 403, "bad_jwt") });

    await expect(setPasswordRedirectOf(refused.client, NOW)).resolves.toBe("/watchlist");
    await expect(setPasswordRedirectOf(null, NOW)).resolves.toBe("/watchlist");
  });
});
