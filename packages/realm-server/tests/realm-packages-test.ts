import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { publishToStore, readStoredFile, unpack } from '@cardstack/deck/node';
import {
  findEscapingImports,
  packRealmPackage,
  pointAtBuiltSiblings,
  readRealmPackages,
  storeNameFor,
} from '../lib/realm-packages.ts';

const MAP = JSON.stringify({
  imports: { palette: '/_packages/lib/palette@4.1.0/index.js' },
  boxel: {
    publisher: 'experiments',
    packages: {
      crm: {
        version: '2.0.0',
        root: '$DECK/crm/',
        entry: '$DECK/crm/app.gts',
        exports: { './account': '$DECK/crm/account.gts' },
      },
    },
  },
});

async function withRealm(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
) {
  let dir = await mkdtemp(join(tmpdir(), 'realm-pkg-'));
  try {
    for (let [path, content] of Object.entries(files)) {
      let full = join(dir, path);
      await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Narrows the union without an early return, so a refusal fails the test
// naming its own code rather than passing vacuously.
function packedOrThrow(
  result: Awaited<ReturnType<typeof packRealmPackage>>,
): Extract<typeof result, { kind: 'packed' }> {
  if (result.kind !== 'packed') {
    throw new Error(`expected a pack, got ${result.code}: ${result.detail}`);
  }
  return result;
}

const CRM = {
  'importmap.json': MAP,
  'crm/app.gts': `import AccountCard from './account';\nexport default class CRMApp {}\n`,
  'crm/account.gts': `export default class AccountCard {}\n`,
  'crm/lead.gts': `import AccountCard from './account';\nexport default class LeadCard {}\n`,
  'other/unrelated.gts': `export default class Nope {}\n`,
};

module(basename(import.meta.filename), function () {
  module('a realm publishing its own app', function () {
    test('the declaration reads, and names the package in the store', function (assert) {
      let map = readRealmPackages(MAP);
      assert.strictEqual(map.publisher, 'experiments');
      assert.strictEqual(map.packages.crm?.version, '2.0.0');
      assert.strictEqual(storeNameFor(map.publisher, 'crm'), 'experiments/crm');
      // The key stays the SHORT name on purpose: the store looks a package up
      // by the last segment of its name when it checks that a pack agrees
      // with the version it is published under, so a map keyed by the full
      // name would skip that check silently.
      assert.strictEqual(
        storeNameFor(map.publisher, 'crm').split('/').at(-1),
        'crm',
      );
    });

    test('a realm with no packages block publishes nothing, and is not an error', function (assert) {
      assert.deepEqual(readRealmPackages('{}').packages, {});
      assert.deepEqual(readRealmPackages('not json').packages, {});
    });

    test('the pack holds the declared subtree and nothing else', async function (assert) {
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        assert.deepEqual(result.files, [
          'account.gts',
          'account.js',
          'app.gts',
          'app.js',
          'importmap.json',
          'lead.gts',
          'lead.js',
        ]);
        // `other/` is in the realm and not in the package. A pack is the
        // subtree it declares, not the realm it came from.
        assert.false(result.files.some((f) => f.includes('unrelated')));
      });
    });

    test('the generated manifest is pack-relative, not realm-relative', async function (assert) {
      // Inside a published Version `$DECK/` means the pack root. An entry
      // still pointing at `$DECK/crm/app.gts` would resolve to a path that
      // does not exist in the pack it describes.
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        let manifest = JSON.parse(
          unpack(result.bytes).files.get('importmap.json')!.toString('utf8'),
        );
        assert.strictEqual(manifest.deck.packages.crm.version, '2.0.0');
        // `$DECK/crm/app.gts` in the realm becomes `$DECK/app.js` in the
        // pack — root stripped because the pack IS the root, and extension
        // changed because an entry names the module a consumer imports.
        assert.strictEqual(manifest.deck.packages.crm.entry, '$DECK/app.js');
        assert.strictEqual(
          manifest.deck.packages.crm.exports['./account'],
          '$DECK/account.js',
        );
      });
    });

    test('the pack publishes, and its modules serve back byte-identical', async function (assert) {
      // The end of the whole point: a card written in a realm becomes an
      // address another realm can pin.
      await withRealm(CRM, async (dir) => {
        let store = join(dir, '.store');
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        let record = await publishToStore(
          store,
          'experiments/crm',
          '2.0.0',
          result.bytes,
        );
        assert.strictEqual(record.treeHash, result.treeHash);
        let served = await readStoredFile(
          store,
          'experiments/crm',
          '2.0.0',
          'account.gts',
        );
        assert.strictEqual(served?.toString('utf8'), CRM['crm/account.gts']);
      });
    });

    test('a manifest that disagrees with the version it is published under is refused', async function (assert) {
      // The generated manifest is what makes the pack self-describing, and
      // the store checks it. Publishing 2.0.0's bytes as 3.0.0 has to fail,
      // or the manifest is decoration.
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        await assert.rejects(
          publishToStore(
            join(dir, '.store'),
            'experiments/crm',
            '3.0.0',
            result.bytes,
          ),
          /declares experiments\/crm@2\.0\.0/,
        );
      });
    });

    test('a root that climbs out of the realm is refused', async function (assert) {
      await withRealm(CRM, async (dir) => {
        let result = await packRealmPackage({
          realmDir: dir,
          key: 'crm',
          declaration: { version: '1.0.0', root: '$DECK/../elsewhere/' },
        });
        assert.strictEqual(
          result.kind === 'refused' ? result.code : result.kind,
          'root-escapes-realm',
        );
      });
    });

    test('a subtree with its own map is refused rather than overwritten', async function (assert) {
      await withRealm({ ...CRM, 'crm/importmap.json': '{}' }, async (dir) => {
        let result = await packRealmPackage({
          realmDir: dir,
          key: 'crm',
          declaration: readRealmPackages(MAP).packages.crm,
        });
        assert.strictEqual(
          result.kind === 'refused' ? result.code : result.kind,
          'root-has-own-map',
        );
      });
    });

    test('a package with no root cannot be packed, and says why', async function (assert) {
      await withRealm(CRM, async (dir) => {
        let result = await packRealmPackage({
          realmDir: dir,
          key: 'crm',
          declaration: { version: '1.0.0' },
        });
        assert.strictEqual(
          result.kind === 'refused' ? result.code : result.kind,
          'no-root',
        );
      });
    });

    test('the pack carries a compiled module beside every source', async function (assert) {
      // THE THING THAT MADE PUBLISHED CARDS UNUSABLE. A realm transpiles
      // `.gts` on the way out; the store serves the bytes it holds. Publishing
      // source alone ships a module whose first decorator is a syntax error to
      // whoever loads it — verified against a running server before this
      // existed.
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        assert.true(
          result.files.includes('account.js'),
          'the compiled sibling is in the pack',
        );
        assert.true(
          result.files.includes('account.gts'),
          'and so is the source a human reads',
        );
        let compiled = unpack(result.bytes)
          .files.get('account.js')!
          .toString('utf8');
        assert.false(
          compiled.includes('<template>'),
          'the template is compiled away',
        );
      });
    });

    test('the manifest names the compiled module, not the source', async function (assert) {
      // An entry is an address a consumer imports. Pointing it at the source
      // would hand them the bytes that do not run.
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        let manifest = JSON.parse(
          unpack(result.bytes).files.get('importmap.json')!.toString('utf8'),
        );
        assert.strictEqual(manifest.deck.packages.crm.entry, '$DECK/app.js');
        assert.strictEqual(
          manifest.deck.packages.crm.exports['./account'],
          '$DECK/account.js',
        );
      });
    });

    test('the structural pass is given source, never compiled output', async function (assert) {
      // Comparing compiled output would report the transpiler's choices as
      // changes to the package's API, so a compiler upgrade would read as a
      // breaking release.
      await withRealm(CRM, async (dir) => {
        let result = packedOrThrow(
          await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          }),
        );
        assert.deepEqual(
          [...result.sources.keys()].sort(),
          ['account.gts', 'app.gts', 'lead.gts'],
          'authored files only',
        );
      });
    });

    test('relative imports are pointed at the compiled siblings', function (assert) {
      // A realm resolves `./account` by trying extensions; the store serves
      // exactly the path asked for, so an extensionless import inside a
      // published Version is a 404.
      let authored = new Set(['app.gts', 'account.gts', 'deep/thing.gts']);
      assert.strictEqual(
        pointAtBuiltSiblings(`import A from './account';`, 'app.gts', authored),
        `import A from './account.js';`,
      );
      assert.strictEqual(
        pointAtBuiltSiblings(
          `import A from '../account';`,
          'deep/thing.gts',
          authored,
        ),
        `import A from '../account.js';`,
      );
      // Left exactly as written: a specifier that leaves the pack is already
      // reported as a warning, and rewriting it would hide what the module
      // actually needs.
      assert.strictEqual(
        pointAtBuiltSiblings(
          `import x from '../components/thing';`,
          'app.gts',
          authored,
        ),
        `import x from '../components/thing';`,
      );
      // Already extensioned, and a bare specifier: neither is ours to touch.
      assert.strictEqual(
        pointAtBuiltSiblings(`import a from './a.css';`, 'app.gts', authored),
        `import a from './a.css';`,
      );
      assert.strictEqual(
        pointAtBuiltSiblings(
          `import { CardDef } from '@cardstack/base/card-api';`,
          'app.gts',
          authored,
        ),
        `import { CardDef } from '@cardstack/base/card-api';`,
      );
    });

    test('a hand-written file in the way of build output is refused', async function (assert) {
      await withRealm(
        { ...CRM, 'crm/account.js': '// mine\n' },
        async (dir) => {
          let result = await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          });
          assert.strictEqual(
            result.kind === 'refused' ? result.code : result.kind,
            'build-output-collision',
          );
        },
      );
    });

    test('a module that does not compile is refused, by name', async function (assert) {
      // Failing here names the file. Failing later names nothing a consumer
      // can act on.
      await withRealm(
        { ...CRM, 'crm/broken.gts': 'export class {{{ oops\n' },
        async (dir) => {
          let result = await packRealmPackage({
            realmDir: dir,
            key: 'crm',
            declaration: readRealmPackages(MAP).packages.crm,
          });
          assert.strictEqual(
            result.kind === 'refused' ? result.code : result.kind,
            'build-failed',
          );
          assert.true(
            result.kind === 'refused'
              ? result.detail.includes('broken.gts')
              : false,
            'the refusal names the file that failed',
          );
        },
      );
    });

    test('imports that leave the pack are reported, not refused', function (assert) {
      // A text scan over `.gts`, which is not JavaScript — so it can be wrong,
      // and a wrong refusal would block a publish over a string in a comment.
      // Reporting puts the judgement in front of the reviewer, where the
      // ruling puts every other judgement about a proposal.
      let warnings = findEscapingImports(
        new Map([
          ['app.gts', Buffer.from(`import x from '../shared/thing';\n`)],
          ['ok.gts', Buffer.from(`import y from './sibling';\n`)],
          ['deep/nested.gts', Buffer.from(`import z from '../sibling';\n`)],
          ['live.gts', Buffer.from(`import w from '$DECK/other/thing';\n`)],
        ]),
      );
      assert.strictEqual(warnings.length, 1, 'only the real escape');
      assert.true(warnings[0].startsWith('app.gts'));
      // `deep/nested.gts` climbing one level lands back inside the pack, and
      // a `$DECK/` import is the design's deliberate live reference — neither
      // is an escape.
    });
  });
});
