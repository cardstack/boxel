import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import QUnit from 'qunit';
import type { HistoryBackend } from '@cardstack/deck-history/backend';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import { NodeAdapter } from '../node-realm.ts';
import {
  HostSaveCommitter,
  deckSaveRecorder,
} from '../lib/deck-save-history.ts';

const { module, test } = QUnit;

const policy = {
  enabled: true,
  realmRRIs: new Set(['@cardstack/pretui/']),
};

module(basename(import.meta.filename), function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async function () {
    realmDir = await mkdtemp(join(tmpdir(), 'deck-save-history-'));
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@cardstack/pretui', version: '1.0.0' }),
    );
  });

  hooks.afterEach(async function () {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('a realm without Deck gets no save hook', function (assert) {
    assert.strictEqual(
      deckSaveRecorder({
        realmDir,
        policy: { enabled: false, realmRRIs: new Set() },
      }),
      undefined,
    );
  });

  test('every adapter mutation on a Deck realm is noted, except Deck state', async function (assert) {
    let noted: string[] = [];
    let committer = {
      note: (_dir: string, _rri: string, _policy: unknown, path: string) =>
        noted.push(path),
    } as unknown as HostSaveCommitter;
    let adapter = new NodeAdapter(
      realmDir,
      false,
      deckSaveRecorder({ realmDir, policy, committer }),
    );
    await adapter.write('board.gts', 'export const v = 1;\n');
    await adapter.append('log.jsonl' as LocalPath, '{"a":1}\n');
    await adapter.write('.deck/refs/main.json', '{}');
    await adapter.remove('board.gts' as LocalPath);
    assert.deepEqual(noted, ['board.gts', 'log.jsonl', 'board.gts']);
  });

  test('a realm the allowlist does not name is ignored until its package is renamed into it', async function (assert) {
    await writeFile(
      join(realmDir, 'package.json'),
      JSON.stringify({ name: '@someone/else' }),
    );
    let noted: string[] = [];
    let committer = {
      note: (_dir: string, _rri: string, _policy: unknown, path: string) =>
        noted.push(path),
    } as unknown as HostSaveCommitter;
    let adapter = new NodeAdapter(
      realmDir,
      false,
      deckSaveRecorder({ realmDir, policy, committer }),
    );
    await adapter.write('board.gts', 'one');
    await adapter.write(
      'package.json',
      JSON.stringify({ name: '@cardstack/pretui' }),
    );
    await adapter.write('board.gts', 'two');
    assert.deepEqual(noted, ['package.json', 'board.gts']);
  });

  test('a burst of host saves commits once the realm is quiet', async function (assert) {
    let commits: string[] = [];
    let committer = new HostSaveCommitter({
      history: {} as HistoryBackend,
      debounceMs: 60,
      commit: async ({ message }) => {
        commits.push(message);
      },
    });
    try {
      let adapter = new NodeAdapter(
        realmDir,
        false,
        deckSaveRecorder({ realmDir, policy, committer }),
      );
      await adapter.write('board.gts', 'one');
      await adapter.write('board.gts', 'two');
      await adapter.write('theme.css', 'body {}');
      assert.deepEqual(commits, [], 'nothing commits mid-burst');
      await sleep(200);
      assert.deepEqual(commits, ['save: board.gts, theme.css']);
      await adapter.write('board.gts', 'three');
      await sleep(200);
      assert.deepEqual(
        commits,
        ['save: board.gts, theme.css', 'save: board.gts'],
        'a save after the quiet window is its own commit',
      );
    } finally {
      committer.close();
    }
  });

  test('a burst a branch update takes is not committed again', async function (assert) {
    let commits: string[] = [];
    let committer = new HostSaveCommitter({
      history: {} as HistoryBackend,
      debounceMs: 60,
      commit: async ({ message }) => {
        commits.push(message);
      },
    });
    try {
      committer.note(realmDir, '@cardstack/pretui/', policy, 'board.gts');
      assert.strictEqual(committer.take(realmDir), 'save: board.gts');
      await sleep(150);
      assert.deepEqual(commits, []);
    } finally {
      committer.close();
    }
  });
});
