# Disallow a realm-server test module that brings up realms before every test without a template database, which indexes them from scratch each time (`@cardstack/boxel/realm-server-test-template-database`)

<!-- end auto-generated rule header -->

A realm-server test module that brings up realms in `setupDB`'s `beforeEach`
starts each test on an empty database, so it indexes its realms from scratch
before every test. That index, not the test body, is usually most of the
module's time. Nothing else flags the pattern, so it spreads when a suite is
copied as a starting point.

This rule reports two forms:

- A `setupDB(hooks, { beforeEach })` call that passes no `templateDatabase`
  when its `beforeEach` brings up realms. It does so when it calls
  `runTestRealmServer`, `runTestRealmServerWithRealms` or
  `startSimpleRealmServer`, or calls `start()` on
  a realm that `createRealm` returned, either directly or through functions
  declared in the same file. The rule does not follow imports, and it ignores
  a starter named only in a type.
- A call to `setupPermissionedRealm` or `setupPermissionedRealms` without
  `mode: 'before'`. Both default to `mode: 'beforeEach'` with no template. Use
  the `Cached` variant of the same helper instead.

An import is matched by the name it imports, so an alias or a namespace member
counts, for `setupDB` as for the starters. The rule leaves alone options it
cannot read: a variable, a spread, or a `mode` that is not a string literal.

The rule checks only that a `templateDatabase` is there (and is not
`undefined`), not what the template holds. A template that holds only some of
the module's realms, such as one with only the base realm, passes the rule
while the other realms still index before every test. `build` must bring up
every realm `beforeEach` does.

## Fix

Index once per module into a template database, and start each test from a
copy of it. All three helpers are in `packages/realm-server/tests/helpers/index.ts`.

| The module brings up                                       | Use                             |
| ---------------------------------------------------------- | ------------------------------- |
| One realm                                                  | `setupPermissionedRealmCached`  |
| Several realms, each on its own realm server               | `setupPermissionedRealmsCached` |
| Several realms on one realm server, or any other own setup | `setupTestDatabaseTemplate`     |

```ts
let templateDatabase = setupTestDatabaseTemplate(hooks, {
  key: import.meta.filename,
  build: async (args) => {
    await start(args);
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

The realm-server-test-setup skill (`.claude/skills/realm-server-test-setup`)
explains the `key`, what `build` must bring up, and why `start` must write a
fresh realm directory each time.

## When to disable

Disable the rule only for a module whose subject is the boot index itself:
indexing from an empty database, `fullIndexOnStartup`, or what a realm does
when its index is missing. Give the reason in the comment:

```ts
setupDB(hooks, {
  // eslint-disable-next-line @cardstack/boxel/realm-server-test-template-database -- tests indexing from an empty database
  beforeEach: async (dbAdapter, publisher, runner) => {
    await start({ dbAdapter, publisher, runner });
  },
});
```

A test that changes realm files is not a reason. Write through the realm
(`realm.write`, then `await realm.indexing()`), and the index follows.

## Examples

Incorrect:

```ts
setupDB(hooks, {
  beforeEach: async (dbAdapter, publisher, runner) => {
    await runTestRealmServer({ dbAdapter, publisher, runner });
  },
});
```

Correct:

```ts
setupDB(hooks, {
  templateDatabase,
  beforeEach: async (dbAdapter, publisher, runner) => {
    await runTestRealmServer({ dbAdapter, publisher, runner });
  },
});

// Brought up once for the module; tests share the realms.
setupDB(hooks, {
  before: async (dbAdapter, publisher, runner) => {
    await runTestRealmServer({ dbAdapter, publisher, runner });
  },
});
```
