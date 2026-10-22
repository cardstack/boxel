import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkDeck } from '../src/fork.ts';
import {
  applyRebase,
  discoverOffers,
  planRebase,
} from '../src/offer.ts';
import { packFromDir } from '../src/pack.ts';
import { publishToStore, readStoreMeta } from '../src/store.ts';

let depotDir: string;
let storeDir: string;

const UPSTREAM = 'acme/palette';

async function publishUpstream(version: string, tag = 'latest') {
  await publishToStore(
    storeDir,
    UPSTREAM,
    version,
    await packFromDir(join(depotDir, 'acme', 'palette')),
    { tag },
  );
}

async function writeUpstream(files: Record<string, string>, version: string) {
  await writeFile(
    join(depotDir, 'acme', 'palette', 'package.json'),
    JSON.stringify(
      {
        name: 'palette',
        version,
        type: 'module',
        exports: { '.': './palette.js' },
      },
      null,
      2,
    ) + '\n',
  );
  for (let [path, text] of Object.entries(files)) {
    await writeFile(join(depotDir, 'acme', 'palette', path), text);
  }
}

async function offerFor(name: string) {
  let offers = await discoverOffers(depotDir);
  return offers.find((offer) => offer.name === name)!;
}

module('offers: a fork that remembers where it came from', function (hooks) {
  hooks.beforeEach(async function () {
    depotDir = join(await mkdtemp(join(tmpdir(), 'deck-offer-')), 'demo');
    storeDir = join(depotDir, '.deck', 'store');
    await mkdir(join(depotDir, 'acme', 'palette'), { recursive: true });
    await writeUpstream(
      {
        'palette.js': 'export const colors = 3;\n',
        'notes.md': 'line one\nline two\nline three\n',
      },
      '1.0.0',
    );
    await publishUpstream('1.0.0');
  });

  hooks.afterEach(async function () {
    await rm(join(depotDir, '..'), { recursive: true, force: true });
  });

  test('a fork is discoverable as an offer, with an exact base', async function (assert) {
    let result = await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
      actor: '@chris:boxel.ai',
    });
    let offers = await discoverOffers(depotDir);
    assert.strictEqual(offers.length, 1, 'only the fork is an offer');
    assert.strictEqual(offers[0].name, 'you/palette');
    assert.strictEqual(offers[0].forkedFrom.package, UPSTREAM);
    assert.strictEqual(offers[0].forkedFrom.version, '1.0.0');
    assert.strictEqual(offers[0].forkedFrom.treeHash, result.baseTreeHash);
    assert.strictEqual(
      offers[0].forkedFrom.actor,
      '@chris:boxel.ai',
      'the actor travels in the tree — where a Matrix id will go',
    );
  });

  test('nothing published upstream since the base means nothing to do', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
    });
    let plan = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/palette'),
    });
    assert.strictEqual(plan.state, 'current');
    assert.strictEqual(plan.upstreamVersion, '1.0.0');
  });

  test('upstream moves, the proposal absorbs it, and the base moves with it', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
    });
    // The proposal edits one file…
    await writeFile(
      join(depotDir, 'you', 'palette', 'palette.js'),
      'export const colors = 8;\n',
    );
    // …while upstream edits a different one and releases.
    await writeUpstream(
      {
        'palette.js': 'export const colors = 3;\n',
        'notes.md': 'line one\nline TWO\nline three\n',
      },
      '1.1.0',
    );
    await publishUpstream('1.1.0');

    let plan = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/palette'),
    });
    assert.strictEqual(plan.state, 'rebased');
    assert.deepEqual(plan.conflicts, []);
    assert.strictEqual(plan.upstreamVersion, '1.1.0');

    let applied = await applyRebase(plan);
    assert.true(applied.changed);
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'notes.md'))
      ).toString(),
      'line one\nline TWO\nline three\n',
      "upstream's change arrived",
    );
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'palette.js'))
      ).toString(),
      'export const colors = 8;\n',
      'and the proposal kept its own',
    );

    let after = await offerFor('you/palette');
    assert.strictEqual(after.forkedFrom.version, '1.1.0');
    let meta = await readStoreMeta(storeDir, UPSTREAM);
    assert.strictEqual(
      after.forkedFrom.treeHash,
      meta!.versions['1.1.0'].treeHash,
      'the base names what the proposal has already absorbed',
    );

    let settled = await planRebase({
      depotDir,
      storeDir,
      offer: after,
    });
    assert.strictEqual(settled.state, 'current', 'and it is now up to date');
  });

  test('a real conflict is reported and NOTHING is written', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
    });
    await writeFile(
      join(depotDir, 'you', 'palette', 'notes.md'),
      'line one\nMINE\nline three\n',
    );
    await writeUpstream(
      {
        'palette.js': 'export const colors = 3;\n',
        'notes.md': 'line one\nUPSTREAM\nline three\n',
      },
      '1.1.0',
    );
    await publishUpstream('1.1.0');

    let plan = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/palette'),
    });
    assert.strictEqual(plan.state, 'conflicted');
    assert.deepEqual(plan.conflicts, ['notes.md']);
    assert.strictEqual(plan.files, undefined, 'no tree to write');
    await assert.rejects(applyRebase(plan), /cannot apply a conflicted/);
    assert.strictEqual(
      (
        await readFile(join(depotDir, 'you', 'palette', 'notes.md'))
      ).toString(),
      'line one\nMINE\nline three\n',
      "the contributor's tree is untouched — the daemon never damages work",
    );
  });

  test('a base that is not in the store is unresolvable, and says why', async function (assert) {
    await mkdir(join(depotDir, 'you', 'ghost'), { recursive: true });
    await writeFile(
      join(depotDir, 'you', 'ghost', 'package.json'),
      JSON.stringify(
        {
          name: 'ghost',
          version: '1.0.0',
          type: 'module',
          exports: { '.': './g.js' },
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      join(depotDir, 'you', 'ghost', 'importmap.json'),
      JSON.stringify(
        {
          deck: {
            packages: {
              ghost: {
                forkedFrom: { package: UPSTREAM, treeHash: 'f'.repeat(64) },
              },
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
    await writeUpstream(
      { 'palette.js': 'export const colors = 4;\n' },
      '1.1.0',
    );
    await publishUpstream('1.1.0');
    let plan = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/ghost'),
    });
    assert.strictEqual(plan.state, 'unresolvable');
    assert.true(/not in the store/.test(plan.detail ?? ''), plan.detail);
  });

  test('--onto picks which upstream state to chase', async function (assert) {
    await forkDeck({
      depotDir,
      storeDir,
      from: { publisher: 'acme', package: 'palette', spec: '1.0.0' },
      to: { publisher: 'you', package: 'palette' },
    });
    await writeUpstream(
      { 'palette.js': 'export const colors = 4;\n' },
      '1.1.0',
    );
    await publishUpstream('1.1.0-dev.1', 'dev');
    let onLatest = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/palette'),
    });
    assert.strictEqual(
      onLatest.upstreamVersion,
      '1.0.0',
      'by default a proposal chases the RELEASE, not the dev line',
    );
    let onDev = await planRebase({
      depotDir,
      storeDir,
      offer: await offerFor('you/palette'),
      onto: 'dev',
    });
    assert.strictEqual(onDev.upstreamVersion, '1.1.0-dev.1');
  });

  test('a plain deck with no base is not an offer', async function (assert) {
    assert.deepEqual(await discoverOffers(depotDir), []);
  });
});
