#!/usr/bin/env node
// PostToolUse hook (Write|Edit): lint the one file the agent just edited, without --fix, so the file stays as the
// agent wrote it and its next Edit doesn't fail on "modified since read".
//
// The file is linted in the checkout that holds it, with that checkout's ESLint and config, so an edit in a sibling
// git worktree is checked there, and the checkout is registered for the end-of-turn sweep (session-checkouts.mjs).
// A file of another repository (~/.claude, another project) is skipped.
//
// Claude Code shows Claude a PostToolUse hook's stderr only when the hook exits 2, so every finding goes there, and so
// does a lint that couldn't run: an ESLint the checkout doesn't have, or one that fails to start, crashes or doesn't
// finish. It exits 0 silently only when there's nothing to check: no path in the payload, a file that no longer
// exists, a file outside this repository, or a file type ESLint doesn't lint.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { checkoutOf, register, samePath } from "./session-checkouts.mjs";

// What eslint.config.js lints: ESLint's own .js/.mjs/.cjs, React's .jsx/.tsx, typescript-eslint's .ts/.mts/.cts and
// eslint-plugin-astro's .astro. Its ignores (.gitignore, .claude/, handoffs) are left to ESLint (--no-warn-ignored).
const LINTED = /\.(?:[cm]?[jt]s|[jt]sx|astro)$/i;
const MAX_MESSAGES = 40;
const TIMEOUT_MS = 25_000; // the hook's own timeout is 30 s

const { code, message } = main(readPayload());
if (message) process.stderr.write(message, () => process.exit(code));
else process.exit(code);

function main(payload) {
  const given = [
    payload.tool_input?.file_path,
    payload.tool_input?.notebook_path,
    payload.tool_input?.path,
    payload.tool_response?.filePath,
  ].find((value) => typeof value === "string" && value.trim() !== "");
  if (!given) return { code: 0 };

  // Write and Edit send an absolute path, with backslashes on Windows; a relative one is read from the session's cwd.
  const cwd = typeof payload.cwd === "string" && payload.cwd.trim() !== "" ? payload.cwd : process.cwd();
  const file = realFile(path.resolve(cwd, given));
  if (!file) return { code: 0 };

  const checkout = checkoutOf(path.dirname(file));
  const session = checkoutOf(cwd);
  if (!checkout || !session || !samePath(checkout.repository, session.repository)) return { code: 0 };
  register(payload.session_id, checkout.root);
  if (!LINTED.test(file)) return { code: 0 };

  const relative = path.relative(checkout.root, file).split(path.sep).join("/");
  // The same relative path exists in every checkout, so a file in another one is named in full.
  const shown = samePath(checkout.root, session.root) ? relative : file.split(path.sep).join("/");

  const eslint = binOf(checkout.root, "eslint");
  if (!eslint) {
    return {
      code: 2,
      message: `ESLint isn't installed in ${checkout.root} (no node_modules/eslint), so ${shown} wasn't linted. Run \`npm ci\` in that checkout.\n`,
    };
  }
  const run = spawnSync(process.execPath, [eslint, "--quiet", "--no-warn-ignored", "--format", "json", file], {
    cwd: checkout.root,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (run.error?.code === "ETIMEDOUT" || (!run.error && run.status === null)) {
    return {
      code: 2,
      message: `ESLint didn't finish linting ${shown} within ${TIMEOUT_MS / 1000} s, so it's unchecked until the end-of-turn sweep lints it again.\n`,
    };
  }
  if (run.error) return { code: 2, message: `ESLint could not run on ${shown}: ${run.error.message}\n` };
  if (run.status === 0) return { code: 0 };

  const errors = errorsOf(run.stdout);
  if (errors === null) {
    // ESLint itself failed: a broken config or a crash, which the edit may have caused (eslint.config.js, say).
    return { code: 2, message: `ESLint could not lint ${shown}:\n${clean(run.stdout + run.stderr)}\n` };
  }
  if (errors.length === 0) return { code: 0 };

  const lines = errors
    .slice(0, MAX_MESSAGES)
    .map((m) => `  ${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "parse error"})`);
  if (errors.length > MAX_MESSAGES) lines.push(`  … and ${errors.length - MAX_MESSAGES} more`);
  if (errors.some((m) => m.ruleId === "prettier/prettier")) {
    lines.push(`prettier/prettier is formatting only: \`npx prettier --write "${shown}"\` fixes it.`);
  }
  return { code: 2, message: `ESLint: ${errors.length} error(s) in ${shown} (the hook doesn't --fix):\n${lines.join("\n")}\n` };
}

function readPayload() {
  if (process.stdin.isTTY) return {};
  try {
    const value = JSON.parse(readFileSync(0, "utf8"));
    return value !== null && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// The file's real path, which compares with the checkout's, or null when it isn't a file (anymore).
function realFile(target) {
  try {
    return statSync(target).isFile() ? realpathSync.native(target) : null;
  } catch {
    return null;
  }
}

// The package's own bin script in that checkout, run with this Node: no npx resolution and no shell, the same on
// Windows.
function binOf(root, name) {
  try {
    const directory = path.join(root, "node_modules", name);
    const { bin } = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    const script = typeof bin === "string" ? bin : bin?.[name];
    return script ? path.join(directory, script) : null;
  } catch {
    return null;
  }
}

// ESLint's JSON report as a flat list of errors, or null when the output isn't a report (ESLint failed to run).
function errorsOf(stdout) {
  try {
    return JSON.parse(stdout).flatMap((result) => result.messages.filter((m) => m.severity === 2));
  } catch {
    return null;
  }
}

// Colour codes a tool printed anyway, and Windows line ends: the reader is a model, not a terminal.
function clean(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}
