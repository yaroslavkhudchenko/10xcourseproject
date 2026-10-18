// `npm run eval`: the reviewer's promptfoo eval (promptfooconfig.yaml beside this file) with promptfoo pinned and its
// telemetry and update check off, run the same way on Windows and elsewhere. promptfoo isn't a dependency, so its
// ~690 packages stay out of the reviewer's lockfile: npx fetches the pinned version into npm's cache on the first run.
// Arguments after `--` go to promptfoo, as in `npm run eval -- --filter-providers glm`, and the command exits with
// promptfoo's code: 0 when every case passed, 100 when one failed, 1 for an error. With telemetry off, promptfoo 0.124.1
// still sends one "telemetry disabled" event (research §10).
//
// npx runs from npm's own npx-cli.js with this Node, never through a shell: on Windows, Node spawns neither npx nor
// npx.cmd without one, and a shell would read the arguments passed through, as cmd.exe reads "|" as a pipe.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTFOO = "promptfoo@0.124.1";
const CONFIG = fileURLToPath(new URL("promptfooconfig.yaml", import.meta.url));

/**
 * npm's npx-cli.js: the one beside the npm that runs this script (npm_execpath), else the one bundled with this Node,
 * where Windows and POSIX installs keep it.
 * @returns {string | undefined}
 */
function npxCli() {
  const npm = process.env.npm_execpath;
  const nodeDir = dirname(process.execPath);
  return [
    ...(npm === undefined ? [] : [join(dirname(npm), "npx-cli.js")]),
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ].find((path) => existsSync(path));
}

const cli = npxCli();
if (cli === undefined) {
  console.error("ai-reviewer: npm's npx-cli.js wasn't found; run the eval through npm, as `npm run eval`");
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [cli, "--yes", PROMPTFOO, "eval", "-c", CONFIG, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_UPDATE: "1" },
  });
  // Ctrl+C reaches promptfoo too, which stops and reports on its own, so this waits for it rather than leave it running.
  process.on("SIGINT", () => {});
  child.on("error", (error) => {
    console.error(`ai-reviewer: promptfoo didn't start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
}
