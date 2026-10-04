import { AuthApiError, AuthError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  ERROR_PARAM,
  LIST_NOTICE_PARAMS,
  SIGN_IN_ERROR_CODES,
  SIGN_IN_NOTICE_PARAMS,
  SIGN_OUT_PARAM,
  SIGNED_OUT_PARAM,
  signInErrorMessage,
  signOutErrorMessage,
} from "@/lib/notices";
import {
  authErrorCodeOf,
  parseSignInForm,
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
