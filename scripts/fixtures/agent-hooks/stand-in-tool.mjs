// A stand-in for ESLint, Vitest or Astro in scripts/agent-hooks.test.mjs, which installs it into a throwaway checkout
// as node_modules/<tool>/bin/tool.mjs: the real tools take seconds per run, and the hooks need only their exit codes
// and output. The package directory it sits in says which tool it plays:
//   - eslint: a report like `eslint --format json`, with an error on each line holding LINT_ERROR, or a crash with no
//     report when a file holds ESLINT_CRASH;
//   - vitest run: fails when a *.test.* file in the checkout holds FAILING_ASSERTION;
//   - astro sync writes .astro/types.d.ts, and astro check fails when a file in the checkout holds TYPE_ERROR.
// Each run is appended to the file STAND_IN_LOG names, as "<tool> <arguments> @ <cwd>".
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const tool = path.basename(path.dirname(path.dirname(import.meta.filename)));
const args = process.argv.slice(2);
if (process.env.STAND_IN_LOG)
  appendFileSync(process.env.STAND_IN_LOG, `${tool} ${args.join(" ")} @ ${process.cwd()}\n`);

if (tool === "eslint") {
  lint(args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--format"));
} else if (tool === "vitest" && args[0] === "run") {
  const failing = filesHolding("FAILING_ASSERTION").filter((file) => /\.test\./.test(file));
  report(failing, (file) => `FAIL ${file} > adds\nAssertionError: expected 2 to be 3`, "Test Files  1 passed (1)");
} else if (tool === "astro" && args[0] === "sync") {
  mkdirSync(path.join(process.cwd(), ".astro"), { recursive: true });
  writeFileSync(path.join(process.cwd(), ".astro", "types.d.ts"), "// stand-in types\n");
  console.log("Generated types");
} else if (tool === "astro" && args[0] === "check") {
  const failing = filesHolding("TYPE_ERROR");
  report(
    failing,
    (file) => `${file}:1:1 - error ts(2322): Type 'string' is not assignable to type 'number'.`,
    "0 errors",
  );
} else {
  console.error(`stand-in ${tool}: no part for the arguments ${args.join(" ")}`);
  process.exitCode = 2;
}

function lint(files) {
  const results = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (text.includes("ESLINT_CRASH")) {
      console.error("Oops! Something went wrong! :(\nThe stand-in crashed on purpose.");
      process.exitCode = 2;
      return;
    }
    const messages = text.split("\n").flatMap((line, i) => {
      if (!line.includes("LINT_ERROR")) return [];
      const message = "'unused' is assigned a value but never used.";
      return [{ ruleId: "no-unused-vars", severity: 2, message, line: i + 1, column: 7 }];
    });
    results.push({ filePath: path.resolve(file), messages, errorCount: messages.length });
  }
  console.log(JSON.stringify(results));
  process.exitCode = results.some(({ messages }) => messages.length > 0) ? 1 : 0;
}

function report(failing, line, passed) {
  if (failing.length === 0) {
    console.log(passed);
    return;
  }
  console.log(failing.map(line).join("\n"));
  process.exitCode = 1;
}

// Files under the cwd holding the marker, as paths relative to it, outside node_modules, .git and .astro.
function filesHolding(marker) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", ".astro"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (readFileSync(full, "utf8").includes(marker)) {
        found.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
      }
    }
  };
  walk(process.cwd());
  return found;
}
