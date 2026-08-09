import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import {
  pack,
  publishToStore,
  readStoreMeta,
  readStoredFile,
  resolveVersionSpec,
} from '@cardstack/deck/node';
import { parsePackagePath } from '../handlers/handle-package-serve.ts';

const MODULE_BODY = 'export const REVISION = "169";\n';

// The grammar is a pure function so it can be pinned without a server. Every
// case here is one a decklist could actually produce.
module(basename(import.meta.filename), function () {
  module('parsePackagePath', function () {
    test('splits <publisher>/<package>@<version>/<path>', function (assert) {
      let result = parsePackagePath('lib/three@0.169.0/build/three.module.js');
      assert.deepEqual(result, {
        ok: true,
        request: {
          name: 'lib/three',
          spec: '0.169.0',
          path: 'build/three.module.js',
        },
      });
    });

    test('an unscoped package name works', function (assert) {
      let result = parsePackagePath('three@0.169.0/index.js');
      assert.deepEqual(result, {
        ok: true,
        request: { name: 'three', spec: '0.169.0', path: 'index.js' },
      });
    });

    test('ranges and dist-tags parse; resolution decides what they mean', function (assert) {
      for (let spec of ['^0.169.0', 'latest', '0.x']) {
        let result = parsePackagePath(`lib/three@${spec}/index.js`);
        assert.strictEqual(
          result.ok ? result.request.spec : `refused: ${result.code}`,
          spec,
          `parses ${spec}`,
        );
      }
    });

    test('a prerelease version keeps its hyphen and dots', function (assert) {
      let result = parsePackagePath('lib/three@1.0.0-beta.8/index.js');
      assert.true(result.ok, 'parses');
      assert.strictEqual(
        result.ok ? result.request.spec : undefined,
        '1.0.0-beta.8',
      );
    });

    test('a deep file path is kept whole', function (assert) {
      let result = parsePackagePath('lib/three@0.169.0/examples/jsm/a/b/c.js');
      assert.true(result.ok, 'parses');
      assert.strictEqual(
        result.ok ? result.request.path : undefined,
        'examples/jsm/a/b/c.js',
      );
    });

    test('a version with no file is refused, not defaulted', function (assert) {
      // Guessing an entry point here would make the address space ambiguous:
      // the decklist is what says which file, and it always names one.
      let result = parsePackagePath('lib/three@0.169.0');
      assert.strictEqual(result.ok ? 'ok' : result.code, 'no-file-path');
    });

    test('traversal is refused', function (assert) {
      for (let rest of [
        'lib/three@0.169.0/../../../etc/passwd',
        'lib/three@0.169.0/build/../../secret',
        'lib/three@0.169.0/./build/three.js',
      ]) {
        let result = parsePackagePath(rest);
        assert.strictEqual(
          result.ok ? 'ok' : result.code,
          'malformed-address',
          `refused: ${rest}`,
        );
      }
    });

    test('an address with no version is refused', function (assert) {
      for (let rest of ['lib/three/build/three.js', '', '@0.169.0/x.js']) {
        let result = parsePackagePath(rest);
        assert.false(result.ok, `refused: ${JSON.stringify(rest)}`);
      }
    });
  });

  // The handler is thin glue over these three Deck calls. Exercising them
  // against a REAL store on disk is what proves the glue is wired to
  // something that works — a mocked store would only re-assert my own
  // assumptions about Deck's API.
  module('against a real Deck store', function (hooks) {
    let storeDir: string;

    hooks.beforeEach(async function () {
      storeDir = await mkdtemp(join(tmpdir(), 'deck-pkg-store-'));
      // Only verified packs enter a store, and the store checks the pack's
      // own manifest agrees about name and version — so the fixture builds a
      // real pack rather than dropping files on disk. The importmap key is
      // the PACKAGE segment (`three`), not the scoped name.
      await publishToStore(
        storeDir,
        'lib/three',
        '0.169.0',
        pack([
          {
            path: 'importmap.json',
            bytes: Buffer.from(
              JSON.stringify({
                deck: {
                  packages: {
                    three: {
                      version: '0.169.0',
                      entry: '$DECK/build/three.module.js',
                    },
                  },
                },
              }),
            ),
          },
          {
            path: 'build/three.module.js',
            bytes: Buffer.from(MODULE_BODY),
          },
          { path: 'LICENSE', bytes: Buffer.from('MIT\n') },
        ]),
      );
    });

    hooks.afterEach(async function () {
      await rm(storeDir, { recursive: true, force: true });
    });

    test('an exact version resolves and its bytes come back', async function (assert) {
      let meta = await readStoreMeta(storeDir, 'lib/three');
      assert.ok(meta, 'the package is in the store');
      let resolution = resolveVersionSpec('0.169.0', meta!);
      assert.strictEqual(resolution.kind, 'exact');
      let bytes = await readStoredFile(
        storeDir,
        'lib/three',
        '0.169.0',
        'build/three.module.js',
      );
      assert.strictEqual(bytes?.toString('utf8'), MODULE_BODY);
    });

    test('a range resolves to a concrete version, which is what the redirect targets', async function (assert) {
      let meta = await readStoreMeta(storeDir, 'lib/three');
      let resolution = resolveVersionSpec('^0.169.0', meta!);
      assert.strictEqual(resolution.kind, 'redirect');
      assert.strictEqual(
        resolution.kind === 'redirect' ? resolution.version : undefined,
        '0.169.0',
      );
    });

    test('an unknown version is not-found; nonsense is invalid', async function (assert) {
      let meta = await readStoreMeta(storeDir, 'lib/three');
      // The split matters for the serve path: not-found is a 404 that may
      // stop being true when something is published, invalid is a 400 that
      // never will be.
      assert.strictEqual(resolveVersionSpec('9.9.9', meta!).kind, 'not-found');
      assert.strictEqual(
        resolveVersionSpec('not a version', meta!).kind,
        'invalid',
      );
    });

    test('an unknown package has no meta at all', async function (assert) {
      assert.strictEqual(
        await readStoreMeta(storeDir, 'lib/nope'),
        undefined,
        'no meta, which the handler reports as unknown-package',
      );
    });

    test('a file the version does not contain reads back undefined', async function (assert) {
      assert.strictEqual(
        await readStoredFile(storeDir, 'lib/three', '0.169.0', 'nope.js'),
        undefined,
      );
    });
  });
});
