import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appliedVersionsOf,
  checkMigrationsApplied,
  listMigrationVersions,
  MIGRATIONS_DIR,
  migrationsDirOf,
  missingMigrations,
  readAppliedMigrations,
  versionOf,
} from "./check-migrations-applied.mjs";

// The migration gate's rules. A gate that read an answer it can't read as "nothing applied", or a misnamed file as no
// migration at all, would let code deploy ahead of its migration, so each of those fails instead. What it prints lands
// in CI's public logs and in Workers Builds' logs, so no failure holds the key, the Supabase URL or an answer's body.
// No test sends a request: the ones that need an answer stub fetch.

const PROJECT_URL = "https://abcdefghijklmnop.supabase.co";
const KEY = "sb_publishable_made-up";

/**
 * An answer as the gate reads it: a status and a body.
 * @param {number} status
 * @param {string} body
 */
function answer(status, body) {
  return Promise.resolve({ status, text: () => Promise.resolve(body) });
}

describe("versionOf, a migration file's version", () => {
  it("takes the 14-digit prefix of a migration's name", () => {
    expect(versionOf("20261006183345_applied_migrations.sql")).toBe("20261006183345");
  });

  it.each([
    { why: "a name without a version", name: "applied_migrations.sql" },
    { why: "a version of 13 digits", name: "2026100618334_applied_migrations.sql" },
    { why: "a version of 15 digits", name: "202610061833450_applied_migrations.sql" },
    { why: "a version with no name", name: "20261006183345_.sql" },
    { why: "a file that isn't .sql", name: "20261006183345_applied_migrations.sql.bak" },
    { why: "an upper-case .SQL, which the Supabase CLI doesn't apply", name: "20261006183345_applied_migrations.SQL" },
  ])("finds none in $why", ({ name }) => {
    expect(versionOf(name)).toBeNull();
  });
});

describe("listMigrationVersions, the versions a migrations directory holds", () => {
  it("lists every migration's version in name order, leaving out the files that aren't .sql", () => {
    expect(
      listMigrationVersions([
        "20260927145051_watchlist_items.sql",
        ".gitkeep",
        "20260926112205_polite_shop_access.sql",
        "README.md",
      ]),
    ).toEqual({ versions: ["20260926112205", "20260927145051"] });
  });

  it.each([
    { why: "a .sql file without a version", name: "watchlist_fix.sql" },
    {
      why: "an upper-case .SQL file, which the Supabase CLI would skip",
      name: "20261006183345_applied_migrations.SQL",
    },
  ])("refuses $why, naming it, never reading the others as all there is", ({ name }) => {
    expect(listMigrationVersions(["20260926112205_polite_shop_access.sql", name])).toEqual({
      failure: expect.stringContaining(JSON.stringify(name)),
    });
  });

  it("refuses a directory without a .sql file, most likely the wrong one, rather than pass with nothing to check", () => {
    expect(listMigrationVersions([".gitkeep"])).toEqual({ failure: expect.any(String) });
    expect(listMigrationVersions([])).toEqual({ failure: expect.any(String) });
  });

  it("reads the repository's own migrations by default, every one of them with a version", () => {
    expect(listMigrationVersions(readdirSync(MIGRATIONS_DIR))).toEqual({
      versions: expect.arrayContaining(["20260926112205", "20261006183345"]),
    });
  });
});

describe("missingMigrations, the versions the database lacks", () => {
  const local = ["20260926112205", "20260927145051", "20261006183345"];

  it("finds none missing when the database has every version", () => {
    expect(missingMigrations(local, [...local])).toEqual([]);
  });

  it("names the one the database lacks", () => {
    expect(missingMigrations(local, ["20260926112205", "20260927145051"])).toEqual(["20261006183345"]);
  });

  it("finds none missing when the database is ahead of the repository", () => {
    expect(missingMigrations(local, [...local, "20261007090000"])).toEqual([]);
  });

  it("names every version a database without any lacks, in order and each once", () => {
    expect(missingMigrations(["20261006183345", "20260926112205", "20260926112205"], [])).toEqual([
      "20260926112205",
      "20261006183345",
    ]);
  });
});

describe("appliedVersionsOf, what an answer says", () => {
  it.each([
    {
      why: "the versions the database has",
      body: '["20260926112205","20260927145051"]',
      versions: ["20260926112205", "20260927145051"],
    },
    { why: "an empty list, a database with none", body: "[]", versions: [] },
  ])("reads $why from a 200", ({ body, versions }) => {
    expect(appliedVersionsOf(200, body)).toEqual({ versions });
  });

  it.each([
    { why: "not JSON", body: `<html>${PROJECT_URL}</html>` },
    { why: "empty", body: "" },
    { why: "JSON null", body: "null" },
    { why: "a JSON object", body: '{"versions":["20260926112205"]}' },
    { why: "a list that holds a number", body: '["20260926112205",20260927145051]' },
    { why: "a list of rows rather than versions", body: '[{"applied_migrations":"20260926112205"}]' },
  ])("fails a 200 whose body is $why, never reading it as nothing applied", ({ body }) => {
    expect(appliedVersionsOf(200, body)).toEqual({
      failure: "applied_migrations() answered 200 with something other than a list of versions",
    });
  });

  it("says to push this change's migration first when the database has no such function, showing none of the body", () => {
    const body = JSON.stringify({
      code: "PGRST202",
      details: "Searched for the function public.applied_migrations without parameters",
      hint: "Perhaps you meant to call the function public.reserve_shop_request",
      message: "Could not find the function public.applied_migrations without parameters in the schema cache",
    });
    const result = appliedVersionsOf(404, body);
    expect(result).toEqual({ failure: expect.stringContaining("(PGRST202): push this change's migration first") });
    expect(result.failure).not.toContain("reserve_shop_request");
    expect(result.failure).not.toContain("schema cache");
  });

  it.each([
    {
      why: "anon without its grant",
      status: 401,
      body: '{"code":"42501","details":null,"hint":null,"message":"permission denied for function applied_migrations"}',
      shown: "HTTP 401 (42501)",
    },
    {
      why: "a key the gateway refuses",
      status: 401,
      body: '{"message":"Invalid API key","hint":"Double check your Supabase `anon` or `service_role` API key."}',
      shown: "HTTP 401",
    },
    { why: "versions under another status", status: 206, body: '["20260926112205"]', shown: "HTTP 206" },
    { why: "a redirect", status: 301, body: "", shown: "HTTP 301" },
    {
      why: "a server error that isn't JSON",
      status: 502,
      body: `<html>Bad gateway: ${PROJECT_URL}</html>`,
      shown: "HTTP 502",
    },
    { why: "a code that isn't one", status: 400, body: JSON.stringify({ code: PROJECT_URL }), shown: "HTTP 400" },
  ])("fails $why, showing only the status and PostgREST's code", ({ status, body, shown }) => {
    expect(appliedVersionsOf(status, body)).toEqual({ failure: `applied_migrations() answered ${shown}` });
  });
});

describe("readAppliedMigrations, the gate's one request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts {} to applied_migrations() with the key as apikey only, following no redirect", async () => {
    const fetchMock = vi.fn(() => answer(200, '["20260926112205"]'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readAppliedMigrations(PROJECT_URL, KEY)).resolves.toEqual({ versions: ["20260926112205"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PROJECT_URL}/rest/v1/rpc/applied_migrations`);
    expect(init).toMatchObject({ method: "POST", body: "{}", redirect: "manual" });
    expect(init.headers).toEqual({ apikey: KEY, "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails when no answer comes, naming neither the URL nor the key", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND abcdefghijklmnop.supabase.co"), { code: "ENOTFOUND" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed", { cause }))),
    );
    await expect(readAppliedMigrations(PROJECT_URL, KEY)).resolves.toEqual({
      failure: "asking applied_migrations() failed: no answer (ENOTFOUND)",
    });
  });
});

describe("migrationsDirOf, the directory a run reads", () => {
  it("reads the repository's migrations without an argument, and the directory --migrations-dir names", () => {
    expect(migrationsDirOf([])).toEqual({ migrationsDir: MIGRATIONS_DIR });
    expect(migrationsDirOf(["--migrations-dir=/tmp/migrations-copy"])).toEqual({
      migrationsDir: "/tmp/migrations-copy",
    });
  });

  it.each([
    { why: "a flag that names no directory", args: ["--migrations-dir="] },
    { why: "the flag twice", args: ["--migrations-dir=a", "--migrations-dir=b"] },
    { why: "an argument it doesn't know", args: ["--dir=a"] },
    { why: "a bare argument, such as a pasted key", args: ["sb_publishable_made-up"] },
  ])("refuses $why, repeating no argument", ({ args }) => {
    const result = migrationsDirOf(args);
    expect(result).toEqual({ refusal: expect.any(String) });
    for (const arg of args) {
      expect(result.refusal).not.toContain(arg);
    }
  });
});

describe("checkMigrationsApplied, the gate", () => {
  const SETTINGS = { supabaseUrl: PROJECT_URL, key: KEY };
  /** @type {string} */
  let dir;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migrations-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * Writes an empty file for each migration name into the run's directory.
   * @param {string[]} names
   */
  function migrations(...names) {
    for (const name of names) writeFileSync(join(dir, name), "");
  }

  /**
   * Stubs fetch with a database that has applied `versions`, and gives the stub.
   * @param {string[]} versions
   */
  function database(versions) {
    const fetchMock = vi.fn(() => answer(200, JSON.stringify(versions)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("passes when the database has every migration and more", async () => {
    migrations("20260926112205_polite_shop_access.sql", "20261006183345_applied_migrations.sql");
    database(["20260926112205", "20261006183345", "20261007090000"]);
    await expect(checkMigrationsApplied(SETTINGS, dir)).resolves.toEqual({ ok: true, count: 2 });
    expect(logSpy).toHaveBeenCalledWith("All 2 migrations are applied");
  });

  it("refuses a database that lacks one, naming it", async () => {
    migrations("20260926112205_polite_shop_access.sql", "29991231235959_never_applied.sql");
    database(["20260926112205"]);
    await expect(checkMigrationsApplied(SETTINGS, dir)).resolves.toEqual({ ok: false, missing: ["29991231235959"] });
    expect(logSpy).toHaveBeenCalledWith("Missing on the database: 29991231235959");
  });

  it("refuses a file without a version before any request", async () => {
    migrations("20260926112205_polite_shop_access.sql", "fix.sql");
    const fetchMock = database(["20260926112205"]);
    await expect(checkMigrationsApplied(SETTINGS, dir)).resolves.toEqual({
      ok: false,
      failure: expect.stringContaining('"fix.sql" has no version'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^check-migrations-applied: "fix\.sql" has no version/),
    );
  });

  it("refuses a directory it can't read before any request", async () => {
    const fetchMock = database([]);
    await expect(checkMigrationsApplied(SETTINGS, join(dir, "no-such-directory"))).resolves.toEqual({
      ok: false,
      failure: expect.stringContaining("(ENOENT)"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails on an answer it can't read, printing neither its body, the URL nor the key", async () => {
    migrations("20260926112205_polite_shop_access.sql");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer(502, `<html>Bad gateway: ${PROJECT_URL} ${KEY}</html>`)),
    );
    await expect(checkMigrationsApplied(SETTINGS, dir)).resolves.toEqual({
      ok: false,
      failure: "applied_migrations() answered HTTP 502",
    });
    const printed = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n");
    expect(printed).toBe("check-migrations-applied: applied_migrations() answered HTTP 502");
  });
});
