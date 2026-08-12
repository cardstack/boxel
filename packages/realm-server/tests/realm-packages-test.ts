import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { publishToStore, readStoredFile, unpack } from '@cardstack/deck/node';
import {
  authoredOnly,
  discoverRealmPackages,
  findDanglingImports,
  findEscapingImports,
  packRealmPackage,
  pointAtBuiltSiblings,
  readPackageManifest,
  storeNameFor,
} from '../lib/realm-packages.ts';

// A package's manifest, in the package. Paths are pack-relative because
// inside a package `$DECK/` means the package's own root — there is nothing
// to translate.
const CRM_MANIFEST = JSON.stringify({
  deck: {
    publisher: 'acme',
    packages: {
      crm: {
        version: '2.0.0',
        entry: '$DECK/app.gts',
        exports: { './account': '$DECK/account.gts' },
      },
    },
  },
});

// The realm's own map. Resolution for unpackaged content, and nothing about
// what the realm publishes.
const REALM_MAP = JSON.stringify({
  imports: { palette: '/demo/_packages/lib/palette@4.1.0/index.js' },
});

const REALM = {
  'importmap.json': REALM_MAP,
  'crm/importmap.json': CRM_MANIFEST,
  'crm/app.gts': `import AccountCard from './account';\nexport default class CRMApp {}\n`,
  'crm/account.gts': `export default class AccountCard {}\n`,
  'crm/lead.gts': `import AccountCard from './account';\nexport default class LeadCard {}\n`,
  'other/unrelated.gts': `export default class Nope {}\n`,
};

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

async function crmOf(dir: string) {
  let { packages } = await discoverRealmPackages(dir);
  return packages.find((p) => p.key === 'crm')!;
}

module(basename(import.meta.filename), function () {
  module('a package carries its own name', function () {
    test('the manifest names the package, and the store name follows', function (assert) {
      let manifest = readPackageManifest(CRM_MANIFEST);
      let publisher =
        manifest.kind === 'package' ? manifest.publisher : undefined;
      assert.strictEqual(manifest.kind, 'package');
      assert.strictEqual(
        manifest.kind === 'package' ? manifest.key : undefined,
        'crm',
      );
      assert.strictEqual(publisher, 'acme');
      assert.strictEqual(storeNameFor(publisher, 'crm'), 'acme/crm');
      // The key stays the SHORT name: the store looks a package up by the last
      // segment when it checks a pack against the version it is published
      // under, so a manifest keyed `acme/crm` would skip that check silently.
      assert.strictEqual(
        storeNameFor(publisher, 'crm').split('/').at(-1),
        'crm',
      );
    });

    test('no publisher means depot-local', function (assert) {
      // Not an error, and not a namespace either. A bare name resolves inside
      // the depot holding it; adding a publisher is the visible moment the
      // package went public.
      let manifest = readPackageManifest(
        JSON.stringify({ deck: { packages: { crm: { version: '1.0.0' } } } }),
      );
      assert.strictEqual(
        manifest.kind === 'package' ? manifest.publisher : 'unexpected',
        undefined,
      );
      assert.strictEqual(storeNameFor(undefined, 'crm'), 'crm');
    });

    test('an importmap with no packages block is a resolution map', function (assert) {
      // The realm's own map is exactly this shape, and reading it as a broken
      // manifest would make every realm look misconfigured.
      assert.strictEqual(readPackageManifest(REALM_MAP).kind, 'none');
    });

    test('a manifest naming two packages is refused', function (assert) {
      // `deck.packages` is a map because a pack may describe several, but a
      // DIRECTORY is one package, and two leaves no way to say which.
      let manifest = readPackageManifest(
        JSON.stringify({
          deck: { packages: { crm: { version: '1.0.0' }, erp: {} } },
        }),
      );
      assert.strictEqual(manifest.kind, 'invalid');
    });
  });

  module('discovering what a realm holds', function () {
    test('packages are found by scanning for manifests', async function (assert) {
      // Nothing registers and nothing is configured — the rule discoverDecks
      // states for a depot, applied to a realm's arbitrary tree.
      await withRealm(REALM, async (dir) => {
        let { packages, problems } = await discoverRealmPackages(dir);
        assert.deepEqual(
          packages.map(
            (p) => `${p.publisher}/${p.key}@${p.declaration.version}`,
          ),
          ['acme/crm@2.0.0'],
        );
        assert.deepEqual(problems, []);
      });
    });

    test("the realm's own map is not a package", async function (assert) {
      // It sits at the root and it is a resolution map. Treating it as a
      // manifest would make every realm publish itself.
      await withRealm(
        { 'importmap.json': REALM_MAP, 'a.gts': 'export const a = 1;\n' },
        async (dir) => {
          let { packages } = await discoverRealmPackages(dir);
          assert.deepEqual(packages, []);
        },
      );
    });

    test('a manifest disagreeing with its folder is reported, not resolved', async function (assert) {
      // The manifest is authoritative and the layout is a convention that
      // should agree. A disagreement is an error to surface rather than a
      // precedence rule nobody would remember.
      await withRealm(
        {
          ...REALM,
          'crm/importmap.json': CRM_MANIFEST.replace('"crm"', '"sales"'),
        },
        async (dir) => {
          let { packages, problems } = await discoverRealmPackages(dir);
          assert.strictEqual(packages[0]?.key, 'sales', 'the manifest wins');
          assert.true(
            problems.some((p) => p.includes('"sales"') && p.includes('"crm"')),
            'and the disagreement is named',
          );
        },
      );
    });

    test('a package does not contain another package', async function (assert) {
      await withRealm(
        {
          ...REALM,
          'crm/nested/importmap.json': JSON.stringify({
            deck: { packages: { nested: { version: '1.0.0' } } },
          }),
        },
        async (dir) => {
          let { packages } = await discoverRealmPackages(dir);
          assert.deepEqual(
            packages.map((p) => p.key),
            ['crm'],
          );
        },
      );
    });
  });

  module('packing what the manifest describes', function () {
    test('the pack is the directory, and nothing outside it', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
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
        assert.false(result.files.some((f) => f.includes('unrelated')));
      });
    });

    test('the sealed manifest is derived from the authored one', async function (assert) {
      // Entry and exports move onto the compiled modules, because an entry is
      // an address a consumer imports and the source does not run. Everything
      // else passes through.
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        let manifest = JSON.parse(
          unpack(result.bytes).files.get('importmap.json')!.toString('utf8'),
        );
        assert.strictEqual(manifest.deck.packages.crm.version, '2.0.0');
        assert.strictEqual(manifest.deck.packages.crm.entry, '$DECK/app.js');
        assert.strictEqual(
          manifest.deck.packages.crm.exports['./account'],
          '$DECK/account.js',
        );
      });
    });

    test('the pack publishes, and its modules serve back', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let store = join(dir, '.store');
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        let record = await publishToStore(
          store,
          'acme/crm',
          '2.0.0',
          result.bytes,
        );
        assert.strictEqual(record.treeHash, result.treeHash);
        let served = await readStoredFile(
          store,
          'acme/crm',
          '2.0.0',
          'account.gts',
        );
        assert.strictEqual(served?.toString('utf8'), REALM['crm/account.gts']);
      });
    });

    test('publishing under a version the manifest does not claim is refused', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        await assert.rejects(
          publishToStore(
            join(dir, '.store'),
            'acme/crm',
            '3.0.0',
            result.bytes,
          ),
          /declares acme\/crm@2\.0\.0/,
        );
      });
    });

    test('a compiled module sits beside every source', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        let compiled = unpack(result.bytes)
          .files.get('account.js')!
          .toString('utf8');
        assert.false(compiled.includes('<template>'));
      });
    });

    test('the structural pass is given source, never compiled output', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let result = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        assert.deepEqual(
          [...result.sources.keys()].filter((p) => p.endsWith('.gts')).sort(),
          ['account.gts', 'app.gts', 'lead.gts'],
        );
      });
    });

    test('a package holding nothing but a manifest is refused', async function (assert) {
      await withRealm(
        { 'importmap.json': REALM_MAP, 'crm/importmap.json': CRM_MANIFEST },
        async (dir) => {
          let crm = await crmOf(dir);
          let result = await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          });
          assert.strictEqual(
            result.kind === 'refused' ? result.code : result.kind,
            'empty-package',
          );
        },
      );
    });

    test('a hand-written file in the way of build output is refused', async function (assert) {
      await withRealm(
        { ...REALM, 'crm/account.js': '// mine\n' },
        async (dir) => {
          let crm = await crmOf(dir);
          let result = await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          });
          assert.strictEqual(
            result.kind === 'refused' ? result.code : result.kind,
            'build-output-collision',
          );
        },
      );
    });

    test('a module that does not compile is refused, by name', async function (assert) {
      await withRealm(
        { ...REALM, 'crm/broken.gts': 'export class {{{ oops\n' },
        async (dir) => {
          let crm = await crmOf(dir);
          let result = await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
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

    test('relative imports are pointed at the compiled siblings', function (assert) {
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
      // Left as written: a specifier leaving the pack is already a warning,
      // and rewriting it would hide what the module needs.
      assert.strictEqual(
        pointAtBuiltSiblings(
          `import x from '../components/thing';`,
          'app.gts',
          authored,
        ),
        `import x from '../components/thing';`,
      );
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

    test('build output is dropped when comparing against a published pack', function (assert) {
      // A published pack holds source and compiled output; a candidate's
      // authored side holds only source. Compared naively, every built module
      // reads as deleted and the structural pass reports MAJOR for a
      // republish that changed nothing — which it did, once, against a live
      // store.
      let published = new Map([
        ['importmap.json', '{}'],
        ['index.gts', 'source'],
        ['index.js', 'compiled'],
        ['vendored.js', 'hand-written, no sibling'],
      ]);
      assert.deepEqual(
        [...authoredOnly(published).keys()].sort(),
        ['importmap.json', 'index.gts', 'vendored.js'],
        'derived output goes, a hand-written .js stays',
      );
    });

    test('imports that leave the pack are reported, not refused', function (assert) {
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
    });

    test('an import that stays in the pack and points at nothing is reported', function (assert) {
      // The sibling case the escape detector cannot see, and the one that
      // shipped: `crm/app.gts` was moved into the package it belongs to and
      // kept importing `./crm/shared`, which was right from the realm root and
      // resolves to nothing from a pack whose root IS `crm/`. That published
      // as `crm@1.2.0` with zero warnings and a broken entry module.
      let warnings = findDanglingImports(
        new Map([
          [
            'app.gts',
            Buffer.from(
              "import { a } from './crm/shared';\n" +
                "import { b } from './shared';\n" +
                "import c from '../outside';\n" +
                "import d from './nested/thing.gts';\n",
            ),
          ],
          ['shared.gts', Buffer.from('export const b = 1;')],
          ['nested/thing.gts', Buffer.from('export default 1;')],
        ]),
      );
      assert.deepEqual(
        warnings,
        ['app.gts imports ./crm/shared, which is not in the pack'],
        'the dangling one only: a real sibling resolves, an extension is ' +
          'optional, and an escape belongs to the other detector',
      );
    });
  });

  module('a pack carries its lock', function () {
    // A realm holding two packages, one depending on the other by range.
    const DEPENDENT = {
      'importmap.json': REALM_MAP,
      'greeter/importmap.json': JSON.stringify({
        deck: {
          publisher: 'acme',
          packages: {
            greeter: {
              version: '1.2.0',
              entry: '$DECK/index.gts',
              exports: { './greeter': '$DECK/index.gts' },
            },
          },
        },
      }),
      'greeter/index.gts': `export default class Greeter {}\n`,
      'crm/importmap.json': JSON.stringify({
        deck: {
          publisher: 'acme',
          dependencies: { 'acme/greeter': '^1.0.0' },
          packages: { crm: { version: '2.0.0', entry: '$DECK/app.gts' } },
        },
      }),
      'crm/app.gts': `import G from 'acme/greeter';\nexport default class CRMApp {}\n`,
    };

    // Publish the dependency, then pack the dependent against that store.
    async function withPublishedGreeter(
      fn: (ctx: { dir: string; store: string }) => Promise<void>,
    ) {
      await withRealm(DEPENDENT, async (dir) => {
        let store = join(dir, '.store');
        let { packages } = await discoverRealmPackages(dir);
        let greeter = packages.find((p) => p.key === 'greeter')!;
        let packed = packedOrThrow(
          await packRealmPackage({
            packageDir: greeter.dir,
            key: greeter.key,
            declaration: greeter.declaration,
          }),
        );
        await publishToStore(store, 'acme/greeter', '1.2.0', packed.bytes);
        await fn({ dir, store });
      });
    }

    function sealedManifest(bytes: Buffer): any {
      return JSON.parse(
        unpack(bytes).files.get('importmap.json')!.toString('utf8'),
      );
    }

    test('a declared range is sealed as an exact pin', async function (assert) {
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let packed = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
            dependencies: crm.dependencies,
            storeDir: store,
            realmPath: '/demo/',
          }),
        );
        let manifest = sealedManifest(packed.bytes);
        assert.deepEqual(manifest.imports, {
          'acme/greeter/': '/demo/_packages/acme/greeter@1.2.0/',
          'acme/greeter': '/demo/_packages/acme/greeter@1.2.0/index.js',
          // The alias points at the BUILT module, because the sealed manifest
          // it was read from names built modules — the entry a consumer
          // imports has to be the bytes that run.
          'acme/greeter/greeter': '/demo/_packages/acme/greeter@1.2.0/index.js',
        });
        // The RANGE is kept beside the pin, not consumed by it. A reader can
        // see what the author would have accepted, and an operator advancing
        // a pin within the declared range has the permission in writing.
        assert.deepEqual(manifest.deck.dependencies, {
          'acme/greeter': '^1.0.0',
        });
        assert.deepEqual(packed.pins, [
          { key: 'acme/greeter', spec: '^1.0.0', version: '1.2.0' },
        ]);
      });
    });

    test('the pins are origin-relative, so the pack can be mirrored', async function (assert) {
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let packed = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
            dependencies: crm.dependencies,
            storeDir: store,
            realmPath: '/demo/',
          }),
        );
        // What a seal owes its consumer is the VERSION. Welding the host into
        // the pin would make the Version unmirrorable, which is the opposite
        // of what a content-addressed store is for.
        assert.deepEqual(
          Object.values(sealedManifest(packed.bytes).imports).filter((value) =>
            /^https?:/i.test(String(value)),
          ),
          [],
        );
      });
    });

    test('pinning without a governing realm refuses the publish', async function (assert) {
      // A package address with no realm in it names nobody's namespace — the
      // rootless `/_packages/…` form this design removed. Defaulting here
      // would quietly mint exactly those pins again, and they would resolve to
      // nothing on every server that read them. Loud at publish beats silent
      // in a consumer's browser weeks later.
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let result = await packRealmPackage({
          packageDir: crm.dir,
          key: crm.key,
          declaration: crm.declaration,
          dependencies: crm.dependencies,
          storeDir: store,
          // realmPath deliberately omitted
        });
        assert.strictEqual(
          result.kind === 'refused' ? result.code : 'unexpected',
          'malformed-dependency',
        );
        assert.ok(
          result.kind === 'refused' &&
            /publishing realm/.test(result.detail ?? ''),
          'the refusal names what is missing',
        );
      });
    });

    test('a range nothing satisfies refuses the publish', async function (assert) {
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let result = await packRealmPackage({
          packageDir: crm.dir,
          key: crm.key,
          declaration: crm.declaration,
          dependencies: { 'acme/greeter': '^9.0.0' },
          storeDir: store,
          realmPath: '/demo/',
        });
        // Fails CLOSED. A seal that certifies bytes it cannot make run is
        // worth less than no seal: the hole would surface at a consumer's
        // import, on another machine, weeks later.
        assert.strictEqual(
          result.kind === 'refused' ? result.code : 'unexpected',
          'unsatisfiable-dependency',
        );
      });
    });

    test('a dependency with no published versions refuses', async function (assert) {
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let result = await packRealmPackage({
          packageDir: crm.dir,
          key: crm.key,
          declaration: crm.declaration,
          dependencies: { 'acme/nothing': '^1.0.0' },
          storeDir: store,
          realmPath: '/demo/',
        });
        assert.strictEqual(
          result.kind === 'refused' ? result.code : 'unexpected',
          'unknown-dependency',
        );
      });
    });

    test('a live dependency is not pinned', async function (assert) {
      await withPublishedGreeter(async ({ dir, store }) => {
        let crm = await crmOf(dir);
        let packed = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
            dependencies: { 'acme/greeter': 'live' },
            storeDir: store,
          }),
        );
        // `live` is the author asking for volatility on purpose, so it
        // contributes no pin and the depot's map answers — the escape hatch,
        // taken knowingly.
        assert.strictEqual(sealedManifest(packed.bytes).imports, undefined);
        assert.deepEqual(packed.pins, [{ key: 'acme/greeter', spec: 'live' }]);
      });
    });

    test('a package with no dependencies seals no imports block', async function (assert) {
      await withRealm(REALM, async (dir) => {
        let crm = await crmOf(dir);
        let packed = packedOrThrow(
          await packRealmPackage({
            packageDir: crm.dir,
            key: crm.key,
            declaration: crm.declaration,
          }),
        );
        let manifest = sealedManifest(packed.bytes);
        assert.strictEqual(manifest.imports, undefined);
        assert.strictEqual(manifest.deck.dependencies, undefined);
        assert.deepEqual(packed.pins, []);
      });
    });
  });
});
