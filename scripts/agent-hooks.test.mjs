import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// The agent hooks of .claude/settings.json and .claude/hooks/, run the way Claude Code runs them: a payload on stdin,
// the verdict in the exit code, and the message on stderr, which Claude reads only on exit 2. Every case works on
// throwaway repositories in the temp directory, never on this checkout: a project with the hooks committed, three
// worktrees of it (a sibling with its own tools, one without node_modules, one with ESLint and Vitest but no Astro)
// and an unrelated repository. ESLint, Vitest and Astro are stand-ins (fixtures/agent-hooks/stand-in-tool.mjs) that
// fail on a marker and log each run, since the real tools take seconds per run; git, Node and the hooks are real.

const SOURCE = path.join(import.meta.dirname, "..", ".claude");
const STAND_IN = path.join(import.meta.dirname, "fixtures", "agent-hooks", "stand-in-tool.mjs");
const LINT = "lint-edited-file.mjs";
const STOP = "end-of-turn.mjs";
const TOOLS = ["eslint", "vitest", "astro"];
const BROKEN = "const unused = 1; // LINT_ERROR\n";
const CLEAN = "export const one = 1;\n";
const TIMEOUT = 60_000;
// Claude Code runs a hook's command with Git Bash on Windows and sh elsewhere.
const BASH = process.platform === "win32" ? gitBash() : "bash";

let base = "";
let project = ""; // the session's checkout
let sibling = ""; // a worktree of project with its own stand-ins
let bare = ""; // a worktree of project without node_modules
let partial = ""; // a worktree of project with ESLint and Vitest only
let other = ""; // another repository, with the stand-ins
let env = {};
let counter = 0;
const written = [];

beforeAll(() => {
  base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "agent-hooks-")));
  const temp = path.join(base, "tmp");
  mkdirSync(temp);
  writeFileSync(path.join(base, "gitconfig"), "");
  // git without the user's or the system's config, never looking above the test's directory, and a temp directory of
  // the test's own, which holds the hooks' session registry.
  env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && name !== "CLAUDE_PROJECT_DIR"),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(base, "gitconfig"),
    GIT_CEILING_DIRECTORIES: base,
    GIT_AUTHOR_NAME: "Hook Test",
    GIT_AUTHOR_EMAIL: "hooks@example.invalid",
    GIT_COMMITTER_NAME: "Hook Test",
    GIT_COMMITTER_EMAIL: "hooks@example.invalid",
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
  };

  project = path.join(base, "project");
  mkdirSync(path.join(project, "src"), { recursive: true });
  git(project, "init", "-q", "-b", "main");
  writeFileSync(path.join(project, ".gitignore"), "node_modules/\n.astro/\n");
  writeFileSync(path.join(project, "README.md"), "# A throwaway project for the hook tests\n");
  writeFileSync(path.join(project, "src", "math.mjs"), "export const add = (a, b) => a + b;\n");
  mkdirSync(path.join(project, ".claude"));
  cpSync(path.join(SOURCE, "settings.json"), path.join(project, ".claude", "settings.json"));
  cpSync(path.join(SOURCE, "hooks"), path.join(project, ".claude", "hooks"), { recursive: true });
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "The hooks, committed");
  install(project, TOOLS);
  sibling = worktree("project-sibling", TOOLS);
  bare = worktree("project-bare", []);
  partial = worktree("project-partial", ["eslint", "vitest"]);

  other = path.join(base, "other");
  mkdirSync(path.join(other, "src"), { recursive: true });
  git(other, "init", "-q", "-b", "main");
  writeFileSync(path.join(other, ".gitignore"), "node_modules/\n.astro/\n");
  writeFileSync(path.join(other, "src", "broken.mjs"), BROKEN);
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "Another repository");
  install(other, TOOLS);
}, TIMEOUT);

afterEach(() => {
  for (const file of written.splice(0)) rmSync(file, { force: true });
  // The "already passed" caches, so no case inherits another's green run.
  for (const root of [project, sibling, partial, other]) {
    rmSync(path.join(root, "node_modules", ".cache"), { recursive: true, force: true });
  }
});

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe("lint-edited-file.mjs, after each Write or Edit", { timeout: TIMEOUT }, () => {
  it("sends a lint error in the edited file to Claude: stderr and exit 2", () => {
    const file = write(project, "src/broken-edit.mjs", BROKEN);
    const result = hook(LINT, edit(file, session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ESLint: 1 error(s) in src/broken-edit.mjs (the hook doesn't --fix):");
    expect(result.stderr).toContain("1:7  'unused' is assigned a value but never used.  (no-unused-vars)");
  });

  it("lints a clean file and says nothing", () => {
    const file = write(project, "src/clean-edit.mjs", CLEAN);
    const result = hook(LINT, edit(file, session()));
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(ran(result)).toEqual(["eslint"]);
  });

  it("skips a file type ESLint doesn't lint", () => {
    expect(hook(LINT, edit(path.join(project, "README.md"), session()))).toMatchObject({
      status: 0,
      stderr: "",
      tools: [],
    });
  });

  it("skips a path that doesn't exist", () => {
    const file = path.join(project, "src", "never-written.mjs");
    expect(hook(LINT, edit(file, session()))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it.each([
    ["an empty payload", "{}"],
    ["text that isn't JSON", "not json"],
    ["no input at all", ""],
    ["a tool call without a path", JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: "." })],
  ])("passes %s", (_, payload) => {
    expect(hook(LINT, payload)).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("takes the path from tool_response when tool_input has none", () => {
    const file = write(project, "src/broken-response.mjs", BROKEN);
    const payload = {
      session_id: session(),
      cwd: project,
      tool_name: "Write",
      tool_input: {},
      tool_response: { filePath: file },
    };
    expect(hook(LINT, payload).status).toBe(2);
  });

  it("reads a relative path from the payload's cwd, not from the process's or the checkout's", () => {
    write(project, "src/broken-relative.mjs", BROKEN);
    const payload = {
      session_id: session(),
      cwd: path.join(project, "src"),
      tool_name: "Edit",
      tool_input: { file_path: "broken-relative.mjs" },
    };
    const result = hook(LINT, payload, { cwd: base });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("in src/broken-relative.mjs");
  });

  it("lints an edit in a sibling worktree with that worktree's ESLint, naming the file in full", () => {
    const file = write(sibling, "src/broken-sibling.mjs", BROKEN);
    const result = hook(LINT, edit(file, session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`ESLint: 1 error(s) in ${slashed(file)} (the hook doesn't --fix):`);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].endsWith(`@ ${sibling}`)).toBe(true);
  });

  it("finds the checkout from the file, not from CLAUDE_PROJECT_DIR", () => {
    // The variable names the checkout the session started in, here another repository.
    const file = write(project, "src/broken-variable.mjs", BROKEN);
    const result = hook(LINT, edit(file, session()), { env: { CLAUDE_PROJECT_DIR: other } });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("in src/broken-variable.mjs");
  });

  it("skips a file of another repository", () => {
    const file = path.join(other, "src", "broken.mjs");
    expect(hook(LINT, edit(file, session()))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("says so when the checkout has no ESLint, instead of passing", () => {
    const file = write(bare, "src/clean-bare.mjs", CLEAN);
    const result = hook(LINT, edit(file, session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`ESLint isn't installed in ${bare} (no node_modules/eslint)`);
    expect(result.stderr).toContain("Run `npm ci` in that checkout.");
  });

  it("says so when ESLint crashes", () => {
    const file = write(project, "src/crash.mjs", "// ESLINT_CRASH\n");
    const result = hook(LINT, edit(file, session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ESLint could not lint src/crash.mjs:");
    expect(result.stderr).toContain("The stand-in crashed on purpose.");
  });
});

describe("end-of-turn.mjs, before the agent finishes a turn", { timeout: TIMEOUT }, () => {
  it("lets a turn without changes finish, running no check", () => {
    const result = hook(STOP, stop(session()));
    expect(result).toMatchObject({ status: 0, stderr: "", tools: [] });
    expect(result.stdout).toContain("end-of-turn: no code changed");
  });

  it("runs lint, the unit tests and the typecheck on a clean change, and lets the turn finish", () => {
    write(project, "src/clean-turn.mjs", CLEAN);
    const result = hook(STOP, stop(session()));
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(ran(result)).toEqual(["astro check", "eslint", "vitest run"]);
  });

  it("sends the agent back for a lint error written straight to disk", () => {
    // A file rewritten through a shell command never reaches the per-edit hook.
    write(project, "src/broken-turn.mjs", BROKEN);
    const result = hook(STOP, stop(session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Fix these before you finish:");
    expect(result.stderr).toContain("ESLint errors in changed files:\nsrc/broken-turn.mjs:");
  });

  it("reports a failing test and a type error in one message", () => {
    write(project, "src/sum.test.mjs", "// FAILING_ASSERTION: expect(add(1, 1)).toBe(3)\n");
    write(project, "src/typed.mjs", "export const count = 'one'; // TYPE_ERROR\n");
    const result = hook(STOP, stop(session()));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unit tests fail (npx vitest run):\nFAIL src/sum.test.mjs > adds");
    expect(result.stderr).toContain("Typecheck fails (npx astro check --noSync):\nsrc/typed.mjs:1:1 - error ts(2322)");
  });

  it.each([
    ["stop_hook_active", { stop_hook_active: true }],
    ["Cursor's loop_count", { loop_count: 1 }],
  ])("lets the agent finish once %s says it was sent back already", (_, retry) => {
    write(project, "src/broken-retry.mjs", BROKEN);
    expect(hook(STOP, stop(session(), project, retry))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("checks the same uncommitted code only once", () => {
    write(project, "src/clean-twice.mjs", CLEAN);
    const id = session();
    expect(hook(STOP, stop(id)).status).toBe(0);
    const again = hook(STOP, stop(id));
    expect(again).toMatchObject({ status: 0, stderr: "", tools: [] });
    expect(again.stdout).toContain("1 changed file(s) already passed");
  });

  it("leaves a new file in a folder outside the listed ones alone", () => {
    write(project, "handoff/broken-stray.mjs", BROKEN);
    expect(hook(STOP, stop(session()))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("sweeps a sibling worktree an edit reached this session, and keeps sweeping it after it passed", () => {
    const id = session();
    expect(hook(LINT, edit(write(sibling, "src/clean-sibling.mjs", CLEAN), id)).status).toBe(0);
    expect(hook(STOP, stop(id))).toMatchObject({ status: 0, stderr: "" });
    // A later change there through a shell command still counts.
    write(sibling, "src/broken-later.mjs", BROKEN);
    const result = hook(STOP, stop(id));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`In ${sibling}:\n\nESLint errors in changed files:\nsrc/broken-later.mjs:`);
    // A session that never edited there leaves the sibling alone.
    expect(hook(STOP, stop(session()))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("doesn't sweep the checkout CLAUDE_PROJECT_DIR names", () => {
    write(other, "src/broken-elsewhere.mjs", BROKEN);
    const result = hook(STOP, stop(session()), { env: { CLAUDE_PROJECT_DIR: other } });
    expect(result).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("neither registers nor sweeps another repository an edit reached", () => {
    const id = session();
    const file = write(other, "src/broken-edited.mjs", BROKEN);
    expect(hook(LINT, edit(file, id))).toMatchObject({ status: 0, tools: [] });
    expect(hook(STOP, stop(id))).toMatchObject({ status: 0, stderr: "", tools: [] });
  });

  it("says so when a changed checkout has no node_modules, instead of passing", () => {
    write(bare, "src/clean-bare-turn.mjs", CLEAN);
    const result = hook(STOP, stop(session(), bare));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Nothing was checked: this checkout has no node_modules");
  });

  it("says so when the typechecker is missing, instead of passing", () => {
    write(partial, "src/clean-partial.mjs", CLEAN);
    const result = hook(STOP, stop(session(), partial));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "Typecheck didn't run:\nastro isn't installed in this checkout (no node_modules/astro)",
    );
  });

  it("tells the user, not Claude, when the session isn't in a git checkout", () => {
    const outside = path.join(base, "outside");
    mkdirSync(outside, { recursive: true });
    const result = hook(STOP, stop(session(), outside), { cwd: outside });
    expect(result).toMatchObject({ status: 0, stderr: "", tools: [] });
    expect(JSON.parse(result.stdout)).toEqual({
      systemMessage: `end-of-turn: no git checkout at ${outside}, so nothing was checked.`,
    });
  });
});

describe("settings.json", { timeout: TIMEOUT }, () => {
  it.runIf(BASH)("reaches each hook's script from a worktree whose CLAUDE_PROJECT_DIR names nothing", () => {
    const { hooks } = JSON.parse(readFileSync(path.join(sibling, ".claude", "settings.json"), "utf8"));
    const commands = Object.entries(hooks).flatMap(([event, groups]) =>
      groups.flatMap((group) => group.hooks.map((entry) => ({ event, command: entry.command }))),
    );
    expect(commands.map(({ event }) => event)).toEqual(["PostToolUse", "Stop"]);
    for (const { event, command } of commands) {
      const run = spawnSync(BASH, ["-c", command], {
        cwd: sibling,
        input: "{}",
        encoding: "utf8",
        env: { ...env, CLAUDE_PROJECT_DIR: path.join(base, "nowhere") },
        timeout: TIMEOUT,
        windowsHide: true,
      });
      expect(run.status, `${event}: ${command}\n${run.stderr}`).toBe(0);
      expect(run.stderr).toBe("");
      if (event === "Stop") expect(run.stdout).toContain("end-of-turn: no code changed");
    }
  });
});

/**
 * Runs one of the throwaway project's committed hooks, as Claude Code would.
 * @param {string} script
 * @param {object | string} payload an object, sent as JSON, or raw text
 * @param {{ cwd?: string, env?: Record<string, string> }} [options] the hook's working directory and extra variables
 */
function hook(script, payload, { cwd = project, env: extra = {} } = {}) {
  const log = path.join(base, `stand-ins-${++counter}.log`);
  const run = spawnSync(process.execPath, [path.join(project, ".claude", "hooks", script)], {
    cwd,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...env, STAND_IN_LOG: log, ...extra },
    timeout: TIMEOUT,
    windowsHide: true,
  });
  const tools = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, tools };
}

// The tools a hook ran, sorted: "eslint", or the tool with its subcommand.
function ran({ tools }) {
  return tools
    .map((line) => {
      const [tool, command] = line.split(" ");
      return tool === "eslint" ? tool : `${tool} ${command}`;
    })
    .sort();
}

function edit(file, sessionId) {
  return {
    session_id: sessionId,
    cwd: project,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: file, old_string: "a", new_string: "b" },
    tool_response: { filePath: file },
  };
}

function stop(sessionId, cwd = project, extra = {}) {
  return { session_id: sessionId, cwd, hook_event_name: "Stop", stop_hook_active: false, ...extra };
}

function session() {
  return `session-${++counter}`;
}

function write(root, relative, text) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  written.push(file);
  return file;
}

function slashed(file) {
  return file.split(path.sep).join("/");
}

function worktree(name, tools) {
  const root = path.join(base, name);
  git(project, "worktree", "add", "-q", "-b", name, root);
  install(root, tools);
  return realpathSync.native(root);
}

// The stand-ins as node_modules packages, found the way the hooks find a tool: through its package.json's bin.
function install(root, tools) {
  for (const tool of tools) {
    const directory = path.join(root, "node_modules", tool);
    mkdirSync(path.join(directory, "bin"), { recursive: true });
    const manifest = { name: tool, version: "0.0.0", type: "module", bin: { [tool]: "bin/tool.mjs" } };
    writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
    cpSync(STAND_IN, path.join(directory, "bin", "tool.mjs"));
  }
  // Generated types, so the typecheck runs without a sync first.
  if (tools.includes("astro")) {
    mkdirSync(path.join(root, ".astro"), { recursive: true });
    writeFileSync(path.join(root, ".astro", "types.d.ts"), "// generated\n");
  }
}

function git(cwd, ...args) {
  const run = spawnSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${run.stderr}`);
  return run.stdout.trim();
}

// Git for Windows' bash.exe, next to the git that runs here, or null.
function gitBash() {
  const exec = spawnSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
  const candidate = exec ? path.resolve(exec, "..", "..", "..", "bin", "bash.exe") : "";
  return candidate && existsSync(candidate) ? candidate : null;
}
