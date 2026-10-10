import type { SupabaseClient } from "@supabase/supabase-js";

// A stand-in for the user's own Supabase client in tests: each relation answers from canned rows, the rows RLS would
// let the user see, and each RPC from a canned answer. `eq`, `in`, `is` and `limit` narrow a relation's rows as the
// database would, so an id nobody holds reads as no row, and every builder call is recorded, so a test can see which
// queries ran with which filters. A relation given as an error answers that error to every query of it, a timeout's
// 57014 included. Writes change no canned row: an insert, update or delete answers with the rows it would return.

/** A database error as PostgREST answers it. */
export interface StubError {
  code: string;
  message: string;
}

/** A relation's canned answer: its rows, or the error every query of it gets. */
export type StubRelation = readonly Record<string, unknown>[] | { error: StubError };

/** A relation whose every query times out, as Postgres cancels a statement that runs too long. */
export const TIMEOUT: StubRelation = {
  error: { code: "57014", message: "canceling statement due to statement timeout" },
};

/** What an RPC answers to its arguments: its data, or an error. */
export type StubRpc = (args: unknown) => { data?: unknown; error?: StubError };

/**
 * One builder call a query made, such as `["eq", "id", "…"]`; a query starts with `["from", relation]` or
 * `["rpc", name, args]`.
 */
export type StubCall = [method: string, ...args: unknown[]];

export interface StubOptions {
  relations?: Record<string, StubRelation>;
  rpc?: Record<string, StubRpc>;
}

interface StubResult {
  data: unknown;
  error: StubError | null;
  count: number | null;
}

type Filter = (row: Record<string, unknown>) => boolean;

const NO_ANSWER = (what: string): StubError => ({ code: "stub", message: `no answer for ${what}` });

/** A query on one relation, answered when it's awaited. */
class StubQuery implements PromiseLike<StubResult> {
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private returning = false;
  private counted = false;
  private values: unknown = null;
  private readonly filters: Filter[] = [];
  private limited: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly relation: StubRelation | undefined,
    private readonly name: string,
    private readonly calls: StubCall[],
  ) {}

  select(columns?: string, options?: { count?: string }): this {
    this.calls.push(options === undefined ? ["select", columns] : ["select", columns, options]);
    if (this.operation === "select") {
      this.counted = options?.count !== undefined;
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(values: unknown): this {
    this.calls.push(["insert", values]);
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: unknown): this {
    this.calls.push(["update", values]);
    this.operation = "update";
    this.values = values;
    return this;
  }

  delete(): this {
    this.calls.push(["delete"]);
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.calls.push(["eq", column, value]);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.calls.push(["in", column, values]);
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  is(column: string, value: null | boolean): this {
    this.calls.push(["is", column, value]);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  order(column: string, options?: unknown): this {
    this.calls.push(["order", column, options]);
    return this;
  }

  limit(count: number): this {
    this.calls.push(["limit", count]);
    this.limited = count;
    return this;
  }

  abortSignal(signal: AbortSignal): this {
    this.calls.push(["abortSignal", signal instanceof AbortSignal]);
    return this;
  }

  single(): this {
    this.calls.push(["single"]);
    this.mode = "single";
    return this;
  }

  maybeSingle(): this {
    this.calls.push(["maybeSingle"]);
    this.mode = "maybeSingle";
    return this;
  }

  then<Fulfilled = StubResult, Rejected = never>(
    onFulfilled?: ((value: StubResult) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): PromiseLike<Fulfilled | Rejected> {
    return Promise.resolve(this.answer()).then(onFulfilled, onRejected);
  }

  private answer(): StubResult {
    if (this.relation === undefined) {
      return { data: null, error: NO_ANSWER(this.name), count: null };
    }
    if ("error" in this.relation) {
      return { data: null, error: this.relation.error, count: null };
    }
    if (this.operation === "insert") {
      const inserted = Array.isArray(this.values) ? (this.values as unknown[]) : [this.values];
      return this.shaped(this.returning ? inserted : null);
    }
    const matched = this.relation.filter((row) => this.filters.every((keep) => keep(row)));
    const rows = this.limited === null ? matched : matched.slice(0, this.limited);
    if (this.operation === "update") {
      const values = typeof this.values === "object" && this.values !== null ? this.values : {};
      return this.shaped(this.returning ? rows.map((row) => ({ ...row, ...values })) : null);
    }
    if (this.operation === "delete") {
      return this.shaped(this.returning ? rows : null);
    }
    return { ...this.shaped([...rows]), count: this.counted ? rows.length : null };
  }

  /** The rows a query returns, as `single` and `maybeSingle` shape them. */
  private shaped(rows: unknown[] | null): StubResult {
    if (rows === null || this.mode === "many") {
      return { data: rows, error: null, count: null };
    }
    if (rows.length === 1) {
      return { data: rows[0], error: null, count: null };
    }
    if (rows.length === 0 && this.mode === "maybeSingle") {
      return { data: null, error: null, count: null };
    }
    return { data: null, error: { code: "PGRST116", message: `${rows.length} rows for a single row` }, count: null };
  }
}

/** An RPC call, answered when it's awaited. */
class StubRpcCall implements PromiseLike<StubResult> {
  constructor(
    private readonly answer: () => StubResult,
    private readonly calls: StubCall[],
  ) {}

  abortSignal(signal: AbortSignal): this {
    this.calls.push(["abortSignal", signal instanceof AbortSignal]);
    return this;
  }

  then<Fulfilled = StubResult, Rejected = never>(
    onFulfilled?: ((value: StubResult) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): PromiseLike<Fulfilled | Rejected> {
    return Promise.resolve(this.answer()).then(onFulfilled, onRejected);
  }
}

/**
 * A client whose queries are answered from `relations` and `rpc`, and the calls each query made, in order. A relation
 * or an RPC without an answer answers an error, so a query the test didn't expect can't read as an empty result.
 */
export function stubSupabase({ relations = {}, rpc = {} }: StubOptions = {}): {
  client: SupabaseClient;
  queries: StubCall[][];
} {
  const queries: StubCall[][] = [];
  const client = {
    from: (name: string) => {
      const calls: StubCall[] = [["from", name]];
      queries.push(calls);
      return new StubQuery(Object.hasOwn(relations, name) ? relations[name] : undefined, name, calls);
    },
    rpc: (name: string, args?: unknown) => {
      const calls: StubCall[] = [["rpc", name, args]];
      queries.push(calls);
      const handler: StubRpc | undefined = Object.hasOwn(rpc, name) ? rpc[name] : undefined;
      return new StubRpcCall(() => {
        if (handler === undefined) {
          return { data: null, error: NO_ANSWER(`rpc ${name}`), count: null };
        }
        const { data = null, error = null } = handler(args);
        return { data, error, count: null };
      }, calls);
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}
