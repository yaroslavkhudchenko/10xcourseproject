import { z } from "astro/zod";

// Checks shared by the app's own forms, whose fields come back from its pages: "Dodaj" on the watchlist and a
// product's match decisions. Both are held to PRODUCT_LIMITS and the database checks, so they stay in one place.

/** An optional text field: trimmed, capped, and null when empty. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

/** An optional link: empty for none, otherwise within its limit and on a host the shop's adapter accepts. */
export const optionalUrl = (max: number, allowed: (url: string) => boolean) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((url) => url === "" || allowed(url))
    .transform((url) => (url === "" ? null : url));
