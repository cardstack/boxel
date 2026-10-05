---
name: realm-server-test-setup
description: How to set up realms in a packages/realm-server test module without indexing them from scratch before every test — which helper to use (setupPermissionedRealmCached, setupPermissionedRealmsCached, setupTestDatabaseTemplate), when a test genuinely needs a fresh boot index, and how the template database works. Use whenever writing a new realm-server test module, adding a module or test that brings up realms, copying an existing suite as a starting point, or working out why a realm-server module is slow. Triggers on runTestRealmServer, runTestRealmServerWithRealms, setupDB with a beforeEach that starts realms, setupPermissionedRealm(s), or "realm-server tests are slow".
---

# Realm-server test setup

Bringing up a realm on an empty database indexes it from scratch, and that index — not the test body — is usually most of a realm-server test's time. A module that brings up its realms in `beforeEach` pays it once per test. Index once per module instead: every helper below builds a **template database** the first time a module needs it, and each test then starts from a copy of that template. The two cached realm helpers also give each test a fresh realm directory holding the same files. `setupTestDatabaseTemplate` copies only the database, so there the fresh directory is your `start`'s job (see below).

The cost is real. A 40-test suite that brought up two realms before every test took 524s; indexed once into a template it took 85s. Nineteen such suites together went from 46 minutes to 13 minutes of CI time, about five minutes off every Realm Server shard.

## Pick the helper

| Your module brings up                                                  | Use                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| One realm                                                              | `setupPermissionedRealmCached(hooks, { realmURL, permissions, fileSystem \| fixture, onRealmSetup })` |
| Several realms, each on its own realm server                           | `setupPermissionedRealmsCached(hooks, { realms: [...], onRealmSetup })`                               |
| Several realms on **one** realm server, or any other setup of your own | `setupTestDatabaseTemplate` beside `setupDB` (below)                                                  |

All three live in `packages/realm-server/tests/helpers/index.ts`. `setupPermissionedRealmsCached` starts every realm on its own server and virtual network, so it does not fit realms that must reach each other through one server — for example a realm whose policy card lives in another realm, which the server loads on its own authority. Use `setupTestDatabaseTemplate` for those.

### `setupTestDatabaseTemplate`

Keep the suite's own `start()`, move its teardown into a function, and hand both to the template:

```ts
async function stop() {
  for (let realm of [education, org]) {
    realm.__testOnlyClearCaches();
    realm.unsubscribe();
  }
  await closeServer(server);
  resetCatalogRealms();
}

let templateDatabase = setupTestDatabaseTemplate(hooks, {
  key: import.meta.filename,
  build: async (args) => {
    await start(args); // the same start() beforeEach calls
    return stop;
  },
});

setupDB(hooks, {
  templateDatabase,
  beforeEach: async (dbAdapter, publisher, runner) => {
    await start({ dbAdapter, publisher, runner });
  },
  afterEach: stop,
});
```

`build` runs once per key per test process, against a builder database. The helper waits for its queue to drain (index and prerender jobs both), tears it down with the function `build` returns, and snapshots the database as the template.

- **`key`** must be unique to what `build` writes, across every module in the run: the template cache is shared by the whole test process. The module's full path, `import.meta.filename`, is right when the module has one `start()`. Its `basename` is not, because modules in different directories share names (`realm-endpoints/info-test.ts` and `server-endpoints/info-test.ts`), and the second to build would silently get the first one's snapshot. A module that builds two different setups needs two keys.
- **`build` must bring up exactly what `beforeEach` does.** A realm that boots on a copy finds its index there and skips its boot index (`Realm#startup` runs one only on a new index or with `fullIndexOnStartup`). Anything `beforeEach` adds that `build` didn't is never indexed.
- **`start` must write a fresh realm directory every time it runs.** The helper copies the database and nothing else. Give each call its own directory, as the policy suites do with `realmsRootPath = join(dirSync().name, 'realm_server_1')`, and write the realm's files there. A directory reused between tests carries files an earlier test wrote into the next one, whose copy of the database knows nothing about them.
- Rows `start()` writes besides the index (realm permissions and the like) are upserts, so writing them again on a copy is safe.

## When a test still needs a fresh index

Leave a module uncached only when what it tests is the boot index itself: indexing from an empty database, `fullIndexOnStartup`, or what a realm does when its index is missing. Say so in a comment where the module brings up its realms, so the next person doesn't "fix" it.

A test that changes files during the test is not one of these. Write through the realm (`realm.write`, then `await realm.indexing()`) and the index follows, as it would on a fresh database.

## A `before` hook is not the same thing

`setupDB(hooks, { before })` brings the realms up once for the whole module and shares them between tests. That is fast, but every test sees what earlier tests wrote. Use it only when no test changes realm state. When tests do change state, a template plus a fresh directory per test keeps them isolated at nearly the same cost.

## Checking a module's cost

`packages/realm-server/tests/test-module-timings.json` on main holds each module's measured seconds. Divide by the number of `test(` calls for a per-test cost: cached modules typically run 2–4s per test, and a module paying a from-scratch index per test typically runs 6–13s. To measure one module locally, use `./scripts/measure-test-file.sh <file-without-.ts> [runs]` from `packages/realm-server`.
