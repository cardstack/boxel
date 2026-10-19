import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import QUnit from 'qunit';
import { DeckdHistory } from '@cardstack/deck-history/deckd';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import { NodeAdapter } from '../node-realm.ts';
import { deckSaveRecorder } from '../lib/deck-save-history.ts';

const { module, test } = QUnit;

const policy = {
  enabled: true,
  realmRRIs: new Set(['@cardstack/pretui/']),
};

// A deckd that records what it is asked to commit.
async function startDeckd(): Promise<{
  server: Server;
  url: string;
  seals: Array<{ dir: string; message: string }>;
}> {
  let seals: Array<{ dir: string; message: string }> = [];
  let server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let json = body ? JSON.parse(body) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url === '/seal') {
        seals.push({ dir: json.dir, message: json.message });
        res.end(JSON.stringify({ changeId: `step${seals.length}` }));
      } else {
        res.end(JSON.stringify({}));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let address = server.address();
  let port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}`, seals };
}

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
    let history = {
      noteMutation: (_dir: string, path: string) => noted.push(path),
    } as unknown as DeckdHistory;
    let adapter = new NodeAdapter(
      realmDir,
      false,
      deckSaveRecorder({ realmDir, policy, history }),
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
    let history = {
      noteMutation: (_dir: string, path: string) => noted.push(path),
    } as unknown as DeckdHistory;
    let adapter = new NodeAdapter(
      realmDir,
      false,
      deckSaveRecorder({ realmDir, policy, history }),
    );
    await adapter.write('board.gts', 'one');
    await adapter.write(
      'package.json',
      JSON.stringify({ name: '@cardstack/pretui' }),
    );
    await adapter.write('board.gts', 'two');
    assert.deepEqual(noted, ['package.json', 'board.gts']);
  });

  test('a burst of host saves commits as one History Step once the realm is quiet', async function (assert) {
    let deckd = await startDeckd();
    let history = new DeckdHistory({
      baseUrl: deckd.url,
      debounceMs: 60,
      watch: false,
    });
    try {
      let adapter = new NodeAdapter(
        realmDir,
        false,
        deckSaveRecorder({ realmDir, policy, history }),
      );
      await adapter.write('board.gts', 'one');
      await adapter.write('board.gts', 'two');
      await adapter.write('theme.css', 'body {}');
      assert.strictEqual(deckd.seals.length, 0, 'nothing commits mid-burst');
      await sleep(200);
      assert.deepEqual(deckd.seals, [
        { dir: realmDir, message: 'save: board.gts, theme.css' },
      ]);
      await adapter.write('board.gts', 'three');
      await sleep(200);
      assert.strictEqual(
        deckd.seals.length,
        2,
        'a save after the quiet window is its own Step',
      );
      assert.strictEqual(deckd.seals[1].message, 'save: board.gts');
    } finally {
      history.close();
      await new Promise<void>((resolve) => deckd.server.close(() => resolve()));
    }
  });
});
