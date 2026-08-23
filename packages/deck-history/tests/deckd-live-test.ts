import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRestore } from '../src/backend.ts';
import { DeckdHistory } from '../src/deckd.ts';

// The stub in deckd-test.ts proves the client against the protocol AS
// DOCUMENTED. This module proves it against the daemon as BUILT, which is a
// different claim — so it runs only when someone points it at a live one:
//
//   DECKD_URL=http://127.0.0.1:8787 pnpm test
let baseUrl = process.env.DECKD_URL;

if (!baseUrl) {
  module('history: deckd (live daemon)', function () {
    test('skipped — set DECKD_URL to run against a real daemon', function (assert) {
      assert.ok(true, 'the stub module covers the client contract');
    });
  });
} else {
  module('history: deckd (live daemon)', function (hooks) {
    let dir: string;
    let history: DeckdHistory;

    hooks.beforeEach(async function () {
      dir = await mkdtemp(join(tmpdir(), 'deck-deckd-live-'));
      history = new DeckdHistory({ baseUrl, debounceMs: 20 });
    });

    hooks.afterEach(async function () {
      history.close();
      await rm(dir, { recursive: true, force: true });
    });

    test('the real daemon honours the whole contract', async function (assert) {
      assert.true(await history.probe(dir), `daemon reachable at ${baseUrl}`);

      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      let first = await history.seal(dir, 'v1', {
        name: '@mina:boxel.test',
      });
      assert.true(typeof first === 'string' && first.length > 0);
      assert.strictEqual(
        await history.seal(dir, 'nothing changed'),
        undefined,
        'a clean tree seals nothing — no empty seals accumulate',
      );
      assert.strictEqual(await history.head(dir), first);

      await writeFile(join(dir, 'app.js'), 'export const v = 2;\n');
      let second = await history.seal(dir, 'v2');
      assert.strictEqual(
        (await history.fileAt(dir, first!, 'app.js'))?.toString(),
        'export const v = 1;\n',
        'the superseded bytes are still there',
      );
      assert.strictEqual(
        await history.fileAt(dir, first!, 'nope.js'),
        undefined,
      );

      let seals = await history.list(dir);
      assert.deepEqual(
        seals.map((seal) => seal.changeId),
        [second, first],
        'newest first, working copy excluded',
      );
      assert.deepEqual(seals[0].filesSummary, ['M app.js']);
      assert.strictEqual(
        seals[1].author,
        '@mina:boxel.test',
        'deckd preserves the authenticated writer attribution',
      );

      let result = await applyRestore(history, dir, first!);
      assert.deepEqual(result.written, ['app.js']);
      assert.strictEqual(
        (await readFile(join(dir, 'app.js'))).toString(),
        'export const v = 1;\n',
      );
      assert.strictEqual(
        (await history.list(dir)).length,
        3,
        'the restore is a new seal — history only grows',
      );
    });

    test('writer-managed mode never auto-seals a partial tree', async function (assert) {
      history.close();
      history = new DeckdHistory({
        baseUrl,
        debounceMs: 20,
        watch: false,
      });
      await writeFile(join(dir, 'app.js'), 'export const v = 1;\n');
      await history.seal(dir, 'baseline');

      await writeFile(join(dir, 'app.js'), 'export const v = 2;\n');
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.strictEqual(
        (await history.list(dir, { flush: false })).length,
        1,
        'filesystem mutation waits for the owning writer',
      );
      assert.ok(await history.seal(dir, 'accepted batch'));
      assert.strictEqual((await history.list(dir, { flush: false })).length, 2);
    });

    test('a named branch shares ancestry but isolates its working tree', async function (assert) {
      await writeFile(join(dir, 'button.gts'), "export const tone = 'blue';\n");
      let baseline = await history.seal(dir, 'baseline');
      assert.ok(baseline);

      let branchRoot = join(dir, '.deck', 'branches');
      let branchDir = join(branchRoot, 'ana%2Fbutton-tone');
      await mkdir(branchRoot, { recursive: true });
      await history.fork(dir, branchDir, baseline!, 'deck:ana/button-tone');
      assert.strictEqual(
        (await readFile(join(branchDir, 'button.gts'))).toString(),
        "export const tone = 'blue';\n",
      );

      await writeFile(
        join(branchDir, 'button.gts'),
        "export const tone = 'violet';\n",
      );
      await history.seal(branchDir, 'violet tone');
      assert.strictEqual(
        (await readFile(join(dir, 'button.gts'))).toString(),
        "export const tone = 'blue';\n",
        'the branch does not mutate main',
      );
      assert.strictEqual((await history.list(dir, { flush: false })).length, 1);
      assert.strictEqual(
        (await history.list(branchDir, { flush: false })).length,
        2,
        'the branch sees its save plus inherited ancestry',
      );
      await history.discard(branchDir);
      await assert.rejects(readFile(join(branchDir, 'button.gts')), /ENOENT/);
      assert.strictEqual(
        (await history.list(dir, { flush: false })).length,
        1,
        'discard removes only the branch workspace',
      );
    });
  });
}
