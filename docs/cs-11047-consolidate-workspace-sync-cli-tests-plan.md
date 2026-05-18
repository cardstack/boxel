# CS-11047 — Consolidate workspace-sync-cli integration tests into boxel-cli CI job

Linear: <https://linear.app/cardstack/issue/CS-11047>
Branch: `cs-11047-consolidate-workspace-sync-cli-integration-tests-into-boxel`

## Context

`packages/workspace-sync-cli` and `packages/boxel-cli` each ship their own integration test suite hitting a real realm-server, with their own CI job. The split is historical — workspace-sync-cli predates boxel-cli. The boxel-cli job is meaningfully more robust: dedicated pre-seeded PG on port `55436`, a readiness gate, and `mise run test-services:matrix` for the surrounding stack. The workspace-sync-cli job manually spawns PG on port `5435` without a readiness gate (the cause of the flake fixed in PR #4666, commit `2950dfd256`).

This ticket folds all workspace-sync-cli **integration coverage** into the `boxel-cli-test` job and deletes the standalone `workspace-sync-cli-test` job. The package source and its build/publish pipeline are **explicitly out of scope** per the ticket body — `workspace-sync-cli-build` stays.

Outcome: one CI job covers both CLIs' integration suites; every retained qunit case has a vitest counterpart; no regression in coverage; the `workspace-sync-cli-test` job is gone from `ci.yaml`.

## What the source actually covers

`packages/workspace-sync-cli/tests/integration-test.ts` (lines 1–634, qunit) — single `module('Workspace Sync CLI Integration Tests')` with seven cases. **Case 6 is intentionally dropped** — it tests workspace-sync-cli's behavior of deriving a Matrix password from `REALM_SECRET_SEED` when `MATRIX_PASSWORD` is unset. boxel-cli does not replicate that flow: credentials are captured up-front through `boxel profile add` and stored in the profile, so there is no seed-derivation code path to test.

| # | Line | Case | Verdict after audit |
| - | - | - | - |
| 1 | 227 | Pull files from realm to local directory | **DROP** — covered by `realm-pull.test.ts:56` ("pulls seeded files into an empty local directory") |
| 2 | 267 | Push modified files from local to realm | **DROP** — covered by `realm-push.test.ts:153, 194` (push + incremental push) |
| 3 | 336 | Pull with `--delete` removes extra local files | **DROP** — covered by `realm-pull.test.ts:123` ("removes local files missing from the realm when --delete is set") |
| 4 | 379 | Push with `--dry-run` does not modify realm | **DROP** — covered by `realm-push.test.ts:328` ("push with --dry-run makes no changes...") |
| 5 | 430 | Syncs `.realm.json` files in both directions | **DROP** — deliberate design change. boxel-cli treats `.realm.json` as a protected file (`realm-sync.test.ts:441` enforces "protected files (.realm.json) are never synced"), and CS-11131 is phasing the sidecar out entirely. |
| 6 | 519 | `REALM_SECRET_SEED` password derivation | **DROP** — boxel-cli uses `boxel profile add` for credentials; no equivalent code path. |
| 7 | 563 | Respects `.boxelignore` patterns | **PORT** — boxel-cli supports `.boxelignore` (`src/lib/realm-sync-base.ts:697`) but has no integration test for it. |

Setup model: `hooks.before` spawns one realm server on port `4205` via `tests/helpers/start-test-realm.ts`, which itself spawns mock prerender, worker-manager, and realm-server as child processes talking over IPC. CLI is invoked via `spawn('node', [dist/push.js])` and assertions check exit code + stdout.

## What the destination already has

`packages/boxel-cli/tests/integration/` — 24 vitest specs. Setup pattern:

```ts
import '../helpers/setup-realm-server';
import { startTestRealmServer } from '../helpers/integration';

beforeAll(async () => {
  ({ realms, testRealmHttpServer } = await startTestRealmServer({ fileSystem: { … } }));
});
afterAll(async () => { await testRealmHttpServer.close(); });
```

`startTestRealmServer` (`tests/helpers/integration.ts`) wraps `packages/realm-server/tests/helpers/index.ts → runTestRealmServerWithRealms(...)`. In-process Realm API, optional embedded worker — no spawned ts-node subprocesses, no IPC handshake. Tests call boxel-cli command functions directly and assert on return value + filesystem state.

`tests/scripts/run-integration-with-test-pg.sh` runs:

```bash
"${REALM_SERVER_SCRIPTS}/prepare-test-pg.sh"
trap '"${REALM_SERVER_SCRIPTS}/stop-test-pg.sh"' EXIT INT TERM
NODE_NO_WARNINGS=1 PGPORT=55436 vitest run \
  --pool=forks --poolOptions.forks.singleFork tests/integration/**
```

`singleFork` keeps the shared-realm pattern compatible.

## The `start-test-realm.ts` decision

**Replace.** Reasons:

- The spawn+IPC approach is the same shape that caused the bug fixed in `2950dfd256`.
- boxel-cli's in-process helper has stronger cleanup: `testRealmHttpServer.close()` is awaited; no orphaned `ts-node`.
- We get free reuse of `fileSystem: { … }` seeding — fixtures become JS objects, not `fs.writeFile` calls.

`start-test-realm.ts` is not migrated. It dies with the rest of `packages/workspace-sync-cli/tests/`.

## Implementation steps

### Step 1 — Audit existing coverage (done)

See the case table above. Cases 1–6 each map to existing coverage or a deliberate design decision. Only case 7 (`.boxelignore`) needs porting.

### Step 2 — Port case 7 to vitest

Add a `it('respects .boxelignore patterns', …)` block inside the existing `describe('realm push (integration)', …)` in `packages/boxel-cli/tests/integration/realm-push.test.ts`. Use the existing helpers (`makeLocalDir`, `writeLocalFile`, `createTestRealm`, `push(...)`) and assert that:

- A file listed in `.boxelignore` is not uploaded to the realm.
- Files not matched by the pattern are uploaded normally.
- The `.boxelignore` file itself is not uploaded.

Mechanical translations:
- `module('…', hooks)` → `describe('…', () => { … })`
- `hooks.before/after` → `beforeAll/afterAll`
- `hooks.beforeEach/afterEach` → `beforeEach/afterEach`
- `test('…', async (assert) => { … })` → `it('…', async () => { … })`
- `assert.strictEqual(a, b)` → `expect(a).toBe(b)`
- `assert.deepEqual(a, b)` → `expect(a).toEqual(b)`
- `assert.ok(x)` → `expect(x).toBeTruthy()`

**Big semantic change:** replace `spawn('node', [dist/push.js])` with direct in-process function calls. Qunit asserts on exit code + stdout regex; vitest asserts on return value + filesystem state.

### Step 3 — Delete the moved source

```bash
rm packages/workspace-sync-cli/tests/integration-test.ts
rm packages/workspace-sync-cli/tests/index.ts
rm -rf packages/workspace-sync-cli/tests/helpers/
rmdir packages/workspace-sync-cli/tests/
```

In `packages/workspace-sync-cli/package.json`: remove the `test` script and `qunit` + `@types/qunit` devDeps. Run `pnpm install` to update the lockfile.

### Step 4 — Remove the standalone CI job

Edit `.github/workflows/ci.yaml`:

- Delete the `workspace-sync-cli-test` job block (lines ~881–930).
- Drop the dead `needs.change-check.outputs.workspace-sync-cli == 'true'` clause from the `test-web-assets` consumers' `if:` at line ~160. The `workspace-sync-cli-build` job (lines ~866–880) does not consume test web assets.
- Keep change-check outputs and the filter — `workspace-sync-cli-build` still uses them.

### Step 5 — Local verification

```bash
pnpm install
pnpm --filter @cardstack/boxel-cli build
pnpm --filter @cardstack/boxel-cli test:unit
pnpm --filter @cardstack/boxel-cli test:integration
```

All four must pass.

## Critical files

- `packages/workspace-sync-cli/tests/integration-test.ts` — source of truth for the 7 cases; deleted in Step 3.
- `packages/workspace-sync-cli/tests/helpers/start-test-realm.ts` — not migrated; deleted in Step 3.
- `packages/workspace-sync-cli/package.json` — Step 3 edit (remove `test` script + qunit devDeps).
- `packages/boxel-cli/tests/integration/realm-pull.test.ts` — destination for case 3.
- `packages/boxel-cli/tests/integration/realm-push.test.ts` — destination for cases 4, 7.
- `packages/boxel-cli/tests/integration/realm-sync.test.ts` — destination for case 5.
- `packages/boxel-cli/tests/helpers/integration.ts` — `startTestRealmServer` wrapper; reused.
- `packages/boxel-cli/tests/scripts/run-integration-with-test-pg.sh` — reused per the ticket.
- `.github/workflows/ci.yaml` — Step 4 edits.

## Acceptance

- [ ] `Boxel CLI Tests` is the single CI job covering both suites.
- [ ] Cases 1–5, 7 each map to a vitest spec or an explicit "covered by existing test X" note. Case 6 documented as deliberately dropped.
- [ ] `workspace-sync-cli-test` job removed from `ci.yaml`.
- [ ] `workspace-sync-cli-build` job still present and green.
- [ ] `packages/workspace-sync-cli/src/` untouched.

## Verification

1. CI Checks page: `Boxel CLI Tests` and `Workspace Sync CLI Build` pass; `Workspace Sync CLI Integration Tests` is gone.
2. Search the integration test log for the names of cases 3, 4, 5, 7 (and 1, 2 if ported).
3. After merge, `grep -rn '4205\|:5435' packages/boxel-cli/` returns nothing.
