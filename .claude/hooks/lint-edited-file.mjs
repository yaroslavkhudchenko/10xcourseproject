#!/usr/bin/env node
// PostToolUse hook (Write|Edit): lint the one file the agent just edited, without --fix, so the file stays as the
// agent wrote it and its next Edit doesn't fail on "modified since read".
//
// Claude Code shows Claude a PostToolUse hook's stderr only when the hook exits 2, so every finding goes there. Every
// other outcome exits 0 silently: no path in the payload, a path outside the project, a file type ESLint doesn't
// lint, a file that no longer exists, or ESLint that can't run or doesn't finish.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(import.meta.dirname, "..", ".."));
// What eslint.config.js lints: ESLint's own .js/.mjs/.cjs, React's .jsx/.tsx, typescript-eslint's .ts/.mts/.cts and
// eslint-plugin-astro's .astro. Its ignores (.gitignore, .claude/, handoffs) are left to ESLint (--no-warn-ignored).
const LINTED = /\.(?:[cm]?[jt]s|[jt]sx|astro)$/i;
const MAX_MESSAGES = 40;

const { code, message } = main(readPayload());
if (message) process.stderr.write(message, () => process.exit(code));
else process.exit(code);

function main(payload) {
  const given = [payload.tool_input?.file_path, payload.tool_input?.path, payload.tool_response?.filePath].find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  if (!given) return { code: 0 };

  // Write and Edit send an absolute path, with backslashes on Windows; a relative one is read from the project root.
  const file = path.resolve(root, given);
  const relative = path.relative(root, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return { code: 0 };
  if (!LINTED.test(file) || !isFile(file)) return { code: 0 };

  const eslint = binOf("eslint");
  if (!eslint) return { code: 0 };
  const run = spawnSync(process.execPath, [eslint, "--quiet", "--no-warn-ignored", "--format", "json", file], {
    cwd: root,
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  if (run.error || run.status === null || run.status === 0) return { code: 0 };

  const shown = relative.split(path.sep).join("/");
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

function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

// The package's own bin script, run with this Node: no npx resolution and no shell, the same on Windows.
function binOf(name) {
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
