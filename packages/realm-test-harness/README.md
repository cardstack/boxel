# @cardstack/realm-test-harness

Spin up a complete, hermetic Boxel stack — Synapse, Postgres, prerender,
worker-manager, realm-server, and host-dist — against one or more fixture
realm directories, with every port dynamically allocated. Returns a handle
for making authenticated requests against the running realms and tearing
it all down again.

## What it gives you

`startFactoryRealmServer` returns a stack that is byte-identical to what
production runs:

* a Synapse Matrix server in Docker
* a Postgres database cloned from a migrated template
* a prerender server (real FastBoot, real Chrome workers)
* a worker-manager + worker process
* a realm-server child process serving:
  * the **base realm** (`packages/base/`) — always mounted by the harness
  * each realm in your `realms[]` array
* host-dist mounted on the realm-server for static asset serving

The skills realm (`packages/skills-realm/contents/`) is **opt-in** —
mounted only when `TEST_HARNESS_INCLUDE_SKILLS=1`. Tests and benches
that don't reach for skill cards leave it off and avoid paying for its
indexing.

The harness also exposes a stable `http://localhost:4205/<path>/` legacy
alias for every user realm so JSON fixtures or external code that still
hardcodes the legacy port keep resolving even though every stack actually
binds to a dynamic port.

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
  realms: [
    { dir: '/path/to/your/fixture/realm', path: 'test/' },
  ],
});

let token = realm.createBearerToken();
let response = await fetch(new URL('SomeCard/instance-1', realm.realmURL), {
  headers: { Accept: 'application/vnd.card+json', Authorization: `Bearer ${token}` },
});

await realm.stop();
```

The first entry in `realms[]` is the **primary** realm: the returned
`StartedFactoryRealm.realmURL` and `cardURL(...)` resolve relative to it,
and `createBearerToken()` issues a token for it. Subsequent entries are
mounted on the same realm-server and reachable at their respective
`path` values via `realm.realmServerURL`.

The returned handle:

```ts
interface StartedFactoryRealm {
  realmDir: string;             // primary realm fixture dir
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

## RealmConfig

Each entry in `realms[]` is a `RealmConfig`:

```ts
interface RealmConfig {
  dir: string;                                    // fixture realm directory
  path: string;                                   // mount path, e.g. 'test/'
  permissions?: RealmPermissions;                 // defaults to public-read + owner-write
  fileFilter?: (relativePath: string) => boolean; // narrow which fixture files copy
  username?: string;                              // realm-server --username; default 'test_realm_${i}'
}
```

Use `fileFilter` when you want a realm to expose only its card
definitions (for example, when a "platform" realm provides `.gts` modules
that other realms adopt from but the platform's own instance data isn't
relevant to the test).

## The `https://test-harness.test/` placeholder

Every harness instance binds its realm-server to a dynamic port, so the
absolute URL of every realm is different on every run. To let fixture
JSON refer to those moving URLs without templating each file at runtime,
the harness recognises a single well-known placeholder:

```
https://test-harness.test/
```

When the harness copies your fixture into the tmpdir, it walks every
JSON file and replaces every occurrence with the actual ephemeral
**realm-server** URL for that stack. So a fixture that adopts a card
from the realm mounted at `software-factory/` writes:

```jsonc
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "module": "https://test-harness.test/software-factory/eval-result",
        "name": "EvalResult"
      }
    }
  }
}
```

Lands at runtime as `http://localhost:NNNN/software-factory/eval-result`
where `NNNN` is the per-stack realm-server port. Two harnesses running
side-by-side each rewrite the same placeholder to their own port —
that's how cross-realm references stay consistent across the
dynamically-allocated stacks.

The placeholder is purely textual — `String.split` / `join` on the
literal value, no URL parsing — so anything in the fixture JSON that
contains the placeholder string gets rewritten, even values nested in
unusual places.

## Multiple realms in one stack

Pass them all in the `realms[]` array:

```ts
import {
  ensureCombinedFactoryRealmTemplate,
  startFactoryRealmServer,
} from '@cardstack/realm-test-harness';

let realms = [
  { dir: '/path/to/realm-a', path: 'test/' },                  // primary
  { dir: '/path/to/realm-b', path: 'realm-b/' },
  { dir: '/path/to/realm-c', path: 'realm-c/', fileFilter: cardDefinitionsOnly },
];

let { templateDatabaseName } = await ensureCombinedFactoryRealmTemplate(realms);

let realm = await startFactoryRealmServer({
  realms,
  templateDatabaseName,
});
```

`ensureCombinedFactoryRealmTemplate` builds (or reuses) a single
template database that has every fixture pre-indexed; subsequent runs
clone it instead of re-indexing each realm one at a time. The cache key
is the combined content hash plus per-realm permissions, so any change
to any of the fixtures invalidates the template and forces a rebuild.

`packages/software-factory/src/cli/cache-realm.ts` is the canonical
example — it routes its incoming list of realm dirs through
`ensureCombinedFactoryRealmTemplate`.

## Template DB cache

The harness caches a fully-indexed template database keyed by the
content hash of every realm in `realms[]`, plus per-realm permissions,
plus `CACHE_VERSION`. Subsequent runs against the same set of fixtures
clone the template and skip re-indexing — cold-start goes from minutes
to seconds.

If your test depends on something *outside* the cache key (e.g. host
code that produces the schema in `Definition.fieldDefs`), set
`TEST_HARNESS_CACHE_SALT` to a value that changes when that input
changes. Any change to the salt invalidates the template and forces a
fresh build.

## Common env vars

| Var | Meaning |
| --- | --- |
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
