#!/usr/bin/env node
// Stop hook: before the agent finishes a turn, check the uncommitted code once, in the session's checkout and in every
// checkout an edit reached this session, a sibling git worktree say (session-checkouts.mjs):
//   - ESLint on every changed or new code file, which also catches files rewritten through a shell command, since
//     those never reach the per-edit hook;
//   - the whole Vitest suite, which runs in seconds, so a red test in a module the turn only imported shows up too;
//   - `astro check --noSync`, the typecheck CI runs, .astro files included.
// Each checkout runs its own installed tools, in parallel with the other checkouts. It reports every failure in one
// message on stderr and exits 2, which keeps the agent working, and a check that couldn't run counts as a failure: a
// checkout without node_modules, a tool it doesn't have, one that fails to start or doesn't finish. With
// stop_hook_active set, it has already sent the agent back once this turn, so it lets it finish and leaves the rest
// to the commit gate.
//
// Plain `astro check` runs `astro sync` first, which rewrites node_modules/.vite/deps_ssr: a running dev server then
// answers 500 on every page until it restarts. So the sync runs only when the generated types are missing, or when
// the Astro or content config changed while no dev server runs (a running one regenerates them itself).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkoutOf, registered, samePath } from "./session-checkouts.mjs";

const VERSION = 2; // part of the "already passed" key: bump it when the checks change
// What eslint.config.js lints; see lint-edited-file.mjs.
const LINTED = /\.(?:[cm]?[jt]s|[jt]sx|astro)$/i;
// What lint, the tests or the types can depend on: code, plus JSON such as package.json, tsconfig.json and fixtures.
const RELEVANT = /\.(?:[cm]?[jt]s|[jt]sx|astro|json)$/i;
// New untracked files count only in the root and these folders, so a stray folder (a downloaded design handoff, say)
// can't fail every turn. Changed tracked files count wherever they are.
const UNTRACKED_ROOTS = ["src/", "scripts/", "tests/", "supabase/"];
const SYNC_TRIGGERS = /^(?:astro\.config\.[cm]?[jt]s|src\/content\.config\.[cm]?[jt]s|src\/content\/config\.[cm]?[jt]s)$/;
const TIMEOUT_MS = 100_000; // the hook's own timeout is 120 s
const MAX_LINES = 120;
const ENV = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" };

const { code, message, summary, notice } = await main(readPayload());
// On exit 0 Claude Code reads stdout as JSON when it parses, so a notice reaches the user (not Claude), and a plain
// summary only the debug log. Each stream is flushed before the exit.
const line = notice ? JSON.stringify({ systemMessage: notice }) : summary ? `end-of-turn: ${summary}` : "";
process.stdout.write(line ? `${line}\n` : "", () => {
  if (message) process.stderr.write(message, () => process.exit(code));
  else process.exit(code);
});

async function main(payload) {
  // Cursor, which imports .claude/settings.json hooks, counts its retries in loop_count instead.
  if (payload.stop_hook_active === true || payload.stop_hook_active === "true" || Number(payload.loop_count) > 0) {
    return { code: 0, summary: "already sent back once this turn" };
  }

  // The session's checkout comes from the payload's cwd, never from $CLAUDE_PROJECT_DIR, which names the checkout
  // the session started in. Registered checkouts count while they're still checkouts of the session's repository.
  const cwd = typeof payload.cwd === "string" && payload.cwd.trim() !== "" ? payload.cwd : process.cwd();
  const session = checkoutOf(cwd);
  const roots = session ? [session.root] : [];
  for (const root of registered(payload.session_id)) {
    const checkout = checkoutOf(root);
    if (!checkout || !samePath(checkout.root, root) || roots.some((known) => samePath(known, checkout.root))) continue;
    if (session && !samePath(checkout.repository, session.repository)) continue;
    roots.push(checkout.root);
  }
  if (roots.length === 0) return { code: 0, notice: `end-of-turn: no git checkout at ${cwd}, so nothing was checked.` };

  const results = await Promise.all(roots.map((root) => checkCheckout(root)));
  // Paths in a report are relative to their checkout, so a report from any checkout but the session's own names it.
  const named = roots.length > 1 || !session;
  const summary = results
    .map((result, i) => (named ? `${path.basename(roots[i])}: ${result.summary}` : result.summary))
    .join("; ");
  const blocks = results.flatMap(({ sections }, i) => {
    if (sections.length === 0) return [];
    return [named ? `In ${roots[i]}:\n\n${sections.join("\n\n")}` : sections.join("\n\n")];
  });
  if (blocks.length === 0) return { code: 0, summary };
  return { code: 2, message: `Fix these before you finish:\n\n${blocks.join("\n\n")}\n`, summary };
}

// One checkout's checks: { sections: the report's failures, summary: one line for the debug log }.
async function checkCheckout(root) {
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head === null) return { sections: [], summary: "no commit to compare with" };

  const tracked = gitPaths(root, ["diff", "--name-only", "-z", "HEAD"]);
  const untracked = gitPaths(root, ["ls-files", "-o", "--exclude-standard", "-z"]).filter(
    (p) => !p.includes("/") || UNTRACKED_ROOTS.some((folder) => p.startsWith(folder)),
  );
  const changed = [...new Set([...tracked, ...untracked])].filter((p) => RELEVANT.test(p)).sort();
  if (changed.length === 0) return { sections: [], summary: "no code changed" };

  // The same uncommitted code on the same commit already passed: a question asked mid-change costs nothing.
  const present = changed.filter((p) => isFile(path.join(root, p)));
  const fingerprints = changed.map((p) => `${p}\0${present.includes(p) ? sha256(readFileSync(path.join(root, p))) : "deleted"}`);
  const key = sha256([VERSION, head, ...fingerprints].join("\n"));
  const passed = path.join(root, "node_modules", ".cache", "claude-hooks", "end-of-turn-passed");
  if (readText(passed) === key) return { sections: [], summary: `${changed.length} changed file(s) already passed` };

  if (!isDirectory(path.join(root, "node_modules"))) {
    const reason = "this checkout has no node_modules, so ESLint, Vitest and astro check can't run. Run `npm ci` in it.";
    return { sections: [`Nothing was checked: ${reason}`], summary: "no node_modules" };
  }

  const lintFiles = present.filter((p) => LINTED.test(p)).map((p) => path.join(root, p));
  const needsSync =
    !isFile(path.join(root, ".astro", "types.d.ts")) ||
    (changed.some((p) => SYNC_TRIGGERS.test(p)) && !devServerRunning(root));

  const started = Date.now();
  const [lint, tests, types] = await Promise.all([
    lintFiles.length > 0 ? lintAll(root, lintFiles) : null,
    runTool(root, "vitest", ["run"]),
    typecheck(root, needsSync),
  ]);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const sections = [];
  if (lint) sections.push(lint);
  if (tests.failed) {
    const title = tests.missing ? "Unit tests didn't run:" : "Unit tests fail (npx vitest run):";
    sections.push(section(title, tests.output));
  }
  if (types.failed) {
    const title = types.missing ? "Typecheck didn't run:" : `Typecheck fails (${types.command}):`;
    sections.push(section(title, types.output));
  }
  if (sections.length > 0) return { sections, summary: `${sections.length} check(s) failed in ${seconds} s` };
  writeText(root, passed, key);
  return {
    sections,
    summary: `${changed.length} changed file(s), ${lintFiles.length} linted, tests and ${types.command} passed in ${seconds} s`,
  };
}

async function typecheck(root, needsSync) {
  if (needsSync) {
    const sync = await runTool(root, "astro", ["sync"]);
    if (sync.failed) return { ...sync, command: "npx astro sync" };
  }
  const check = await runTool(root, "astro", ["check", "--noSync", "--minimumSeverity", "error"]);
  return { ...check, command: needsSync ? "npx astro sync, then npx astro check --noSync" : "npx astro check --noSync" };
}

// ESLint on the changed files, in batches that keep each command line well under Windows' 32 767 characters.
// Returns the report section, or null when every file is clean.
async function lintAll(root, files) {
  const errors = [];
  const crashes = [];
  for (const batch of batches(files, 20_000)) {
    const run = await runTool(root, "eslint", ["--quiet", "--no-warn-ignored", "--format", "json", ...batch]);
    if (!run.failed) continue;
    const found = errorsOf(run.stdout);
    if (found === null) crashes.push(run.output);
    else errors.push(...found);
  }
  const parts = [];
  if (errors.length > 0) {
    const lines = [];
    for (const { file, messages } of errors) {
      lines.push(`${display(root, file)}:`);
      for (const m of messages) lines.push(`  ${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "parse error"})`);
    }
    if (errors.some(({ messages }) => messages.some((m) => m.ruleId === "prettier/prettier"))) {
      lines.push('prettier/prettier is formatting only: `npx prettier --write "<file>"` fixes it.');
    }
    parts.push(section("ESLint errors in changed files:", lines.join("\n")));
  }
  for (const output of crashes) parts.push(section("ESLint could not run:", output));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// A package's own bin script in the checkout, run with this Node (no npx, no shell). A tool the checkout doesn't have,
// or one that can't start, fails with `missing` set, since a check that didn't run hasn't passed.
function runTool(root, name, args) {
  const bin = binOf(root, name);
  if (!bin) {
    const output = `${name} isn't installed in this checkout (no node_modules/${name}): run \`npm ci\` in it.`;
    return Promise.resolve({ failed: true, missing: true, stdout: "", output });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root, env: ENV, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\n(stopped after ${TIMEOUT_MS / 1000} s)`;
    }, TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ failed: true, missing: true, stdout: "", output: `${name} could not start: ${String(error)}` });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ failed: exitCode !== 0, stdout, output: `${stdout}\n${stderr}` });
    });
  });
}

function devServerRunning(root) {
  try {
    const { pid } = JSON.parse(readFileSync(path.join(root, ".astro", "dev.json"), "utf8"));
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // it exists, but belongs to another user
  }
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

function git(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return run.status === 0 ? run.stdout.trim() : null;
}

function gitPaths(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return run.status === 0 ? run.stdout.split("\0").filter(Boolean) : [];
}

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

// ESLint's JSON report as [{file, messages}] with errors only, or null when the output isn't a report.
function errorsOf(stdout) {
  try {
    return JSON.parse(stdout)
      .map((result) => ({ file: result.filePath, messages: result.messages.filter((m) => m.severity === 2) }))
      .filter(({ messages }) => messages.length > 0);
  } catch {
    return null;
  }
}

function batches(files, maxChars) {
  const result = [[]];
  let length = 0;
  for (const file of files) {
    if (length + file.length > maxChars && result.at(-1).length > 0) {
      result.push([]);
      length = 0;
    }
    result.at(-1).push(file);
    length += file.length + 1;
  }
  return result;
}

function section(title, text) {
  const lines = clean(text).split("\n");
  const shown = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines`] : lines;
  return `${title}\n${shown.join("\n")}`;
}

// Colour codes a tool printed anyway, and Windows line ends: the reader is a model, not a terminal.
function clean(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function display(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Only into the checkout's installed node_modules: without one, nothing ran, and the next turn just checks again.
function writeText(root, file, text) {
  try {
    if (!isDirectory(path.join(root, "node_modules"))) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch {
    // Without the cache the next turn checks again.
  }
}
