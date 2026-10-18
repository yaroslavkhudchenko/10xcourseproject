// What the reviewer reads of a pull request's diff: every file's section except those under the paths the owner chose
// to leave out, which are mostly documents, recorded answers and lockfiles, and only up to MAX_REVIEW_BYTES. A section
// whose path can't be read is kept, so a parsing gap can make a review longer but never hides code from it.
import { Buffer } from "node:buffer";

/**
 * The paths the review leaves out: an entry ending in "/" is a folder at the repository's root, and any other is a
 * file name, left out wherever it is.
 */
export const EXCLUDED_PATHS = [
  ".claude/",
  "context/",
  "src/lib/services/shops/fixtures/",
  ".github/actions/ai-reviewer/eval/fixtures/",
  "package-lock.json",
] as const;

/**
 * The most one review sends of the diff it keeps, in UTF-8 bytes, about 280k tokens: room to spare above the largest
 * filtered diff of the repository's first 56 pull requests, 724 KB (research §5).
 */
export const MAX_REVIEW_BYTES = 1_000_000;

export interface ExcludedPath {
  path: string;
  /** The UTF-8 bytes of the file's section of the diff. */
  bytes: number;
}

export interface FilteredDiff {
  /** The sections the review reads, each byte for byte as the diff has it, in the diff's order. */
  kept: string;
  /** The files left out, in the diff's order. */
  excluded: ExcludedPath[];
  /** The UTF-8 bytes of `kept`. */
  keptBytes: number;
}

/** A verdict the filtered diff gives without asking a model. */
export type Skip =
  | { verdict: "pass"; summary: string; skipped: "nothing-to-review" }
  | { verdict: "fail"; summary: string; skipped: "too-large" };

const HEADER = "diff --git ";
const DEV_NULL = "/dev/null";

/**
 * Splits a unified diff, as `git diff` writes it, at its `diff --git` headers and leaves out each file whose path falls
 * under EXCLUDED_PATHS. A file's path is its new one: the `+++ b/…` line's, the `--- a/…` line's for a deletion, the
 * `rename to` or `copy to` line's for a move without changes, and the header's for a binary or mode-only change. Text
 * before the first header, which `git diff` doesn't write, is kept.
 */
export function filterDiff(diff: string): FilteredDiff {
  const starts = sectionStarts(diff);
  const kept = [diff.slice(0, starts[0] ?? diff.length)];
  const excluded: ExcludedPath[] = [];
  starts.forEach((start, index) => {
    const section = diff.slice(start, starts[index + 1] ?? diff.length);
    const path = pathOf(section);
    if (path !== null && isExcluded(path)) excluded.push({ path, bytes: Buffer.byteLength(section) });
    else kept.push(section);
  });
  const keptText = kept.join("");
  return { kept: keptText, excluded, keptBytes: Buffer.byteLength(keptText) };
}

/**
 * The verdict a filtered diff gives on its own: a pass when nothing is left to review, and a fail when what's left is
 * over MAX_REVIEW_BYTES, which is never sent. Null when the model is to review it.
 */
export function skipOf({ kept, excluded, keptBytes }: FilteredDiff): Skip | null {
  if (kept.trim() === "") {
    const leftOut = EXCLUDED_PATHS.map((path) => `\`${path}\``).join(", ");
    const summary =
      excluded.length === 0
        ? "Nothing to review: the diff is empty."
        : `Nothing to review: this pull request changes only paths the AI review leaves out (${leftOut}).`;
    return { verdict: "pass", summary, skipped: "nothing-to-review" };
  }
  if (keptBytes > MAX_REVIEW_BYTES) {
    const size = new Intl.NumberFormat("en-US");
    return {
      verdict: "fail",
      summary:
        `Not reviewed: the diff left to review is ${size.format(keptBytes)} bytes, over the AI review's limit of ` +
        `${size.format(MAX_REVIEW_BYTES)} bytes. Split the pull request, or review it by hand.`,
      skipped: "too-large",
    };
  }
  return null;
}

/** Where each file's section starts: at a `diff --git` header at the start of a line. */
function sectionStarts(diff: string): number[] {
  const starts = diff.startsWith(HEADER) ? [0] : [];
  for (let at = diff.indexOf(`\n${HEADER}`); at !== -1; at = diff.indexOf(`\n${HEADER}`, at + 1)) starts.push(at + 1);
  return starts;
}

/** Whether the review leaves out the file at `path`, a path from the repository's root. */
function isExcluded(path: string): boolean {
  return EXCLUDED_PATHS.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry || path.endsWith(`/${entry}`),
  );
}

/**
 * The path of the file a section changes, from its header lines, which end at its first hunk or binary note; null when
 * they don't name one in a form git writes.
 */
function pathOf(section: string): string | null {
  const firstBreak = section.indexOf("\n");
  let oldName: string | null | undefined;
  let newName: string | null | undefined;
  let movedTo: string | null | undefined;
  for (const line of headerLines(section, firstBreak)) {
    if (line.startsWith("--- ")) oldName = nameField(line.slice(4));
    else if (line.startsWith("+++ ")) newName = nameField(line.slice(4));
    else if (line.startsWith("rename to ")) movedTo = plainOrQuoted(line.slice("rename to ".length));
    else if (line.startsWith("copy to ")) movedTo = plainOrQuoted(line.slice("copy to ".length));
  }
  if (newName !== undefined) {
    return newName === DEV_NULL ? withoutPrefix(oldName ?? null, "a/") : withoutPrefix(newName, "b/");
  }
  if (movedTo !== undefined) return movedTo;
  return headerName(withoutCarriageReturn(firstBreak === -1 ? section : section.slice(0, firstBreak)));
}

/** The section's lines after its `diff --git` line, up to its first hunk or binary note, without a CR before the LF. */
function* headerLines(section: string, firstBreak: number): Generator<string> {
  for (let at = firstBreak + 1; at > 0 && at < section.length;) {
    const end = section.indexOf("\n", at);
    const line = withoutCarriageReturn(section.slice(at, end === -1 ? undefined : end));
    if (line.startsWith("@@") || line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) return;
    yield line;
    if (end === -1) return;
    at = end + 1;
  }
}

/**
 * The name in a `---` or `+++` line, with its `a/` or `b/` prefix, or /dev/null. Git quotes a name with special
 * characters, and ends an unquoted name that holds a space with a tab, which isn't part of it.
 */
function nameField(field: string): string | null {
  if (field.startsWith('"')) return unquote(field)?.value ?? null;
  const tab = field.indexOf("\t");
  return tab === -1 ? field : field.slice(0, tab);
}

/** A name as a `rename to` or `copy to` line writes it: as it is, or quoted. */
function plainOrQuoted(text: string): string | null {
  return text.startsWith('"') ? (unquote(text)?.value ?? null) : text;
}

/**
 * The new name in a `diff --git a/<old> b/<new>` header, without its `b/`. Each name is quoted when it needs to be,
 * while two unquoted names, which may hold spaces, can be told apart only when they're the same, as git writes them for
 * a change that has no `---`, `+++` or `rename to` line.
 */
function headerName(header: string): string | null {
  const names = header.slice(HEADER.length);
  if (names.startsWith('"')) {
    const old = unquote(names);
    return old !== null && names[old.end] === " " ? withoutPrefix(plainOrQuoted(names.slice(old.end + 1)), "b/") : null;
  }
  const quoted = names.indexOf(' "');
  if (quoted !== -1) return withoutPrefix(plainOrQuoted(names.slice(quoted + 1)), "b/");
  const half = (names.length - 1) / 2;
  if (!Number.isInteger(half) || names[half] !== " ") return null;
  const [oldName, newName] = [names.slice(0, half), names.slice(half + 1)];
  return oldName.startsWith("a/") && newName.startsWith("b/") && oldName.slice(2) === newName.slice(2)
    ? newName.slice(2)
    : null;
}

function withoutPrefix(name: string | null, prefix: "a/" | "b/"): string | null {
  return name?.startsWith(prefix) ? name.slice(prefix.length) : null;
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// The escapes git's C-style quoting writes, besides a byte's three octal digits.
const ESCAPED_BYTES = new Map([
  ["a", 7],
  ["b", 8],
  ["t", 9],
  ["n", 10],
  ["v", 11],
  ["f", 12],
  ["r", 13],
  ['"', 34],
  ["\\", 92],
]);

/**
 * A name git quoted C-style at the start of `text`, such as `"b/caf\303\251.ts"`: its value, read as UTF-8, and the
 * index just past its closing quote. Null when `text` doesn't start with a well-formed quoted name.
 */
function unquote(text: string): { value: string; end: number } | null {
  if (!text.startsWith('"')) return null;
  const bytes: number[] = [];
  for (let at = 1; at < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(at) ?? 0);
    if (char === '"') return { value: Buffer.from(bytes).toString("utf8"), end: at + 1 };
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      at += char.length;
      continue;
    }
    const octal = /^[0-3][0-7]{2}/.exec(text.slice(at + 1, at + 4));
    const escaped = ESCAPED_BYTES.get(text.charAt(at + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      at += 4;
    } else if (escaped !== undefined) {
      bytes.push(escaped);
      at += 2;
    } else {
      return null;
    }
  }
  return null;
}
