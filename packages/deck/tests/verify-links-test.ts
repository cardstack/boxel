import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { publishToStore } from '../src/store.ts';
import { assertLinksOk, verifyLinks } from '../src/verify-links.ts';
import { appendSignature, generateKeyPair, signTreeHash } from '../src/signature.ts';

let root: string;
let storeDir: string;

function libPack(version: string) {
  return pack([
    {
      path: 'package.json',
      bytes: Buffer.from(
        JSON.stringify({
          name: 'lib',
          version,
          type: 'module',
          exports: { '.': './lib.js' },
        }),
      ),
    },
    { path: 'lib.js', bytes: Buffer.from(`export const v = '${version}';\n`) },
  ]);
}

async function deckWith(
  name: string,
  map: Record<string, unknown>,
  pkg: Record<string, unknown> = {},
): Promise<string> {
  let dir = join(root, name);
  await mkdir(dir, { recursive: true });
  let deck = (map.deck ?? {}) as {
    packages?: Record<string, { version?: string; entry?: string }>;
    dependencies?: Record<string, string>;
  };
  let self = deck.packages?.app;
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'app',
        version: self?.version ?? '0.1.0',
        type: 'module',
        ...(self?.entry
          ? { exports: { '.': `./${self.entry.replace(/^\$DECK\//, '')}` } }
          : {}),
        ...(deck.dependencies ? { dependencies: deck.dependencies } : {}),
        ...pkg,
      },
      null,
      2,
    ),
  );
  await writeFile(join(dir, 'importmap.json'), JSON.stringify(map, null, 2));
  return dir;
}

module('L11 the verify gate', function (hooks) {
  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'deck-links-'));
    storeDir = join(root, 'store');
    await publishToStore(storeDir, 'acme/lib', '1.0.0', libPack('1.0.0'), {
      tag: 'latest',
    });
    await publishToStore(storeDir, 'acme/lib', '1.1.0', libPack('1.1.0'));
  });
  hooks.afterEach(async function () {
    await rm(root, { recursive: true, force: true });
  });

  let honest = {
    imports: {
      'acme/lib/': '/demo/acme/lib@1.1.0/',
      'acme/lib': '/demo/acme/lib@1.1.0/lib.js',
    },
    deck: {
      packages: { app: { version: '0.1.0' } },
      dependencies: { 'acme/lib': '^1.0.0' },
    },
  };

  test('honest links pass', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('app', honest),
    });
    assert.deepEqual(report.findings, []);
    assert.strictEqual(report.checked, 1);
  });

  // A stale lock is a lie about what will be served: CI stays green while
  // the browser 404s.
  test('a pin that disagrees with its record is link-integrity', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('stale', {
        ...honest,
        imports: {
          'acme/lib/': '/demo/acme/lib@1.0.0/',
          'acme/lib': '/demo/acme/lib@1.0.0/lib.js',
        },
      }),
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-integrity', 'link-integrity'],
    );
  });

  test('a declared dependency with no pin is link-missing-pin', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('unpinned', { ...honest, imports: {} }),
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-missing-pin'],
    );
  });

  test('a pin with no record is link-missing-record', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('orphan', {
        imports: { stray: '/demo/acme/lib@1.0.0/lib.js' },
        deck: { packages: { app: { version: '0.1.0' } } },
      }),
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-missing-record'],
    );
  });

  test('an unsatisfiable range is link-unresolvable', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('nope', {
        imports: {},
        deck: {
          packages: { app: { version: '0.1.0' } },
          dependencies: { 'acme/lib': '^9.0.0' },
        },
      }),
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-unresolvable'],
    );
  });

  test('a deck that does not contain its own entry is caught', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('no-entry', {
        imports: {},
        deck: {
          packages: { app: { version: '0.1.0', entry: '$DECK/missing.js' } },
        },
      }),
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-entry-missing'],
    );
  });

  test('an alias is verified against the deck it names', async function (assert) {
    await publishToStore(storeDir, 'you/lib', '2.0.0', libPack('2.0.0'));
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('aliased', {
        imports: {
          'acme/lib/': '/demo/you/lib@2.0.0/',
          'acme/lib': '/demo/you/lib@2.0.0/lib.js',
        },
        deck: {
          packages: { app: { version: '0.1.0' } },
          dependencies: { 'acme/lib': 'you/lib@2.0.0' },
        },
      }),
    });
    assert.deepEqual(report.findings, [], 'the fork answers for the base');
  });

  test('a required endorsement that is absent is refused', async function (assert) {
    let treeHash = 'a'.repeat(64);
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('unsigned', honest),
      requireSignatures: 1,
      treeHash,
    });
    assert.deepEqual(
      report.findings.map((finding) => finding.code),
      ['link-unsigned'],
    );
    await appendSignature(
      storeDir,
      treeHash,
      signTreeHash({ treeHash, key: generateKeyPair() }),
    );
    let after = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('signed', honest),
      requireSignatures: 1,
      treeHash,
    });
    assert.deepEqual(after.findings, [], 'a valid endorsement satisfies it');
  });

  test('assertLinksOk throws with every finding named', async function (assert) {
    let report = await verifyLinks({
      depotName: 'demo',
      storeDir,
      deck: 'me/app',
      deckDir: await deckWith('bad', { ...honest, imports: {} }),
    });
    assert.throws(() => assertLinksOk(report), /link-missing-pin/);
  });
});
