/**
 * Sets headers on a response. Some responses, such as `Response.redirect()` or one passed through from `fetch()`, have
 * read-only headers; those are copied into a new response first, so setting a header never throws.
 */
export function withHeaders(response: Response, headers: Headers): Response {
  try {
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
    return response;
  } catch {
    const copy = new Response(response.body, response);
    headers.forEach((value, key) => {
      copy.headers.set(key, value);
    });
    return copy;
  }
}
