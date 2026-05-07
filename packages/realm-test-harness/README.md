# @cardstack/realm-test-harness

Spin up a complete, hermetic Boxel stack — Synapse, Postgres, prerender,
worker-manager, realm-server, and host-dist — against a fixture realm
directory, with every port dynamically allocated. Returns a handle for
making authenticated requests against the running realm and tearing it
all down again.

## What it gives you

`startFactoryRealmServer` returns a stack that is byte-identical to what
production runs:

* a Synapse Matrix server in Docker
* a Postgres database cloned from a migrated template
* a prerender server (real FastBoot, real Chrome workers)
* a worker-manager + worker process
* a realm-server child process serving:
  * the **base realm** (`packages/base/`)
  * the **source realm** (configurable via `TEST_HARNESS_SOURCE_REALM_DIR`)
  * the **fixture realm** you passed in (`realmDir`)
  * any **additional realms** you passed via the multi-realm path (see below)
* host-dist mounted on the realm-server for static asset serving

The skills realm (`packages/skills-realm/contents/`) is **opt-in** —
mounted only when `TEST_HARNESS_INCLUDE_SKILLS=1`. Tests and benches
that don't reach for skill cards leave it off and avoid paying for its
indexing.

Everything talks over real HTTP on real (loopback) sockets. Indexing
runs through real queue round-trips. Prerender renders go through real
child-process IPC. The harness exists so a test or bench gets the full
production wire path without having to mock any of it.

## Concurrency

Every stack reserves its own dynamic ports for each child (realm-server,
worker-manager, prerender, Synapse, Postgres) and gets its own
disposable Postgres database, cloned from a shared template. Two stacks
running side-by-side never share state and never collide on a port — you
can `await Promise.all([startFactoryRealmServer(...), startFactoryRealmServer(...)])`
freely, or run independent test workers in parallel.

## When to use it (vs realm-server's qunit helpers)

`packages/realm-server/tests/helpers/index.ts` lets you instantiate a
`Realm` in-process against a SQLite-or-mock-pg adapter and a stubbed
prerenderer. That's the right tool for unit tests — fast, no Docker, no
network — but it short-circuits the layers a real GET goes through:
HTTP framing, queue round-trips, prerender child-process IPC, FastBoot
startup, the worker-manager hand-off.

Reach for `realm-test-harness` instead when:

* the test or bench needs to defend behavior on the real wire path
* you want concurrent stacks for parallel test workers
* the SUT involves cross-process IPC (worker, prerender, synapse) that
  the in-process helpers stub

## Quick start

```ts
import { startFactoryRealmServer } from '@cardstack/realm-test-harness';

let realm = await startFactoryRealmServer({
  realmDir: '/path/to/your/fixture/realm',
});

let token = realm.createBearerToken();
let response = await fetch(new URL('SomeCard/instance-1', realm.realmURL), {
  headers: { Accept: 'application/vnd.card+json', Authorization: `Bearer ${token}` },
});

await realm.stop();
```

The returned handle:

```ts
interface StartedFactoryRealm {
  realmDir: string;             // your fixture dir
  realmURL: URL;                // e.g. http://localhost:NNNN/test/
  realmServerURL: URL;          // e.g. http://localhost:NNNN/
  databaseName: string;
  childPids: number[];
  ports: { publicPort, realmServerPort, workerManagerPort };
  cardURL(path: string): string;
  createBearerToken(user?, permissions?): string;
  authorizationHeaders(user?, permissions?): Record<string, string>;
  stop(): Promise<void>;
}
```

## Fixture realm

Your `realmDir` is a regular Boxel realm directory (`.realm.json` +
`realm.json` + cards). The harness copies it into a tmpdir before
mounting so concurrent stacks don't fight over the source files.

If your fixture's cards adopt from a separate "source" realm
(card definitions live in another package), point the harness at it via:

```bash
TEST_HARNESS_SOURCE_REALM_DIR=/path/to/source-realm-cards
```

(Defaults to `<cwd>/realm`.)

## The `https://sf.boxel.test/` placeholder

Every harness instance binds its realms to dynamic ports, so the
absolute URL of the source realm is different on every run. To let
fixture JSON refer to those moving URLs without templating each file
at runtime, the harness recognises a single well-known placeholder:

```
https://sf.boxel.test/
```

Write this anywhere in your fixture's `*.json` files where you'd
normally write the source realm's absolute URL — `meta.adoptsFrom.module`,
relationship `links.self`, computed link refs, anything. When the
harness copies your fixture into the tmpdir, it walks every JSON file
and replaces every occurrence with the actual ephemeral source-realm
URL for that stack.

```jsonc
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "module": "https://sf.boxel.test/eval-result",
        "name": "EvalResult"
      }
    }
  }
}
```

Lands at runtime as `http://localhost:NNNN/source-realm-path/eval-result`
where `NNNN` is the per-stack realm-server port. Two harnesses running
side-by-side each rewrite the same placeholder to their own port —
that's how cross-realm references stay consistent across the
dynamically-allocated stacks.

The placeholder is purely textual — `String.split` / `join` on the
literal value, no URL parsing — so anything in the fixture JSON that
contains the placeholder string gets rewritten, even values nested in
unusual places.

## Multiple realms in one stack

Two patterns, depending on whether you want one stack to serve many
realms or many stacks each serving one realm.

### Pattern A — many fixtures, one stack at a time

If different tests target different fixtures (one realm per scenario),
keep all your fixture realms side-by-side under a `test-fixtures/`
directory and select per test:

```
test-fixtures/
├── darkfactory-adopter/
│   ├── .realm.json
│   ├── realm.json
│   └── *.gts / *.json
├── test-realm-runner/
│   └── …
└── public-software-factory-source/
    └── …
```

Each test points the harness at the fixture it needs:

```ts
test.use({ realmDir: resolve('test-fixtures/test-realm-runner') });
```

The harness keys its template-DB cache on the fixture's content hash
(see *Template DB cache* below), so each fixture gets its own template
on first use and clones in seconds thereafter. This is what
`packages/software-factory/test-fixtures/` does — multiple independent
fixture dirs that tests pick from.

### Pattern B — many realms in the same stack

If a single test or bench needs *more than one realm running together*
— e.g. it linksTo across realms or measures cross-realm search — build
a **combined template** and reuse it:

```ts
import {
  ensureCombinedFactoryRealmTemplate,
  startFactoryRealmServer,
} from '@cardstack/realm-test-harness';

let { templateDatabaseName } = await ensureCombinedFactoryRealmTemplate([
  { realmDir: '/path/to/realm-a', realmPath: 'test/' },        // primary
  { realmDir: '/path/to/realm-b', realmPath: 'realm-b/' },     // additional
  { realmDir: '/path/to/realm-c', realmPath: 'realm-c/' },     // additional
]);

let realm = await startFactoryRealmServer({
  realmDir: '/path/to/realm-a',
  templateDatabaseName,
});
```

`ensureCombinedFactoryRealmTemplate` builds (or reuses) a single
template database that has every fixture pre-indexed; subsequent runs
clone it instead of re-indexing each realm one at a time. The cache key
is the combined content hash, so any change to any of the fixtures
invalidates the template and forces a rebuild.

`packages/software-factory/src/cli/cache-realm.ts` is the canonical
example — it accepts multiple realm dirs on the command line and
routes them through `ensureCombinedFactoryRealmTemplate` when more than
one is given.

## Template DB cache

The harness caches a fully-indexed template database keyed by the
content hash of `realmDir` and the source realm. Subsequent runs against
the same fixture clone the template and skip re-indexing — cold-start
goes from minutes to seconds.

If your test depends on something *outside* the cache key (e.g. host
code that produces the schema in `Definition.fieldDefs`), set
`TEST_HARNESS_CACHE_SALT` to a value that changes when that input
changes. Any change to the salt invalidates the template and forces a
fresh build.

## Common env vars

| Var | Meaning |
| --- | --- |
| `TEST_HARNESS_SOURCE_REALM_DIR` | Path to the source-realm directory whose cards the fixture adopts from. |
| `TEST_HARNESS_INCLUDE_SKILLS` | Set to `1` to mount the skills realm (`packages/skills-realm/contents/`). Off by default — most tests don't need it. |
| `TEST_HARNESS_CACHE_SALT` | Mix into the template-DB cache key to force rebuilds when an out-of-band input changes. |
| `TEST_HARNESS_HOST_DIST_PACKAGE_DIR` | Override the host package directory whose `dist/` the realm-server serves. |
| `TEST_HARNESS_REALM_LOG_LEVELS` | `@cardstack/logger` levels passed to spawned realm-server / worker / prerender children. |
| `TEST_HARNESS_PGHOST` / `TEST_HARNESS_PGPORT` / `TEST_HARNESS_PGUSER` | Postgres connection overrides. Default to the dev cluster the rest of the repo uses. |

The full list of configurable env vars lives in `src/shared.ts`.

## Cleanup

Always `await realm.stop()` (and put it in a `try/finally` so a thrown
error in the test body doesn't leak children). The harness keeps a
process-exit hook that SIGKILLs `childPids` on hard process exit, but
cooperative cleanup is faster and lets the next stack reuse the freed
ports immediately.

If a previous run leaked a Synapse container, the harness detects it
on next startup and reaps it before allocating a new one.
