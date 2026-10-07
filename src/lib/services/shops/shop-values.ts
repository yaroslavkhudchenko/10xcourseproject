// Shared by the shop adapters, so every shop reads the values of its answers the same way: one value at a time, an odd
// one costing only itself.

/**
 * An attribute's values: a list as it comes, any other value as a list of that one. Luigi's Box sends most attributes
 * as a list and a few (such as `title`) as a single value.
 */
export function valuesOf(attribute: unknown): unknown[] {
  return Array.isArray(attribute) ? attribute : [attribute];
}

/**
 * True for a value that stands for none: a field left out, `null`, `false`, as Super-Pharm sends a price text it
 * doesn't have, or text that's empty once trimmed, as Super-Pharm's search extension writes an unset date. An optional
 * value that's none is normal; one that's there but can't be read is counted in a log line.
 */
export function isNone(value: unknown): boolean {
  return value === undefined || value === null || value === false || (typeof value === "string" && value.trim() === "");
}

/** What a field held, for a log line that mustn't quote the answer: "missing", "null", "array" or its type. */
export function kindOf(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
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
