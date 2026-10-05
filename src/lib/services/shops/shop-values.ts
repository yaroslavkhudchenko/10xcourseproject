// Shared by the shop adapters, so every shop reads the values of its answers the same way: one value at a time, an odd
// one costing only itself.

/**
 * An attribute's values: a list as it comes, any other value as a list of that one. Luigi's Box sends most attributes
 * as a list and a few (such as `title`) as a single value.
 */
export function valuesOf(attribute: unknown): unknown[] {
  return Array.isArray(attribute) ? attribute : [attribute];
}

/** An attribute's first value as trimmed text, or null when it isn't text or is empty. */
export function textOf(attribute: unknown): string | null {
  const [value] = valuesOf(attribute);
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

/** Keeps text within its limit, or drops it: a cut-off size or URL would be wrong, not just shorter. */
export function within(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

/** The host of an https URL, or null for any other URL and for text that isn't one. */
export function httpsHost(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" ? hostname : null;
  } catch {
    return null;
  }
}
