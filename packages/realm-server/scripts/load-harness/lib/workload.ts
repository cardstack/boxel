// The workload file: which queries the simulated readers issue and what the
// simulated writers write. It is data rather than code because the shapes that
// matter belong to whichever realm is under test — the harness is the driver,
// the workload is the realm's own dashboard transcribed into it.
//
// Transcribe, do not guess. The point of a run is the cost of the queries a
// real screen issues, so read them out of the card source (the `load()` /
// `loadData()` bodies, the query-backed fields) rather than inventing a
// plausible set. A workload that asks for less than the screen does measures
// nothing.
//
// # The wire grammar
//
// `_federated-search` speaks the ENTRY grammar, not the card-query grammar
// cards are written in. The host translates on the way out
// (`searchEntryWireQueryFromQuery`): the type anchor `type` / `on` becomes
// `item.on`, and every field path inside `eq` / `contains` / `in` / `range`
// gains an `item.` prefix. Sending the card spelling gets a 400:
//
//   unknown filter member "type" — the type anchor is item.on
//
// So a workload file is written in the wire grammar. Each query entry is sent
// as-is apart from its `label`, with `realms` added, which means any wire
// query the endpoint accepts is expressible here — `sort` and `page` included.
//
// # Substitution
//
// `${realm}` in any string expands to the realm URL under test, with its
// trailing slash, so a workload file is portable across clones of the same
// realm. Write attributes additionally expand `${n}` (a per-writer counter, so
// successive writes differ) and `${date}` (today as `YYYY-MM-DD`).

import { readFileSync } from 'node:fs';

export interface QuerySpec {
  label: string;
  // The wire query body, minus `realms`. Everything the workload file put
  // alongside `label` lands here untouched.
  query: Record<string, unknown>;
  // The `module/name` keys this query could match, for the skip test in
  // `realm-events.ts`. `undefined` when the query has no nameable type anchor.
  typeKeys?: Set<string>;
}

export interface WriteSpec {
  // Collection segment POSTed to, relative to the realm. Defaults to the type
  // name, which is the convention a realm created by the CLI follows.
  path: string;
  adoptsFrom: { module: string; name: string };
  attributes: Record<string, unknown>;
}

export interface Workload {
  // Fired by every reader on first render and on every re-run. This is the
  // dashboard set — the queries whose cost the run is about.
  queries: QuerySpec[];
  // Fired by a fraction of readers in addition, standing in for a second
  // screen open elsewhere in the cohort.
  secondaryQueries: QuerySpec[];
  // Fired only under `--extra-queries`. The place for a narrowed counterpart
  // to one of the unbounded shapes above, so a single run measures the same
  // question asked both ways.
  extraQueries: QuerySpec[];
  // Absent on a read-only workload. A realm can be worth measuring and still
  // offer no type this run may write — the shared realms on a deployment are
  // granted read-only, and a derived workload omits the block rather than
  // naming a type it cannot address. `--writers 0` is then the only valid run,
  // and run-load refuses to start writers without it.
  write?: WriteSpec;
}

// The on-disk / on-the-wire shape, before validation. `derive-workload.ts`
// builds one of these too, so a derived workload and a committed one are the
// same object validated by the same code — which is what makes an emitted file
// reproduce the run it was emitted from.
export interface RawWorkload {
  queries?: unknown;
  secondaryQueries?: unknown;
  extraQueries?: unknown;
  write?: unknown;
}

export function loadWorkload(path: string, realmUrl: string): Workload {
  let raw: RawWorkload;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as RawWorkload;
  } catch (e) {
    throw new Error(`Could not read workload file ${path}: ${errorMessage(e)}`);
  }
  return parseWorkload(raw, realmUrl, path);
}

// `source` names whatever produced `raw`, so a validation failure says where to
// go and fix it.
export function parseWorkload(
  raw: RawWorkload,
  realmUrl: string,
  source: string,
): Workload {
  let workload: Workload = {
    queries: parseQueries(raw.queries, 'queries', realmUrl),
    secondaryQueries: parseQueries(
      raw.secondaryQueries,
      'secondaryQueries',
      realmUrl,
    ),
    extraQueries: parseQueries(raw.extraQueries, 'extraQueries', realmUrl),
    write:
      raw.write === undefined ? undefined : parseWrite(raw.write, realmUrl),
  };
  if (workload.queries.length === 0) {
    throw new Error(`${source}: "queries" must list at least one query`);
  }
  return workload;
}

function parseQueries(
  value: unknown,
  field: string,
  realmUrl: string,
): QuerySpec[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`"${field}" must be an array of query objects`);
  }
  return value.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${field}[${i}] must be an object`);
    }
    let { label, ...query } = expand(entry, realmUrl) as Record<
      string,
      unknown
    >;
    if (typeof label !== 'string' || !label) {
      throw new Error(`${field}[${i}] needs a non-empty string "label"`);
    }
    if (!query.filter || typeof query.filter !== 'object') {
      throw new Error(`${field}[${i}] (${label}) needs a "filter" object`);
    }
    return { label, query, typeKeys: typeKeysOf(query) };
  });
}

// The `module/name` keys a query could match. `item.on` is the entry grammar's
// type anchor, and it is the only place a query names a type — a query without
// one cannot be skipped and re-runs unconditionally.
function typeKeysOf(query: Record<string, unknown>): Set<string> | undefined {
  let filter = query.filter as Record<string, unknown> | undefined;
  let anchor = filter?.['item.on'] as
    | { module?: unknown; name?: unknown }
    | undefined;
  if (typeof anchor?.module !== 'string' || typeof anchor?.name !== 'string') {
    return undefined;
  }
  return new Set([typeKey(anchor.module, anchor.name)]);
}

// The spelling the indexer stamps on a row, which is what a realm event's
// invalidated-type set contains.
export function typeKey(module: string, name: string): string {
  return `${module}/${name}`;
}

function parseWrite(value: unknown, realmUrl: string): WriteSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('"write" must be an object');
  }
  let write = expand(value, realmUrl) as {
    path?: unknown;
    adoptsFrom?: { module?: unknown; name?: unknown };
    attributes?: unknown;
  };
  let module = write.adoptsFrom?.module;
  let name = write.adoptsFrom?.name;
  if (typeof module !== 'string' || typeof name !== 'string') {
    throw new Error('"write.adoptsFrom" needs string "module" and "name"');
  }
  let attributes = write.attributes;
  if (
    attributes !== undefined &&
    (typeof attributes !== 'object' || !attributes)
  ) {
    throw new Error('"write.attributes" must be an object');
  }
  return {
    path: typeof write.path === 'string' ? write.path : name,
    adoptsFrom: { module, name },
    attributes: (attributes ?? {}) as Record<string, unknown>,
  };
}

// Recursive `${realm}` expansion over every string in the tree.
function expand(value: unknown, realmUrl: string): unknown {
  if (typeof value === 'string') {
    return value.replaceAll('${realm}', realmUrl);
  }
  if (Array.isArray(value)) {
    return value.map((v) => expand(v, realmUrl));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expand(v, realmUrl)]),
    );
  }
  return value;
}

// Per-write expansion of the placeholders that vary between writes. Applied at
// write time rather than load time so each write produces a distinct card and
// the index actually has something to invalidate.
export function writeAttributes(
  write: WriteSpec,
  n: number,
): Record<string, unknown> {
  let today = new Date().toISOString().slice(0, 10);
  let substitute = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.replaceAll('${n}', String(n)).replaceAll('${date}', today);
    }
    if (Array.isArray(value)) {
      return value.map(substitute);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, substitute(v)]),
      );
    }
    return value;
  };
  return substitute(write.attributes) as Record<string, unknown>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
