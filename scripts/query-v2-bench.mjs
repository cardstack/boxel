#!/usr/bin/env node
// Query V2 speed gate over a database cloned from --dump. With --engine alone,
// captures the SQL and binds each query of the set emits, once, at a fixed
// clock (--out). With --candidate too, a query whose capture is identical passes
// untimed; the rest (all, with --all) are timed in one process, the engines
// alternating run by run: at least --min each, about --ms in all, at most --max
// (--runs fixes it). Passes if the candidate's p95 is at most 1.10 times, or 5
// ms over, the baseline's, with the same rows. Other options are in `args`.
// With --check, it only parses each query of the set as `_search` would, with
// no database, and fails if the engine refuses any (a self-check for a set).
import { execFileSync as exec } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

let here = (path) => new URL(path, import.meta.url);
let args = { min: 8, max: 30, ms: 3000, warmup: 2, only: '', 'pg-bin': '' };
args.pg = 'postgres://postgres@localhost:15449';
for (let i = 2; i < process.argv.length; i++) {
  let [name, value] = [process.argv[i].slice(2), process.argv[i + 1]];
  let flag = !value || value.startsWith('--');
  args[name] = flag ? true : value;
  i += flag ? 0 : 1;
}
if (!args.queries || args.queries === true || (!args.check && !args.dump)) {
  console.error(
    'usage: query-v2-bench.mjs --queries <file> (--check --engine <dir> | --dump <file> --engine <dir> [--candidate <dir>])\n' +
      'The queries file is { realms, queries }; see packages/realm-server/tests/query-bench/example-queries.json.',
  );
  process.exit(2);
}
let pg = new URL(args.pg);
let conn = ['-h', pg.hostname, '-p', pg.port, '-U', pg.username];
let run = (cmd, rest) =>
  exec(join(args['pg-bin'], cmd), [...conn, ...rest], { encoding: 'utf8' });
let psql = (db, sql) => run('psql', ['-d', db, '-Atqc', sql]).trim();
// Restore a template from the dump (stamped by size, mtime); clone it per pass.
let [tpl, runDB] = ['qv2_bench_template', 'qv2_bench_run'];
let stamp, clone;
if (!args.check) {
  let { size, mtimeMs } = statSync(args.dump);
  stamp = `${size}-${Math.round(mtimeMs)}`;
  let stampOf = `SELECT shobj_description(oid, 'pg_database') FROM pg_database`;
  if (psql('postgres', `${stampOf} WHERE datname = '${tpl}'`) !== stamp) {
    psql('postgres', `DROP DATABASE IF EXISTS ${tpl}`);
    psql('postgres', `CREATE DATABASE ${tpl}`);
    run('pg_restore', ['-d', tpl, '-j', '4', '--no-owner', args.dump]);
    psql(tpl, 'ANALYZE');
    psql('postgres', `COMMENT ON DATABASE ${tpl} IS '${stamp}'`);
  }
  clone = () => {
    psql('postgres', `DROP DATABASE IF EXISTS ${runDB}`);
    psql('postgres', `CREATE DATABASE ${runDB} TEMPLATE ${tpl}`);
  };
  let { hostname: PGHOST, port: PGPORT, username: PGUSER } = pg;
  Object.assign(process.env, { PGHOST, PGPORT, PGUSER, PGDATABASE: runDB });
}
// An engine checkout's modules, and an engine of it over a new connection.
async function load(dir) {
  let rc = await import(join(resolve(dir), 'packages/runtime-common/index.ts'));
  let pgModule = join(resolve(dir), 'packages/postgres/index.ts');
  let { PgAdapter } = await import(pgModule);
  // The realm's search entry point, where the checkout has it (`_search`).
  let { RealmIndexQueryEngine } = await import(
    join(resolve(dir), 'packages/runtime-common/realm-index-query-engine.ts')
  ).catch(() => ({}));
  // Log queries (`from: { log }`), where the checkout has them.
  let logs = await import(
    join(resolve(dir), 'packages/runtime-common/log-query.ts')
  ).catch(() => ({}));
  let sha = exec('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
  return { rc, logs, PgAdapter, RealmIndexQueryEngine, sha };
}
async function open({ rc, logs, PgAdapter, RealmIndexQueryEngine }, capturing) {
  let db = new PgAdapter();
  if (capturing) record(db);
  let network = new rc.VirtualNetwork();
  network.addRealmMapping('@cardstack/base/', 'https://cardstack.com/base/');
  // Definitions come from the dataset's own module cache.
  let defs = new Map();
  for (let row of await db.execute('SELECT definitions FROM modules'))
    for (let [key, e] of Object.entries(row.definitions ?? {}))
      if (e?.type === 'definition') defs.set(key, e);
  let lookupDefinition = async (ref) =>
    defs.get(rc.internalKeyFor(ref, undefined, network))?.definition ??
    Promise.reject(new Error(`no definition for ${ref.module}#${ref.name}`));
  let engine = () => new rc.IndexQueryEngine(db, { lookupDefinition }, network);
  let realmEngine = (url) =>
    new RealmIndexQueryEngine({
      realm: {
        url,
        virtualNetwork: network,
        getRealmInfo: async () => ({ name: 'bench', publishable: true }),
        readLogFileForQuery: async () => undefined,
      },
      dbAdapter: db,
      fetch: globalThis.fetch,
      definitionLookup: { lookupDefinition },
    });
  return { rc, logs, db, network, engine, realmEngine };
}
// Records every statement into the running query's list: SQL and binds
// for `execute`, the expression for a transaction's (or a snapshot's) querier.
let recording = new AsyncLocalStorage();
let pending = 0;
let track = (promise) => (pending++, promise.finally(() => pending--));
function record(db) {
  let push = (statement) => recording.getStore()?.push(statement);
  let tx = (begin) => (fn, o) =>
    begin((q) => fn((e) => (push(e), track(q(e)))), o);
  let reader = (r) =>
    Object.assign(Object.create(r), {
      withTransaction: tx(r.withTransaction),
      withReadSnapshot: (fn) => fn(reader(r)),
    });
  let execute = db.execute.bind(db);
  let snapshot = db.withReadSnapshot.bind(db);
  db.execute = (sql, o) => (
    push([sql, o?.bind ?? null]),
    track(execute(sql, o))
  );
  db.withTransaction = tx(db.withTransaction.bind(db));
  db.withReadSnapshot = (fn, o) => snapshot((r) => fn(reader(r)), o);
}
// The query as `_search` answers it (realm.ts) at a fixed clock: a log query,
// or a card query with type references resolved, in wire or host form. A
// query with `grants` (wire filters) runs as for a caller the realm's policy
// scopes (an anonymous visitor): composed as realm.ts composes it.
let now = new Date('2026-11-11T00:00:00Z');
function prepare(
  { rc, logs, db, network, engine, realmEngine },
  q,
  realm,
  grants,
) {
  if (logs.isLogQuery?.(q)) {
    let opts = { now, virtualNetwork: network };
    return async () => (await logs.runLogQuery(db, realm, q, opts)).data.length;
  }
  if (!isV2(rc)) return mainSearch({ rc, engine }, q, realm, grants);
  let parsed = parseAsSearch(rc, network, q, realm, grants);
  let search = realmEngine(realm);
  return async () =>
    (await search.searchEntries(parsed, { loadLinks: true, priority: 20 })).data
      .length;
}
// A checkout with the new query schema's entry points; main and the stack's
// earlier rows have neither, and answer through main's `_search` path.
let isV2 = (rc) =>
  typeof rc.searchTypeReferenceContext === 'function' &&
  typeof rc.parseSearchEntryQueryFromPayload === 'function';
// A card query parsed as `_search` parses it (handle-search.ts): type
// references resolved against the query's realms, the item leg bounded, and a
// query with `grants` composed as for a caller the realm's policy scopes.
function parseAsSearch(rc, network, q, realm, grants) {
  let context = rc.searchTypeReferenceContext(q.realms ?? [realm], (url) =>
    network.unresolveURL(url),
  );
  let parsed = rc.parseSearchEntryQueryFromPayload(q, context);
  if (
    rc.isItemLegSearch(parsed.fieldset) ||
    rc.isCountsOnlyPage(parsed.itemQuery.page)
  ) {
    parsed.itemQuery = rc.applyServerSearchPageBound(parsed.itemQuery);
  }
  if (grants) {
    parsed = rc.policyScopedQuery(parsed, grants.map(rc.policyFilterFromWire));
  }
  return parsed;
}
// Main's `_search`: the older spelling only, through its own query check.
function mainSearch({ rc, engine }, q, realm, grants) {
  if (grants) throw new Error('this engine has no policy-scoped search');
  rc.assertQuery(q);
  let item = { filter: q.filter, sort: q.sort, page: q.page ?? { size: 500 } };
  let [url, search] = [new URL(realm), engine()];
  return async () =>
    (await search.search(url, item, {}, { kind: 'dataOnly' }, 'instance'))
      .results.length;
}
// `{realm}` names the query's realm; { $vectorOf, path } is a stored vector.
async function concrete(db, query, realm) {
  let json = JSON.stringify(query).replaceAll('{realm}', realm);
  let vectors = new Map();
  let refs = /{"\$vectorOf":"(.*?)","path":"(.*?)"}/g;
  for (let [, url, path] of json.matchAll(refs)) {
    let [row] = await db.execute(
      `SELECT embedding::text AS v FROM boxel_index_vectors
       WHERE url = $1 AND field_path = $2 ORDER BY ordinal LIMIT 1`,
      { bind: [`${url}.json`, path] },
    );
    vectors.set(`${url} ${path}`, JSON.parse(row.v));
  }
  return JSON.parse(json, (_, v) =>
    v?.$vectorOf ? vectors.get(`${v.$vectorOf} ${v.path}`) : v,
  );
}
let set = JSON.parse(readFileSync(args.queries));
let queries = set.queries.filter(({ id }) => new RegExp(args.only).test(id));
let error = (e) => ({ error: String(e?.message ?? e).slice(0, 300) });
// --check: parse each query as `_search` would, with no database; a stored
// vector ({ $vectorOf }) stands in as a zero vector.
if (args.check) {
  let { rc, logs } = await load(args.engine);
  let network = new rc.VirtualNetwork();
  network.addRealmMapping('@cardstack/base/', 'https://cardstack.com/base/');
  let stub = (v) => (v?.$vectorOf ? new Array(v.dims ?? 256).fill(0) : v);
  let refused = 0;
  for (let { id, realm, query, grants } of queries) {
    let url = set.realms[realm];
    let parse = (x) =>
      x &&
      JSON.parse(JSON.stringify(x).replaceAll('{realm}', url), (_, v) =>
        stub(v),
      );
    try {
      let q = parse(query);
      if (logs.isLogQuery?.(q)) logs.validateLogQuery(q, now);
      else {
        if (isV2(rc)) parseAsSearch(rc, network, q, url, parse(grants));
        else rc.assertQuery(q);
      }
    } catch (e) {
      refused++;
      console.log(`${id}\tREFUSED\t${error(e).error}`);
    }
  }
  console.log(`${queries.length - refused} of ${queries.length} parse`);
  process.exit(refused ? 1 : 0);
}
// Each query once on a fresh clone, through a fresh engine (no cache carries
// over from the query before), recording what it emits and its row count.
async function capture(mod) {
  clone();
  let env = await open(mod, true);
  let [sql, started] = [{}, performance.now()];
  // The engine's 30-second caches expire on `Date.now`: hold it still.
  let realNow = Date.now;
  Date.now = () => now.getTime();
  for (let { id, realm, query, grants } of queries) {
    let url = set.realms[realm];
    let q = await concrete(env.db, query, url);
    let g = grants && (await concrete(env.db, grants, url));
    let entry = (sql[id] = { statements: [] });
    try {
      entry.rows = await recording.run(
        entry.statements,
        prepare(env, q, url, g),
      );
    } catch (e) {
      Object.assign(entry, error(e));
    }
    // Work the query left running in the background (a statistics refresh) is
    // still its own: wait until no statement has been running for 100 ms.
    for (let idle = 0; idle < 5; idle = pending ? 0 : idle + 1) {
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  Date.now = realNow;
  // Background statements land in whatever order they run: sort them.
  for (let entry of Object.values(sql)) {
    entry.statements = entry.statements.map((s) => JSON.stringify(s)).sort();
  }
  await env.db.close();
  let seconds = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`${mod.sha}: captured ${queries.length} queries in ${seconds} s`);
  return sql;
}
let at = (sorted, p) => sorted[Math.ceil(p * (sorted.length - 1))];
let ms = (t) => t.toFixed(1);
let base = await load(args.engine);
let baseSQL = await capture(base);
let out = { dump: stamp, engine: base.sha, sql: baseSQL };
let failed = Object.values(baseSQL).filter((s) => s.error).length;
if (args.candidate) {
  let cand = await load(args.candidate);
  let candSQL = await capture(cand);
  let same = ({ id }) =>
    JSON.stringify(baseSQL[id]) === JSON.stringify(candSQL[id]);
  let timed = queries.filter((q) => args.all || !same(q));
  let untimed = queries.length - timed.length;
  console.log(`${untimed} identical, ${timed.length} timed`);
  out = { ...out, candidate: cand.sha, sql: undefined, timed: {} };
  out.changed = queries.filter((q) => !same(q)).map(({ id }) => id);
  clone();
  let envs = [await open(base), await open(cand)];
  for (let { id, realm, query, grants } of timed) {
    let url = set.realms[realm];
    let times = [[], []];
    let rows = [0, 0];
    let more = (i, end) =>
      args.runs
        ? i < +args.runs
        : i < args.max && (i < args.min || performance.now() < end);
    try {
      let q = await concrete(envs[0].db, query, url);
      let g = grants && (await concrete(envs[0].db, grants, url));
      let go = envs.map((env) => prepare(env, q, url, g));
      for (let i = 0; i < args.warmup; i++) for (let g of go) await g();
      // Alternate which engine goes first, so neither always runs warm.
      for (let i = 0, end = performance.now() + +args.ms; more(i, end); i++) {
        for (let k of i % 2 ? [1, 0] : [0, 1]) {
          let start = performance.now();
          rows[k] = await go[k]();
          times[k].push(performance.now() - start);
        }
      }
    } catch (e) {
      console.log(`${id}\tERROR\t${(out.timed[id] = error(e)).error}`);
      failed++;
      continue;
    }
    let [b, c] = times.map((t) => t.sort((x, y) => x - y));
    let [p95b, p95c] = [at(b, 0.95), at(c, 0.95)];
    let pass = p95c <= Math.max(1.1 * p95b, p95b + 5) && rows[0] === rows[1];
    failed += pass ? 0 : 1;
    let p50 = [at(b, 0.5), at(c, 0.5)];
    out.timed[id] = { runs: b.length, p50, p95: [p95b, p95c], rows, pass };
    let ratio = `${(p95c / p95b).toFixed(2)}x`;
    let line = `${id}\truns=${b.length}\tp95=${ms(p95b)}->${ms(p95c)}\t${ratio}`;
    line += `\trows=${rows.join('->')}\tgate=${pass ? 'pass' : 'FAIL'}`;
    console.log(line);
  }
  for (let env of envs) await env.db.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
process.exitCode = failed ? 1 : 0;
