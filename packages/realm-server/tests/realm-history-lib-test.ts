import QUnit from 'qunit';
const { module, test, skip } = QUnit;
import { basename, join } from 'path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import fsExtra from 'fs-extra';
const { mkdtempSync, writeFileSync, removeSync, mkdirSync, existsSync } =
  fsExtra;
import {
  RealmHistoryManager,
  isValidHistoryPath,
  isValidRevisionId,
} from '../lib/realm-history.ts';

// Unit tests for the jj history sidecar (BPM Phase 0R). These drive the real
// jj binary against throwaway repos — no realm server, no postgres. When jj
// isn't installed the suite skips rather than fails, since the sidecar itself
// is opt-in.

let hasJJ = (() => {
  try {
    execFileSync(process.env.JJ_BIN ?? 'jj', ['--version'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();

let jjTest = hasJJ ? test : skip;

module(basename(import.meta.filename), function (hooks) {
  let dir: string;
  let manager: RealmHistoryManager;

  hooks.beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'realm-history-test-'));
    manager = new RealmHistoryManager({ debounceMs: 10 });
  });

  hooks.afterEach(function () {
    removeSync(dir);
  });

  module('validation', function () {
    test('revision ids are strictly lowercase alphanumeric', function (assert) {
      assert.true(isValidRevisionId('nqwytwlyptln'));
      assert.true(isValidRevisionId('37ce53a5'));
      assert.false(isValidRevisionId(''));
      assert.false(isValidRevisionId('x..y'));
      assert.false(isValidRevisionId('@-'));
      assert.false(isValidRevisionId('all()'));
      assert.false(isValidRevisionId('A1B2'));
    });

    test('history paths reject traversal and absolute forms', function (assert) {
      assert.true(isValidHistoryPath('Card/instance.json'));
      assert.true(isValidHistoryPath('module.gts'));
      assert.false(isValidHistoryPath('/etc/passwd'));
      assert.false(isValidHistoryPath('../outside.json'));
      assert.false(isValidHistoryPath('a/../../b'));
      assert.false(isValidHistoryPath(''));
      assert.false(isValidHistoryPath('a//b'));
    });
  });

  module('seal and list', function () {
    jjTest(
      'sealing a dirty working copy yields a listed change',
      async function (assert) {
        writeFileSync(join(dir, 'a.json'), '{"v":1}');
        let changeId = await manager.seal(dir, 'first save');
        assert.ok(changeId, 'seal returned a changeId');
        assert.true(existsSync(join(dir, '.jj')), 'jj repo was initialized');
        assert.true(
          existsSync(join(dir, '.git')),
          'colocated git backend exists (future mirror source)',
        );

        let history = await manager.list(dir);
        assert.strictEqual(history.length, 1);
        assert.strictEqual(history[0].changeId, changeId);
        assert.strictEqual(history[0].description, 'first save');
        assert.deepEqual(history[0].filesSummary, ['A a.json']);
      },
    );

    jjTest('sealing a clean working copy is a no-op', async function (assert) {
      writeFileSync(join(dir, 'a.json'), '{"v":1}');
      await manager.seal(dir, 'first save');
      let again = await manager.seal(dir, 'nothing changed');
      assert.strictEqual(again, undefined, 'no empty changes are minted');
      let history = await manager.list(dir);
      assert.strictEqual(history.length, 1);
    });

    jjTest('debounced mutations seal as one change', async function (assert) {
      writeFileSync(join(dir, 'a.json'), '{"v":1}');
      writeFileSync(join(dir, 'b.json'), '{"v":2}');
      manager.noteMutation(dir, 'a.json');
      manager.noteMutation(dir, 'b.json');
      await new Promise((resolve) => setTimeout(resolve, 100));
      let history = await manager.list(dir);
      assert.strictEqual(history.length, 1, 'one sealed change for the batch');
      assert.true(
        history[0].description.startsWith('save: '),
        `description names the batch: ${history[0].description}`,
      );
      assert.strictEqual(history[0].filesSummary.length, 2);
    });
  });

  module('fileAt', function () {
    jjTest(
      'returns content at a prior change, undefined when absent',
      async function (assert) {
        writeFileSync(join(dir, 'a.json'), 'original');
        let first = (await manager.seal(dir, 'first'))!;
        writeFileSync(join(dir, 'a.json'), 'updated');
        await manager.seal(dir, 'second');

        let atFirst = await manager.fileAt(dir, first, 'a.json');
        assert.strictEqual(atFirst?.toString('utf8'), 'original');
        let missing = await manager.fileAt(dir, first, 'nope.json');
        assert.strictEqual(missing, undefined);
        let badId = await manager.fileAt(dir, 'not a rev!', 'a.json');
        assert.strictEqual(badId, undefined);
      },
    );
  });

  module('restore plan', function () {
    jjTest(
      'modify + add + delete + rename map to writes and deletes',
      async function (assert) {
        mkdirSync(join(dir, 'sub'));
        writeFileSync(join(dir, 'kept.json'), 'kept-v1');
        writeFileSync(join(dir, 'doomed.json'), 'doomed');
        writeFileSync(join(dir, 'sub', 'named.json'), 'named');
        let target = (await manager.seal(dir, 'the good state'))!;

        writeFileSync(join(dir, 'kept.json'), 'kept-v2');
        removeSync(join(dir, 'doomed.json'));
        writeFileSync(join(dir, 'added-later.json'), 'later');
        removeSync(join(dir, 'sub', 'named.json'));
        writeFileSync(join(dir, 'sub', 'renamed.json'), 'named');
        await manager.seal(dir, 'the drifted state');

        let plan = await manager.restorePlan(dir, target);
        assert.deepEqual(
          plan.writes.sort(),
          ['doomed.json', 'kept.json', 'sub/named.json'],
          'writes: the modification, the re-add, and the rename target',
        );
        assert.deepEqual(
          plan.deletes.sort(),
          ['added-later.json', 'sub/renamed.json'],
          'deletes: the later add and the rename source',
        );
      },
    );

    jjTest(
      'a replayed plan seals as a NEW change — history stays append-only',
      async function (assert) {
        writeFileSync(join(dir, 'a.json'), 'v1');
        let target = (await manager.seal(dir, 'v1'))!;
        writeFileSync(join(dir, 'a.json'), 'v2');
        await manager.seal(dir, 'v2');

        // replay the plan the way the handler does: write the target content
        // back, then seal
        let plan = await manager.restorePlan(dir, target);
        for (let path of plan.writes) {
          let content = (await manager.fileAt(dir, target, path))!;
          writeFileSync(join(dir, path), content);
        }
        let restored = await manager.seal(dir, `restore from ${target}`);
        assert.ok(restored, 'restore sealed a change');
        assert.notStrictEqual(restored, target, 'a NEW changeId was minted');

        let history = await manager.list(dir);
        assert.strictEqual(history.length, 3, 'nothing was rewritten');
        assert.strictEqual(history[0].changeId, restored);
        let current = await manager.fileAt(dir, restored!, 'a.json');
        assert.strictEqual(current?.toString('utf8'), 'v1');
      },
    );

    jjTest('rejects an invalid revision id', async function (assert) {
      writeFileSync(join(dir, 'a.json'), 'v1');
      await manager.seal(dir, 'v1');
      await assert.rejects(
        manager.restorePlan(dir, 'all()'),
        /invalid revision id/,
      );
    });
  });
});
