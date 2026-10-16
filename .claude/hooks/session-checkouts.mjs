// The checkouts a session's hooks check. Claude Code's $CLAUDE_PROJECT_DIR names the checkout the session started in,
// while the agent may edit a sibling git worktree, which neither that variable nor the session's cwd names. So
// lint-edited-file.mjs takes the checkout from the edited file and registers it for the session, and end-of-turn.mjs
// sweeps the session's own checkout plus every registered one.
//
// The registry is one file per session in the temp directory, a checkout per line. It isn't emptied when a sweep
// passes, so a checkout an edit once reached is swept for the rest of the session, including files rewritten there
// later through a shell command, which never reach the per-edit hook. Each checkout's "already passed" cache keeps
// that cheap.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The git checkout holding `directory`: its top-level directory and its repository, the common git directory every
 * worktree of one repository shares. Both are real paths, so a Windows short name and its long form, or a symlink and
 * its target, compare equal. Null outside a git checkout.
 * @param {string} directory
 * @returns {{ root: string, repository: string } | null}
 */
export function checkoutOf(directory) {
  const run = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel", "--git-common-dir"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status !== 0) return null;
  const [top, common] = run.stdout.split(/\r?\n/);
  if (!top || !common) return null;
  try {
    // --git-common-dir is relative to the directory asked when it's that checkout's own .git.
    return { root: realpathSync.native(top), repository: realpathSync.native(path.resolve(directory, common)) };
  } catch {
    return null;
  }
}

/** Whether two real paths name the same place; Windows compares them without case. */
export function samePath(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Adds `root` to the checkouts the session's end-of-turn sweep covers. Without a session id, or when the temp
 * directory can't be written, the sweep covers the session's own checkout only.
 * @param {unknown} sessionId
 * @param {string} root
 */
export function register(sessionId, root) {
  const registry = registryOf(sessionId);
  if (!registry || registered(sessionId).some((known) => samePath(known, root))) return;
  try {
    mkdirSync(path.dirname(registry), { recursive: true });
    appendFileSync(registry, `${root}\n`);
  } catch {
    // Best effort: the per-edit lint still ran.
  }
}

/**
 * The checkouts registered for the session, each once, in the order their first edit came.
 * @param {unknown} sessionId
 * @returns {string[]}
 */
export function registered(sessionId) {
  const registry = registryOf(sessionId);
  if (!registry) return [];
  let text;
  try {
    text = readFileSync(registry, "utf8");
  } catch {
    return [];
  }
  const roots = [];
  for (const line of text.split(/\r?\n/)) {
    if (line && !roots.some((known) => samePath(known, line))) roots.push(line);
  }
  return roots;
}

function registryOf(sessionId) {
  const id = typeof sessionId === "string" ? sessionId.replace(/[^A-Za-z0-9_-]/g, "") : "";
  return id ? path.join(os.tmpdir(), "claude-hooks", `${id}.roots`) : null;
}
