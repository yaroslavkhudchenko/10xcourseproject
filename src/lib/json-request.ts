// Checks for the app's JSON API routes, which only its own pages may call. Astro's checkOrigin refuses other sites'
// posts of form types only (application/x-www-form-urlencoded, multipart/form-data, text/plain), so a JSON route
// refuses other sites itself. A page on another site can't send `Content-Type: application/json` without a CORS
// preflight, which these routes never answer, so accepting only JSON keeps its forms out too. The product page's island
// reads answers with `isJsonMediaType`, so this module imports nothing server-only.

/** True for `application/json`, with or without parameters such as `; charset=utf-8`. */
export function isJsonMediaType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

/**
 * Whether a JSON route must refuse a request before reading its body: 403 when another site sent it, as
 * `Sec-Fetch-Site: cross-site` or an `Origin` other than `ownOrigin` says, and 415 when the body isn't JSON. Null when
 * the request may go on. A request without either header, as a non-browser client sends it, is judged by its type.
 */
export function refuseJsonRequest(headers: Headers, ownOrigin: string): 403 | 415 | null {
  const origin = headers.get("Origin");
  if (headers.get("Sec-Fetch-Site") === "cross-site" || (origin !== null && origin !== ownOrigin)) {
    return 403;
  }
  return isJsonMediaType(headers.get("Content-Type")) ? null : 415;
}
