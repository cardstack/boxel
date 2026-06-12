import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { module, test } from 'qunit';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { evaluateRealmModules } from '../src/eval-execution.ts';
import {
  ValidationRunCache,
  WorkspaceSyncGate,
  computeWorkspaceFingerprint,
} from '../src/validation-run-cache.ts';

function makeWorkspace(): string {
  let dir = mkdtempSync(join(tmpdir(), 'validation-cache-test-'));
  writeFileSync(join(dir, 'card.gts'), 'export class Card {}', 'utf8');
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested', 'helper.gts'), 'export const x = 1;');
  return dir;
}

/** Force a content change that survives coarse mtime resolution. */
function touch(dir: string, rel: string, content: string) {
  writeFileSync(join(dir, rel), content, 'utf8');
}

module('validation-run-cache', function (hooks) {
  let workspaceDir: string;

  hooks.beforeEach(function () {
    workspaceDir = makeWorkspace();
  });

  hooks.afterEach(function () {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  module('computeWorkspaceFingerprint', function () {
    test('is stable for an unchanged workspace and changes on edit', async function (assert) {
      let a = await computeWorkspaceFingerprint(workspaceDir);
      let b = await computeWorkspaceFingerprint(workspaceDir);
      assert.strictEqual(a, b, 'unchanged workspace → same fingerprint');

      touch(workspaceDir, 'card.gts', 'export class Card { changed = true }');
      let c = await computeWorkspaceFingerprint(workspaceDir);
      assert.notStrictEqual(a, c, 'edited file → different fingerprint');
    });

    test('ignores sync bookkeeping (.boxel-history, .boxel-sync.json)', async function (assert) {
      let a = await computeWorkspaceFingerprint(workspaceDir);
      mkdirSync(join(workspaceDir, '.boxel-history'));
      touch(workspaceDir, '.boxel-sync.json', '{"files":{}}');
      touch(join(workspaceDir, '.boxel-history'), 'log', 'checkpoint');
      let b = await computeWorkspaceFingerprint(workspaceDir);
      assert.strictEqual(a, b, 'bookkeeping writes do not invalidate');
    });
  });

  module('ValidationRunCache', function () {
    test('reuses a result while unchanged, re-runs after an edit', async function (assert) {
      let cache = new ValidationRunCache(workspaceDir);
      let runs = 0;
      let run = async () => {
        runs++;
        return { runs };
      };

      let first = await cache.getOrRun('k', run);
      let second = await cache.getOrRun('k', run);
      assert.strictEqual(runs, 1, 'second call served from cache');
      assert.strictEqual(second, first, 'same object returned');

      touch(workspaceDir, 'card.gts', 'export class Card { v2 = true }');
      await cache.getOrRun('k', run);
      assert.strictEqual(runs, 2, 'edit invalidates the entry');
    });

    test('artifact-card writes under Validations/ do not invalidate (sync gate still sees them)', async function (assert) {
      // The pipeline steps write a "running" artifact card before executing
      // their engine; that write must not evict the result the agent's
      // mid-turn tool run recorded for the same source state.
      let cache = new ValidationRunCache(workspaceDir);
      let runs = 0;
      await cache.getOrRun('k', async () => ++runs);

      mkdirSync(join(workspaceDir, 'Validations'));
      touch(
        join(workspaceDir, 'Validations'),
        'eval_issue-1.json',
        '{"status":"running"}',
      );
      await cache.getOrRun('k', async () => ++runs);
      assert.strictEqual(runs, 1, 'cache survives the artifact write');

      // The sync gate uses the full fingerprint, so the artifact card still
      // triggers a real sync (it must reach the realm).
      let syncs = 0;
      let gate = new WorkspaceSyncGate(workspaceDir, async () => {
        syncs++;
        return { ok: true };
      });
      await gate.sync();
      touch(
        join(workspaceDir, 'Validations'),
        'eval_issue-2.json',
        '{"status":"passed"}',
      );
      await gate.sync();
      assert.strictEqual(syncs, 2, 'artifact write forces a sync');
    });

    test('keys are independent', async function (assert) {
      let cache = new ValidationRunCache(workspaceDir);
      let aRuns = 0;
      let bRuns = 0;
      await cache.getOrRun('a', async () => ++aRuns);
      await cache.getOrRun('b', async () => ++bRuns);
      await cache.getOrRun('a', async () => ++aRuns);
      assert.strictEqual(aRuns, 1);
      assert.strictEqual(bRuns, 1);
    });
  });

  module('WorkspaceSyncGate', function () {
    test('skips the sync when the workspace is unchanged, re-syncs after an edit or failure', async function (assert) {
      let syncs = 0;
      let nextOutcome = { ok: true };
      let gate = new WorkspaceSyncGate(workspaceDir, async () => {
        syncs++;
        return nextOutcome;
      });

      assert.deepEqual(await gate.sync(), { ok: true });
      assert.deepEqual(await gate.sync(), { ok: true });
      assert.strictEqual(syncs, 1, 'second sync skipped — nothing changed');

      touch(workspaceDir, 'card.gts', 'export class Card { v2 = true }');
      await gate.sync();
      assert.strictEqual(syncs, 2, 'edit forces a real sync');

      // A failed sync must not be treated as synced.
      touch(workspaceDir, 'card.gts', 'export class Card { v3 = true }');
      nextOutcome = { ok: false, error: 'boom' } as { ok: boolean };
      assert.false((await gate.sync()).ok);
      nextOutcome = { ok: true };
      await gate.sync();
      assert.strictEqual(
        syncs,
        4,
        'failure invalidates — next call really syncs',
      );
    });
  });

  module('cache + sync gate coherence', function () {
    test('a run against an unsynced realm is neither cached nor served later', async function (assert) {
      // Codex review scenario: the pre-validation sync fails, the engines
      // run against the stale realm, and the result must NOT be recorded
      // under the current workspace fingerprint — otherwise, after the next
      // successful sync, a cache hit would serve a verdict for code that
      // was never validated.
      let syncOk = true;
      let gate = new WorkspaceSyncGate(workspaceDir, async () =>
        syncOk ? { ok: true } : { ok: false, error: 'transient' },
      );
      let cache = new ValidationRunCache(workspaceDir, { syncGate: gate });
      let runs = 0;
      let run = async () => ({ run: ++runs });

      await gate.sync(); // realm now mirrors the workspace
      assert.deepEqual(await cache.getOrRun('k', run), { run: 1 });
      assert.deepEqual(
        await cache.getOrRun('k', run),
        { run: 1 },
        'in-sync state reuses normally',
      );

      // Edit + failed sync: realm is now stale relative to the workspace.
      touch(workspaceDir, 'card.gts', 'export class Card { v2 = true }');
      syncOk = false;
      assert.false((await gate.sync()).ok);
      assert.deepEqual(
        await cache.getOrRun('k', run),
        { run: 2 },
        'unsynced run executes (no stale hit)',
      );
      assert.deepEqual(
        await cache.getOrRun('k', run),
        { run: 3 },
        'and is not recorded — the next call runs again',
      );

      // Sync recovers: the first post-sync validation must execute for
      // real, not be served from anything recorded while unsynced.
      syncOk = true;
      assert.true((await gate.sync()).ok);
      assert.deepEqual(
        await cache.getOrRun('k', run),
        { run: 4 },
        'first run after recovery executes against the synced realm',
      );
      assert.deepEqual(
        await cache.getOrRun('k', run),
        { run: 4 },
        'then reuse resumes',
      );
    });

    test('Validations/ writes do not break sync coherence for the cache', async function (assert) {
      let gate = new WorkspaceSyncGate(workspaceDir, async () => ({
        ok: true,
      }));
      let cache = new ValidationRunCache(workspaceDir, { syncGate: gate });
      let runs = 0;

      await gate.sync();
      await cache.getOrRun('k', async () => ++runs);

      // Pipeline steps write artifact cards locally before syncing; that
      // must not flip the gate's coherence check (artifact cards are not
      // engine inputs).
      mkdirSync(join(workspaceDir, 'Validations'));
      touch(
        join(workspaceDir, 'Validations'),
        'eval_issue-1.json',
        '{"status":"running"}',
      );
      await cache.getOrRun('k', async () => ++runs);
      assert.strictEqual(runs, 1, 'cache still reuses after artifact write');
    });
  });

  module('engine memoization (evaluateRealmModules)', function () {
    test('tool and pipeline sharing one cache evaluate each module once', async function (assert) {
      let cache = new ValidationRunCache(workspaceDir);
      let evaluations = 0;
      let options = {
        targetRealm: 'http://realm.test/ws/',
        realmServerUrl: 'http://realm.test/',
        client: {} as unknown as BoxelCLIClient,
        evaluateModuleFn: async () => {
          evaluations++;
          return { passed: true };
        },
        cache,
      };
      let files = ['card.gts', 'nested/helper.gts'];

      // First run (e.g. the agent's mid-turn run_evaluate).
      let first = await evaluateRealmModules(options, files);
      // Second run over the same state (e.g. the pipeline's eval step).
      let second = await evaluateRealmModules(options, files);

      assert.strictEqual(evaluations, 2, 'each module evaluated exactly once');
      assert.deepEqual(second, first, 'cached output reused');

      // A different file set is a different key — not a stale hit.
      await evaluateRealmModules(options, ['card.gts']);
      assert.strictEqual(evaluations, 3, 'single-file run executes separately');

      // An edit invalidates.
      touch(workspaceDir, 'card.gts', 'export class Card { v2 = true }');
      await evaluateRealmModules(options, files);
      assert.strictEqual(evaluations, 5, 'edit re-evaluates the full set');
    });
  });
});
