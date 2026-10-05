import { describe, expect, it } from "vitest";
import {
  CONFIRM_ERROR_CODES,
  CONFIRM_ERRORS,
  confirmErrorMessage,
  DECISION_CODES,
  DECISION_NOTICES,
  ERROR_PARAM,
  EXISTS_PARAM,
  LIST_NOTICE_PARAMS,
  LIST_PRICES_PARAM,
  NOTICE_PARAMS,
  PASSWORD_ERROR_CODES,
  PASSWORD_ERRORS,
  PASSWORD_SET_PARAM,
  passwordErrorMessage,
  PRICES_PARAM,
  REMOVAL_PARAM,
  REMOVED_PARAM,
  REPIN_PARAM,
  RETRY_PARAM,
  SET_PASSWORD_NOTICE_PARAMS,
  SHOP_PARAM,
  SIGN_IN_ERROR_CODES,
  SIGN_IN_ERRORS,
  SIGN_IN_NOTICE_PARAMS,
  SIGN_OUT_CODES,
  SIGN_OUT_NOTICES,
  SIGN_OUT_PARAM,
  SIGNED_OUT_PARAM,
  signInErrorMessage,
  signOutErrorMessage,
  withoutNotices,
} from "@/lib/notices";

// Each page's address-bar script forgets the parameters these lists name once their notice has shown, and keeps every
// other one. The scripts are inline browser code, so these tests pin what they forget: a parameter left out would show
// its notice again on a reload or from a copied link, and one put in would drop what the address keeps, such as the
// list's filter.

describe("LIST_NOTICE_PARAMS, which the list's address bar forgets", () => {
  it("holds every parameter the list shows a notice by: Dodaj's, an error's, the refresh's, a removal's, a failed sign-out's and a saved password's", () => {
    expect(LIST_NOTICE_PARAMS).toHaveLength(6);
    expect(LIST_NOTICE_PARAMS).toEqual(
      expect.arrayContaining([
        EXISTS_PARAM,
        ERROR_PARAM,
        LIST_PRICES_PARAM,
        REMOVED_PARAM,
        SIGN_OUT_PARAM,
        PASSWORD_SET_PARAM,
      ]),
    );
  });

  it("keeps the list's filter and its search", () => {
    expect(LIST_NOTICE_PARAMS).not.toContain("f");
    expect(LIST_NOTICE_PARAMS).not.toContain("q");
  });
});

describe("NOTICE_PARAMS, which the product page's address bar forgets", () => {
  it("holds a decision's with its shop's, an error's, both refreshes', a failed removal's, a re-pin's and a retry's", () => {
    expect(NOTICE_PARAMS).toEqual(
      expect.arrayContaining([
        ...DECISION_CODES,
        SHOP_PARAM,
        ERROR_PARAM,
        PRICES_PARAM,
        LIST_PRICES_PARAM,
        REMOVAL_PARAM,
        REPIN_PARAM,
        RETRY_PARAM,
      ]),
    );
  });

  it("keeps the list's filter", () => {
    expect(NOTICE_PARAMS).not.toContain("f");
  });
});

describe("DECISION_NOTICES", () => {
  it.each([
    { shop: "natura", text: "Zapisano: brak w Naturze." },
    { shop: "hebe", text: "Zapisano: brak w Hebe." },
  ] as const)("names the shop the user declined, after w: $text", ({ shop, text }) => {
    expect(DECISION_NOTICES.declined(shop)).toBe(text);
  });
});

describe("a removal's parameters", () => {
  it("differ, so the list's notice and the product page's error never read each other's code", () => {
    expect(REMOVED_PARAM).not.toBe(REMOVAL_PARAM);
  });
});

describe("SIGN_IN_NOTICE_PARAMS, which the sign-in page's address bar forgets", () => {
  it("holds a refused sign-in's error and a sign-out's notice", () => {
    expect(SIGN_IN_NOTICE_PARAMS).toHaveLength(2);
    expect(SIGN_IN_NOTICE_PARAMS).toEqual(expect.arrayContaining([ERROR_PARAM, SIGNED_OUT_PARAM]));
  });

  it("keeps the page a sign-in goes back to, for the next try", () => {
    expect(SIGN_IN_NOTICE_PARAMS).not.toContain("next");
  });
});

describe("a sign-out's parameters", () => {
  it("differ, so the sign-in page's notice and the list's error never read each other's", () => {
    expect(SIGNED_OUT_PARAM).not.toBe(SIGN_OUT_PARAM);
    expect(LIST_NOTICE_PARAMS).not.toContain(SIGNED_OUT_PARAM);
    expect(SIGN_IN_NOTICE_PARAMS).not.toContain(SIGN_OUT_PARAM);
  });
});

describe("SET_PASSWORD_NOTICE_PARAMS, which the set-password page's address bar forgets", () => {
  it("holds a refused password's error alone", () => {
    expect(SET_PASSWORD_NOTICE_PARAMS).toEqual([ERROR_PARAM]);
  });
});

describe("a saved password's parameter", () => {
  it("is the list's alone, so no other page reads it and no other notice's parameter is it", () => {
    expect(NOTICE_PARAMS).not.toContain(PASSWORD_SET_PARAM);
    expect(SIGN_IN_NOTICE_PARAMS).not.toContain(PASSWORD_SET_PARAM);
    expect(SET_PASSWORD_NOTICE_PARAMS).not.toContain(PASSWORD_SET_PARAM);
    expect(LIST_NOTICE_PARAMS.filter((param) => param === PASSWORD_SET_PARAM)).toHaveLength(1);
  });
});

describe("confirmErrorMessage, the confirm page's text for a handed-over link that didn't sign anyone in", () => {
  it.each([
    { code: "expired", text: "Link wygasł albo został już użyty. Poproś o nowy." },
    { code: "invalid", text: "Ten link jest nieprawidłowy. Poproś o nowy." },
    { code: "busy", text: "Zbyt wiele prób. Spróbuj za kilka minut." },
    { code: "failed", text: "Nie udało się sprawdzić linku. Otwórz go jeszcze raz." },
    { code: "config", text: "Supabase nie jest skonfigurowany." },
  ])("says $text for $code", ({ code, text }) => {
    expect(confirmErrorMessage(code)).toBe(text);
  });

  it("has a text for every code the route sends", () => {
    for (const code of CONFIRM_ERROR_CODES) {
      expect(confirmErrorMessage(code)).toBe(CONFIRM_ERRORS[code]);
    }
  });

  it.each([
    null,
    "",
    "EXPIRED",
    "expired ",
    "Email link is invalid or has expired",
    "weak",
    "toString",
    "__proto__",
    "constructor",
  ])("says nothing for %j, which the route never sends", (value) => {
    expect(confirmErrorMessage(value)).toBeNull();
  });
});

describe("passwordErrorMessage, the set-password page's text for a password that wasn't saved", () => {
  it.each([
    { code: "invalid", text: "Hasło musi mieć od 8 do 72 znaków." },
    { code: "weak", text: "Hasło jest za słabe." },
    { code: "same", text: "To hasło jest już ustawione." },
    { code: "busy", text: "Zbyt wiele prób. Spróbuj za kilka minut." },
    { code: "failed", text: "Nie udało się zapisać hasła. Spróbuj ponownie." },
    { code: "config", text: "Supabase nie jest skonfigurowany." },
  ])("says $text for $code", ({ code, text }) => {
    expect(passwordErrorMessage(code)).toBe(text);
  });

  it("has a text for every code the route sends", () => {
    for (const code of PASSWORD_ERROR_CODES) {
      expect(passwordErrorMessage(code)).toBe(PASSWORD_ERRORS[code]);
    }
  });

  it.each([
    null,
    "",
    "WEAK",
    "weak ",
    "Password is known to be weak",
    "expired",
    "toString",
    "__proto__",
    "constructor",
  ])("says nothing for %j, which the route never sends", (value) => {
    expect(passwordErrorMessage(value)).toBeNull();
  });
});

describe("the auth pages' shared texts", () => {
  it("say too many tries and no Supabase alike on each page", () => {
    for (const errors of [CONFIRM_ERRORS, PASSWORD_ERRORS]) {
      expect(errors.busy).toBe(SIGN_IN_ERRORS.busy);
      expect(errors.config).toBe(SIGN_IN_ERRORS.config);
    }
  });
});

describe("signInErrorMessage, the sign-in page's text for a refused sign-in", () => {
  it.each([
    { code: "invalid", text: "Nieprawidłowy e-mail lub hasło." },
    { code: "busy", text: "Zbyt wiele prób. Spróbuj za kilka minut." },
    { code: "failed", text: "Nie udało się zalogować. Spróbuj ponownie." },
    { code: "config", text: "Supabase nie jest skonfigurowany." },
  ])("says $text for $code", ({ code, text }) => {
    expect(signInErrorMessage(code)).toBe(text);
  });

  it("has a text for every code the route sends", () => {
    for (const code of SIGN_IN_ERROR_CODES) {
      expect(signInErrorMessage(code)).toBe(SIGN_IN_ERRORS[code]);
    }
  });

  it.each([null, "", "INVALID", "invalid ", "Invalid login credentials", "toString", "__proto__", "constructor"])(
    "says nothing for %j, which the route never sends",
    (value) => {
      expect(signInErrorMessage(value)).toBeNull();
    },
  );
});

describe("signOutErrorMessage, the list's text for a failed sign-out", () => {
  it("says the sign-out failed for each code the route sends", () => {
    for (const code of SIGN_OUT_CODES) {
      expect(signOutErrorMessage(code)).toBe(SIGN_OUT_NOTICES[code]);
    }
    expect(signOutErrorMessage("failed")).toBe("Nie udało się wylogować. Spróbuj ponownie.");
  });

  it.each([null, "", "1", "done", "FAILED", "toString", "__proto__"])(
    "says nothing for %j, which the route never sends",
    (value) => {
      expect(signOutErrorMessage(value)).toBeNull();
    },
  );
});

describe("withoutNotices, which both pages' address-bar scripts forget their notices through", () => {
  const BASE = "https://drogeria.example";

  it("drops every notice parameter it names and keeps the filter, the search and the hash", () => {
    expect(withoutNotices(`${BASE}/watchlist?f=check&q=nivea&removed=done&exists=1#top`, LIST_NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist?f=check&q=nivea#top`,
    );
    expect(withoutNotices(`${BASE}/watchlist/x?f=promo&matched=1&removal=failed#remove`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=promo#remove`,
    );
    expect(withoutNotices(`${BASE}/watchlist/x?f=check&shop=natura&declined=1`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=check`,
    );
  });

  it("gives null for an address without any of them, which has nothing to forget", () => {
    expect(withoutNotices(`${BASE}/watchlist?f=check&q=nivea`, LIST_NOTICE_PARAMS)).toBeNull();
    expect(withoutNotices(`${BASE}/watchlist/x?f=check`, NOTICE_PARAMS)).toBeNull();
  });

  it("drops a re-pin's parameter and keeps the filter, so going back to its choice asks the shop nothing", () => {
    expect(withoutNotices(`${BASE}/watchlist/x?f=check&repin=natura`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=check`,
    );
  });

  it("drops a retry's parameter and keeps the filter, so going back to its lookup or reloading it asks the shop nothing", () => {
    // The tap on the button of a shop looked up on request, which usually opens a choice and stores nothing.
    expect(withoutNotices(`${BASE}/watchlist/x?f=check&retry=super-pharm`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=check`,
    );
    // "Szukaj ponownie" over a stored "not found".
    expect(withoutNotices(`${BASE}/watchlist/x?retry=natura&f=promo`, NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist/x?f=promo`,
    );
  });

  it("drops a parameter it names even when the address holds it more than once", () => {
    expect(withoutNotices(`${BASE}/watchlist?removed=done&removed=gone`, LIST_NOTICE_PARAMS)).toBe(`${BASE}/watchlist`);
  });

  it("drops a failed sign-out's error from the list and keeps its filter", () => {
    expect(withoutNotices(`${BASE}/watchlist?f=check&sign-out=failed`, LIST_NOTICE_PARAMS)).toBe(
      `${BASE}/watchlist?f=check`,
    );
  });

  it("drops a saved password's notice from the list", () => {
    expect(withoutNotices(`${BASE}/watchlist?password-set=1`, LIST_NOTICE_PARAMS)).toBe(`${BASE}/watchlist`);
  });

  it("drops the set-password page's error, so a reload shows the plain form", () => {
    expect(withoutNotices(`${BASE}/auth/set-password?error=weak`, SET_PASSWORD_NOTICE_PARAMS)).toBe(
      `${BASE}/auth/set-password`,
    );
    expect(withoutNotices(`${BASE}/auth/set-password`, SET_PASSWORD_NOTICE_PARAMS)).toBeNull();
  });

  it("drops the sign-in page's error and notice, and keeps the page a sign-in goes back to", () => {
    expect(
      withoutNotices(`${BASE}/auth/signin?error=invalid&next=%2Fwatchlist%3Ff%3Dcheck`, SIGN_IN_NOTICE_PARAMS),
    ).toBe(`${BASE}/auth/signin?next=%2Fwatchlist%3Ff%3Dcheck`);
    expect(withoutNotices(`${BASE}/auth/signin?signed-out=1`, SIGN_IN_NOTICE_PARAMS)).toBe(`${BASE}/auth/signin`);
    expect(withoutNotices(`${BASE}/auth/signin?next=%2Fwatchlist`, SIGN_IN_NOTICE_PARAMS)).toBeNull();
  });
});
