// Database contract check: holds the public schema to the relations and functions this app's migrations make, each
// with its protection, so a new one can't slip in unprotected (test plan risk #4: "a new table inherits the rules").
// As the local superuser (scripts/e2e-local-db.mjs) it fails on a relation or a function outside the reviewed list
// below, a table without RLS, a view that doesn't run as its caller (security_invoker), any privilege of anon but
// EXECUTE on applied_migrations(), and a function PUBLIC may execute. It first shows it can see each of those faults:
// scratch objects that carry them, made in a transaction that is rolled back, must be flagged.
// Run: node scripts/check-catalog-db.mjs, with the local stack running and .env and .dev.vars pointing at it. It only
// reads the catalogue, and its scratch objects never outlive their transaction. A migration that adds a table, a view
// or a function adds it to the reviewed list, together with its protection.

import { assertLocalSupabase, sql } from "./e2e-local-db.mjs";

let failed = 0;
function check(name, ok, actual) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
  if (!ok) failed++;
}

// The superuser's helper refuses unless the environment, .env and .dev.vars all name the local stack.
try {
  assertLocalSupabase();
} catch (error) {
  console.log(`FAIL  the catalogue is read as the local superuser, whose helper says: ${error.message}`);
  process.exit(1);
}

// The reviewed list: every relation and function supabase/migrations makes in public, and what each one is.
const RELATIONS = new Map([
  ["shops", "table"],
  ["shop_requests", "table"],
  ["watchlist_items", "table"],
  ["watchlist_matches", "table"],
  ["price_observations", "table"],
  ["latest_price_observations", "view"],
  ["price_summaries", "view"],
]);
const FUNCTIONS = [
  "applied_migrations()",
  "report_shop_block(text, text, integer, text)",
  "reserve_shop_request(text)",
];
// anon's one privilege: the deploy gate asks this function with the publishable key alone
// (supabase/migrations/20261006183345_applied_migrations.sql).
const ANON_EXECUTES = "applied_migrations()";

// What a relation's relkind stands for, for each kind PostgREST could serve.
const KINDS = { r: "table", p: "table", v: "view", m: "materialized view", f: "foreign table" };
// Every privilege Postgres 17 has on a relation (MAINTAIN is new in 17, supabase/config.toml's major_version), on its
// columns, and on a sequence.
const TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN";
const COLUMN_PRIVILEGES = "SELECT, INSERT, UPDATE, REFERENCES";
const SEQUENCE_PRIVILEGES = "USAGE, SELECT, UPDATE";

// One statement, with one row per object in public, its type first and every field as text:
// - a relation PostgREST could serve: its name, its relkind, whether RLS is on, whether it runs as its caller, and
//   whether anon holds any privilege on it or on one of its columns;
// - a sequence: its name and whether anon holds any privilege on it;
// - a function: its name and argument types, whether PUBLIC may execute it, and whether anon may;
// - the schema itself: whether anon may create in it. Its USAGE stays, since anon's call of applied_migrations() needs it.
const CATALOGUE = `
select 'relation', c.relname::text, c.relkind::text, c.relrowsecurity::text,
  coalesce((select o.option_value::boolean from pg_options_to_table(c.reloptions) o
    where o.option_name = 'security_invoker'), false)::text,
  (has_table_privilege('anon', c.oid, '${TABLE_PRIVILEGES}')
    or has_any_column_privilege('anon', c.oid, '${COLUMN_PRIVILEGES}'))::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
union all
select 'sequence', c.relname::text, '', '', '', has_sequence_privilege('anon', c.oid, '${SEQUENCE_PRIVILEGES}')::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S'
union all
select 'function', p.proname || '(' || oidvectortypes(p.proargtypes) || ')', '',
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE')::text,
  '', has_function_privilege('anon', p.oid, 'EXECUTE')::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
union all
select 'schema', 'public', '', '', '', has_schema_privilege('anon', 'public', 'CREATE')::text`;

/**
 * The catalogue's rows, read by one run of `statement` as the local superuser.
 * @param {string} statement
 */
function readCatalogue(statement) {
  return sql(statement).map((line) => {
    const [type, name, relkind, flag, invoker, anon] = line.split("|");
    return { type, name, relkind, flag, invoker, anon };
  });
}

/**
 * Each rule's offenders among the rows, and the reviewed objects the rows lack.
 * @param {ReturnType<typeof readCatalogue>} rows
 */
function faultsOf(rows) {
  const relations = rows.filter((row) => row.type === "relation");
  const functions = rows.filter((row) => row.type === "function");
  const kindOf = (row) => KINDS[row.relkind] ?? `relkind ${row.relkind}`;
  const named = (row) => (row.type === "relation" ? `${kindOf(row)} ${row.name}` : `${row.type} ${row.name}`);
  return {
    unreviewed: [
      ...relations.filter((row) => RELATIONS.get(row.name) !== kindOf(row)),
      ...functions.filter((row) => !FUNCTIONS.includes(row.name)),
    ].map(named),
    missing: [
      ...[...RELATIONS].filter(([name, kind]) => !relations.some((row) => row.name === name && kindOf(row) === kind)),
      ...FUNCTIONS.filter((name) => !functions.some((row) => row.name === name)).map((name) => [name, "function"]),
    ].map(([name, kind]) => `${kind} ${name}`),
    withoutRls: relations.filter((row) => kindOf(row) === "table" && row.flag !== "true").map(named),
    withoutInvoker: relations.filter((row) => kindOf(row) === "view" && row.invoker !== "true").map(named),
    anon: rows
      .filter((row) => row.anon === "true" && !(row.type === "function" && row.name === ANON_EXECUTES))
      .map(named),
    publicExecute: functions.filter((row) => row.flag === "true").map(named),
  };
}

const list = (names) => (names.length === 0 ? "none" : names.join(", "));

// 1. The self-test: scratch objects that carry every fault the check looks for, flagged in the same transaction that
// made them, which is then rolled back. A table without RLS that anon may read, a view that runs as its owner, and a
// function PUBLIC may execute, all outside the reviewed list.
const SCRATCH = "catalog_check_scratch";
const scratchTable = `table ${SCRATCH}`;
const scratchView = `view ${SCRATCH}_view`;
const scratchFunction = `function ${SCRATCH}_function()`;
let scratch;
try {
  scratch = faultsOf(
    readCatalogue(`
begin;
create table public.${SCRATCH} (id integer);
alter table public.${SCRATCH} disable row level security;
grant select on table public.${SCRATCH} to anon;
create view public.${SCRATCH}_view as select 1 as one;
create function public.${SCRATCH}_function() returns integer language sql as 'select 1';
grant execute on function public.${SCRATCH}_function() to public;
${CATALOGUE};
rollback;`),
  );
} catch (error) {
  check("read the catalogue with scratch objects as the local superuser", false, error.message);
  process.exit(1);
}
const flags = (offenders, ...names) => names.every((name) => offenders.includes(name));
check(
  "the self-test flags its scratch table, view and function as outside the reviewed list",
  flags(scratch.unreviewed, scratchTable, scratchView, scratchFunction),
  list(scratch.unreviewed),
);
check(
  "the self-test flags its scratch table without RLS",
  flags(scratch.withoutRls, scratchTable),
  list(scratch.withoutRls),
);
check(
  "the self-test flags its scratch view, which runs as its owner",
  flags(scratch.withoutInvoker, scratchView),
  list(scratch.withoutInvoker),
);
check(
  "the self-test flags anon's privileges on its scratch table and function",
  flags(scratch.anon, scratchTable, scratchFunction),
  list(scratch.anon),
);
check(
  "the self-test flags its scratch function, which PUBLIC may execute",
  flags(scratch.publicExecute, scratchFunction),
  list(scratch.publicExecute),
);

// 2. The catalogue itself, with the scratch objects gone: only the reviewed objects, each with its protection.
let rows;
try {
  rows = readCatalogue(CATALOGUE);
} catch (error) {
  check("read the catalogue as the local superuser", false, error.message);
  process.exit(1);
}
const faults = faultsOf(rows);
const count = (type) => rows.filter((row) => row.type === type).length;
check(
  "the scratch objects are gone with their transaction",
  !rows.some((row) => row.name.startsWith(SCRATCH)),
  `${count("relation")} relations, ${count("function")} functions`,
);
check(
  "every public relation and function is on the reviewed list",
  faults.unreviewed.length === 0,
  list(faults.unreviewed),
);
check("every object on the reviewed list exists", faults.missing.length === 0, list(faults.missing));
check("every public table has RLS on", faults.withoutRls.length === 0, list(faults.withoutRls));
check(
  "every public view runs as its caller (security_invoker)",
  faults.withoutInvoker.length === 0,
  list(faults.withoutInvoker),
);
check(
  "anon holds no privilege in public but EXECUTE on applied_migrations()",
  faults.anon.length === 0,
  list(faults.anon),
);
check("PUBLIC may execute no public function", faults.publicExecute.length === 0, list(faults.publicExecute));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll catalogue checks passed");
process.exit(failed ? 1 : 0);
