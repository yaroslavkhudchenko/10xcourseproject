#!/usr/bin/env node
// Stop hook: before the agent finishes a turn, check the uncommitted code once:
//   - ESLint on every changed or new code file, which also catches files rewritten through a shell command, since
//     those never reach the per-edit hook;
//   - the whole Vitest suite, which runs in seconds, so a red test in a module the turn only imported shows up too;
//   - `astro check --noSync`, the typecheck CI runs, .astro files included.
// It reports every failure in one message on stderr and exits 2, which keeps the agent working. With
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

const VERSION = 1; // part of the "already passed" key: bump it when the checks change
const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(import.meta.dirname, "..", ".."));
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
const PASSED = path.join(root, "node_modules", ".cache", "claude-hooks", "end-of-turn-passed");

const { code, message, summary } = await main(readPayload());
if (summary) console.log(`end-of-turn: ${summary}`); // stdout reaches only the debug log
if (message) process.stderr.write(message, () => process.exit(code));
else process.exit(code);

async function main(payload) {
  // Cursor, which imports .claude/settings.json hooks, counts its retries in loop_count instead.
  if (payload.stop_hook_active === true || payload.stop_hook_active === "true" || Number(payload.loop_count) > 0) {
    return { code: 0, summary: "already sent back once this turn" };
  }

  const top = git(["rev-parse", "--show-toplevel"]);
  const head = git(["rev-parse", "HEAD"]);
  if (top === null || head === null) return { code: 0, summary: "not a git checkout with a commit" };

  const tracked = gitPaths(["diff", "--name-only", "-z", "HEAD"]);
  const untracked = gitPaths(["ls-files", "-o", "--exclude-standard", "-z"]).filter(
    (p) => !p.includes("/") || UNTRACKED_ROOTS.some((folder) => p.startsWith(folder)),
  );
  const changed = [...new Set([...tracked, ...untracked])].filter((p) => RELEVANT.test(p)).sort();
  if (changed.length === 0) return { code: 0, summary: "no code changed" };

  // The same uncommitted code on the same commit already passed: a question asked mid-change costs nothing.
  const present = changed.filter((p) => isFile(path.join(top, p)));
  const fingerprints = changed.map((p) => `${p}\0${present.includes(p) ? sha256(readFileSync(path.join(top, p))) : "deleted"}`);
  const key = sha256([VERSION, head, ...fingerprints].join("\n"));
  if (readText(PASSED) === key) return { code: 0, summary: `${changed.length} changed file(s) already passed` };

  const lintFiles = present.filter((p) => LINTED.test(p)).map((p) => path.join(top, p));
  const needsSync =
    !isFile(path.join(root, ".astro", "types.d.ts")) ||
    (changed.some((p) => SYNC_TRIGGERS.test(p)) && !devServerRunning());

  const started = Date.now();
  const [lint, tests, types] = await Promise.all([
    lintFiles.length > 0 ? lintAll(lintFiles) : null,
    runTool("vitest", ["run"]),
    typecheck(needsSync),
  ]);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const sections = [];
  if (lint) sections.push(lint);
  if (tests.failed) sections.push(section("Unit tests fail (npx vitest run):", tests.output));
  if (types.failed) sections.push(section(`Typecheck fails (${types.command}):`, types.output));
  if (sections.length > 0) {
    return {
      code: 2,
      message: `Fix these before you finish:\n\n${sections.join("\n\n")}\n`,
      summary: `${sections.length} check(s) failed in ${seconds} s`,
    };
  }
  writeText(PASSED, key);
  return {
    code: 0,
    summary: `${changed.length} changed file(s), ${lintFiles.length} linted, tests and ${types.command} passed in ${seconds} s`,
  };
}

async function typecheck(needsSync) {
  if (needsSync) {
    const sync = await runTool("astro", ["sync"]);
    if (sync.failed) return { ...sync, command: "npx astro sync" };
  }
  const check = await runTool("astro", ["check", "--noSync", "--minimumSeverity", "error"]);
  return { ...check, command: needsSync ? "npx astro sync, then npx astro check --noSync" : "npx astro check --noSync" };
}

// ESLint on the changed files, in batches that keep each command line well under Windows' 32 767 characters.
// Returns the report section, or null when every file is clean.
async function lintAll(files) {
  const errors = [];
  const crashes = [];
  for (const batch of batches(files, 20_000)) {
    const run = await runTool("eslint", ["--quiet", "--no-warn-ignored", "--format", "json", ...batch]);
    if (!run.failed) continue;
    const found = errorsOf(run.stdout);
    if (found === null) crashes.push(run.output);
    else errors.push(...found);
  }
  const parts = [];
  if (errors.length > 0) {
    const lines = [];
    for (const { file, messages } of errors) {
      lines.push(`${display(file)}:`);
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

// A package's own bin script, run with this Node (no npx, no shell); a tool that isn't installed counts as passing.
function runTool(name, args) {
  const bin = binOf(name);
  if (!bin) return Promise.resolve({ failed: false, stdout: "", output: "" });
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
      resolve({ failed: false, stdout: "", output: String(error) });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ failed: exitCode !== 0, stdout, output: `${stdout}\n${stderr}` });
    });
  });
}

function devServerRunning() {
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

function git(args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  return run.status === 0 ? run.stdout.trim() : null;
}

function gitPaths(args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return run.status === 0 ? run.stdout.split("\0").filter(Boolean) : [];
}

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

function display(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isFile(target) {
  try {
    return statSync(target).isFile();
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

// Only into an installed node_modules: without one, nothing ran, and the next turn just checks again.
function writeText(file, text) {
  try {
    if (!statSync(path.join(root, "node_modules")).isDirectory()) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  } catch {
    // Without the cache the next turn checks again.
  }
}
