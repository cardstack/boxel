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
//
// # Writes, and why there can be more than one block
//
// `write` names one block. `writes` names several, one per distinct kind of
// write, and writer slots take them in order. That is what lets a run put two
// identities on one realm writing different work — an expensive PATCH of a hub
// card against a cheap POST of a leaf — which is the only shape in which the
// realm's single indexing lane is observable from outside. A run with one
// block cannot produce it however many writers drive that block, because every
// write then costs the same and there is nothing for a fairness reading to
// compare.

import { readFileSync } from 'node:fs';

import { isFieldsetName, type FieldsetName } from './fieldset.ts';

export interface QuerySpec {
  label: string;
  // The wire query body, minus `realms`. Everything the workload file put
  // alongside `label` lands here untouched.
  query: Record<string, unknown>;
  // Filter fragments this shape cycles through, one per re-run, each merged
  // over `query.filter`. A shape with none asks the same question every time,
  // which the realm answers from its live-search cache after the first miss —
  // so the run measures the cache rather than what answering costs. Variants
  // are how a workload states the spread a screen actually has: one entry per
  // date a dashboard's day-scoped queries walk through, per status a filter
  // selects, per cohort a list pages over.
  //
  // They also have to be values that match rows. A fragment selecting nothing
  // is a cheap search, and a set of them reports a realm answering instantly
  // while measuring none of the work the shape does when it has an answer.
  variants?: Record<string, unknown>[];
  // The `module/name` keys this query could match, for the skip test in
  // `realm-events.ts`. `undefined` when the query has no nameable type anchor.
  typeKeys?: Set<string>;
}

// How a write block reaches the realm, which decides how much work its index
// pass does.
//
// A POST creates a card, and a card nothing links to yet invalidates only
// itself however large the realm is — so a POST block's pass visits one file.
// A PATCH updates a card that is already there, and everything linking to it
// is invalidated with it. That is the only way a workload can state the
// expensive write in a fairness run: a hub card many instances link to, whose
// pass the cheap write then waits behind.
export type WriteMethod = 'POST' | 'PATCH';

export interface WriteSpec {
  // Names this block in the fairness summary. Blocks are reported apart rather
  // than averaged, because the whole question is whether a cheap write pays an
  // expensive one's cost — an average over the two hides exactly that.
  // Defaults to the type name.
  label: string;
  method: WriteMethod;
  // POST: the collection segment written to, relative to the realm; defaults
  // to the type name, which is the convention a realm created by the CLI
  // follows. PATCH: the local path of the card to update, which has no
  // default — there is no such thing as patching a collection.
  path: string;
  adoptsFrom: { module: string; name: string };
  attributes: Record<string, unknown>;
  // This block's own write interval, overriding `--write-every-ms`. Differing
  // cadences are what give a run both halves of the fairness measurement from
  // one window: a hub every 30s and a leaf every 5s produces leaf writes that
  // land inside a hub's index pass and leaf writes that do not. Two blocks on
  // one cadence fire in lockstep and leave no uncontended baseline to compare
  // against.
  everyMs?: number;
  // The credential row that drives this block, as the Matrix localpart. This
  // is how "writer A on realm R, writer B on realm R, A ≠ B" becomes a
  // property of the workload file rather than of the order the CSV happens to
  // be in. Unpinned blocks take sessions in file order.
  username?: string;
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
  // Which document the searches ask for, and therefore which code path the run
  // measures. Absent means the driver's default; see `fieldset.ts`. A workload
  // that models a query-backed field has to pin this to `item`, because the
  // default measures a grid instead and costs several times as much.
  fieldset?: FieldsetName;
  // What the writers write, one block per distinct kind of write. Empty on a
  // read-only workload: a realm can be worth measuring and still offer no type
  // this run may write — the shared realms on a deployment are granted
  // read-only, and a derived workload omits the block rather than naming a
  // type it cannot address. `--writers 0` is then the only valid run, and
  // run-load refuses to start writers without one.
  //
  // More than one block is what a cross-writer run is made of. Writer slots
  // take blocks in order, so two blocks driven by two pinned identities put
  // two writers on one realm — the shape that makes the per-realm indexing
  // lane observable at all, and which a single block cannot produce however
  // many writers run it.
  writes: WriteSpec[];
}

// The on-disk / on-the-wire shape, before validation. `derive-workload.ts`
// builds one of these too, so a derived workload and a committed one are the
// same object validated by the same code — which is what makes an emitted file
// reproduce the run it was emitted from.
export interface RawWorkload {
  fieldset?: unknown;
  queries?: unknown;
  secondaryQueries?: unknown;
  extraQueries?: unknown;
  // One block, the spelling a single-writer workload uses and the one
  // `derive-workload.ts` emits.
  write?: unknown;
  // Several blocks. Exclusive with `write`, which is the same member said one
  // way rather than a second place to say it.
  writes?: unknown;
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
    fieldset: parseFieldset(raw.fieldset, source),
    queries: parseQueries(raw.queries, 'queries', realmUrl),
    secondaryQueries: parseQueries(
      raw.secondaryQueries,
      'secondaryQueries',
      realmUrl,
    ),
    extraQueries: parseQueries(raw.extraQueries, 'extraQueries', realmUrl),
    writes: parseWrites(raw, realmUrl, source),
  };
  if (workload.queries.length === 0) {
    throw new Error(`${source}: "queries" must list at least one query`);
  }
  return workload;
}

function parseFieldset(
  value: unknown,
  source: string,
): FieldsetName | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isFieldsetName(value)) {
    throw new Error(
      `${source}: "fieldset" must be "entries", "item", or "item-html" ` +
        `(got ${JSON.stringify(value)})`,
    );
  }
  return value;
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
    let { label, variants, ...query } = expand(entry, realmUrl) as Record<
      string,
      unknown
    >;
    if (typeof label !== 'string' || !label) {
      throw new Error(`${field}[${i}] needs a non-empty string "label"`);
    }
    if (!query.filter || typeof query.filter !== 'object') {
      throw new Error(`${field}[${i}] (${label}) needs a "filter" object`);
    }
    return {
      label,
      query,
      ...(variants === undefined
        ? {}
        : { variants: parseVariants(variants, `${field}[${i}] (${label})`) }),
      typeKeys: typeKeysOf(query),
    };
  });
}

// `variants` is validated rather than passed through, because it is the one
// member that never reaches the wire: it is merged into `filter` per re-run, so
// a malformed entry would otherwise surface as a filter the endpoint rejects on
// some later pass rather than at load.
function parseVariants(
  value: unknown,
  where: string,
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: "variants" must be a non-empty array`);
  }
  return value.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${where}: variants[${i}] must be an object`);
    }
    return entry as Record<string, unknown>;
  });
}

// The filter this shape asks on a given pass. Offset by the reader as well as
// the pass, so readers running concurrently ask different variants: in step
// they would issue one identical query, and the first answer would serve the
// rest from cache — the shape this exists to avoid. A shape with no variants
// returns its own query untouched, so the wire body is byte-identical to what
// it was before a workload named any.
export function queryForPass(
  spec: QuerySpec,
  readerIndex: number,
  pass: number,
): Record<string, unknown> {
  if (!spec.variants) {
    return spec.query;
  }
  let variant = spec.variants[(pass + readerIndex) % spec.variants.length]!;
  return {
    ...spec.query,
    filter: { ...(spec.query.filter as Record<string, unknown>), ...variant },
  };
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

// The write blocks, from either spelling. `write` is one block and `writes` is
// several; naming both would leave two answers to one question, so it is an
// error rather than a precedence rule nobody could remember.
function parseWrites(
  raw: RawWorkload,
  realmUrl: string,
  source: string,
): WriteSpec[] {
  if (raw.write !== undefined && raw.writes !== undefined) {
    throw new Error(
      `${source}: "write" and "writes" both name what the writers write; ` +
        `use "writes" for more than one block and drop "write"`,
    );
  }
  if (raw.write !== undefined) {
    return [parseWrite(raw.write, realmUrl, 'write')];
  }
  if (raw.writes === undefined) {
    return [];
  }
  if (!Array.isArray(raw.writes) || raw.writes.length === 0) {
    throw new Error(`${source}: "writes" must be a non-empty array`);
  }
  let writes = raw.writes.map((entry, i) =>
    parseWrite(entry, realmUrl, `writes[${i}]`),
  );
  // Labels key the fairness report, and two blocks sharing one would be summed
  // into a single row — which is the one thing the report exists not to do.
  let seen = new Set<string>();
  for (let write of writes) {
    if (seen.has(write.label)) {
      throw new Error(
        `${source}: two write blocks are labelled "${write.label}". Labels key ` +
          `the fairness report, so duplicates would be averaged into one row`,
      );
    }
    seen.add(write.label);
  }
  return writes;
}

function parseWrite(
  value: unknown,
  realmUrl: string,
  where: string,
): WriteSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`"${where}" must be an object`);
  }
  let write = expand(value, realmUrl) as {
    label?: unknown;
    method?: unknown;
    path?: unknown;
    everyMs?: unknown;
    username?: unknown;
    adoptsFrom?: { module?: unknown; name?: unknown };
    attributes?: unknown;
  };
  let module = write.adoptsFrom?.module;
  let name = write.adoptsFrom?.name;
  if (typeof module !== 'string' || typeof name !== 'string') {
    throw new Error(`"${where}.adoptsFrom" needs string "module" and "name"`);
  }
  let attributes = write.attributes;
  // An array passes `typeof === 'object'` and is truthy, so it has to be ruled
  // out by name or it reaches the wire as the card document's attributes.
  // `parseQueries` guards the same hazard the same way.
  if (
    attributes !== undefined &&
    (typeof attributes !== 'object' || !attributes || Array.isArray(attributes))
  ) {
    throw new Error(`"${where}.attributes" must be an object`);
  }
  let method = parseMethod(write.method, where);
  // An empty string is a string, and keeping it would send a POST to the
  // realm root with a doubled slash rather than falling back to the type name.
  let path =
    typeof write.path === 'string' && write.path ? write.path : undefined;
  if (method === 'PATCH' && !path) {
    throw new Error(
      `"${where}.path" is required for a PATCH block: it names the card to ` +
        `update, and unlike a POST's collection segment it has no default`,
    );
  }
  if (write.label !== undefined && typeof write.label !== 'string') {
    throw new Error(`"${where}.label" must be a string`);
  }
  if (write.username !== undefined && typeof write.username !== 'string') {
    throw new Error(`"${where}.username" must be a string`);
  }
  if (
    write.everyMs !== undefined &&
    (typeof write.everyMs !== 'number' ||
      !Number.isFinite(write.everyMs) ||
      write.everyMs <= 0)
  ) {
    throw new Error(`"${where}.everyMs" must be a positive number of ms`);
  }
  let spec: WriteSpec = {
    label: (write.label as string) || name,
    method,
    path: path ?? name,
    adoptsFrom: { module, name },
    attributes: (attributes ?? {}) as Record<string, unknown>,
    ...(write.everyMs === undefined
      ? {}
      : { everyMs: write.everyMs as number }),
    ...(write.username === undefined
      ? {}
      : { username: write.username as string }),
  };
  assertWriteVaries(spec, where);
  return spec;
}

function parseMethod(value: unknown, where: string): WriteMethod {
  if (value === undefined) {
    return 'POST';
  }
  if (value !== 'POST' && value !== 'PATCH') {
    throw new Error(
      `"${where}.method" must be "POST" or "PATCH" (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

// A PATCH block has to write different bytes each time. The realm leaves an
// unchanged card's file exactly as it is, so a patch that re-sends the stored
// values persists nothing and no index pass runs — the block would sit in the
// run contributing no work while the summary reported it as a writer. That is
// the shape of a null result that reads like a measurement, so it is refused
// at load rather than discovered by reading a fairness table full of zeroes.
//
// A POST needs no such check: it creates a new card per write whatever the
// attributes say.
function assertWriteVaries(write: WriteSpec, where: string): void {
  if (write.method !== 'PATCH') {
    return;
  }
  if (!varies(write.attributes)) {
    throw new Error(
      `"${where}" is a PATCH whose attributes are the same on every write. ` +
        `The realm leaves an unchanged card alone, so no index pass would run ` +
        `and the block would contribute nothing. Use \${n} — the per-write ` +
        `counter — in at least one attribute. \${date} does not count: it is ` +
        `the same string for every write in a run`,
    );
  }
}

function varies(value: unknown): boolean {
  if (typeof value === 'string') {
    // `${n}` only. `${date}` is today, which is the same string for every
    // write in a run — a block varying by nothing else would resend identical
    // attributes after its first patch, persist nothing, run no index pass,
    // and still count as a write in the fairness ledger.
    return value.includes('${n}');
  }
  if (Array.isArray(value)) {
    return value.some(varies);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(varies);
  }
  return false;
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
