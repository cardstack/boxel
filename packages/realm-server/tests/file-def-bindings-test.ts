import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  baseRealm,
  baseFileRef,
  parseFileDefBindings,
  readFileDefBindings,
  resolveFileDefCodeRef,
  servedFileDefCodeRef,
  rri,
  VirtualNetwork,
  type FileDefBindings,
  type Reader,
} from '@cardstack/runtime-common';

// ============================================================================
// What a realm's file type bindings accept, and what a file resolves to once
// they are in hand.
//
// The realm reads these from its stored config document and so does the index
// runner, so what is under test here is the one parse they share: which
// declarations bind, which are refused and say so, and how a binding wins over
// the platform table without displacing the extensions it says nothing about.
// Whether the two callers then agree is a property of a live realm and is
// asserted in `realm-endpoints/operations-test.ts`.
// ============================================================================

const REALM = new URL('http://example.com/test/');

const AUDIT_LOG = {
  module: `${REALM.href}audit-log`,
  name: 'AuditLog',
};

function collect(): {
  bindingsFor: (value: unknown) => FileDefBindings;
  warnings: () => string[];
} {
  let warnings: string[] = [];
  return {
    bindingsFor: (value: unknown) =>
      parseFileDefBindings(value, {
        realmURL: REALM,
        virtualNetwork: new VirtualNetwork(),
        logWarn: (message) => warnings.push(message),
      }),
    warnings: () => warnings,
  };
}

// A reader over a fixed set of realm files, for the read half. Only the
// members `readFileDefBindings` uses are real; the rest would be a claim this
// file cannot make.
function readerOver(files: Record<string, string>): Reader {
  return {
    readFile: async (url: URL) => {
      let content = files[url.href];
      return content === undefined
        ? undefined
        : { content, lastModified: 1000, created: 1000, path: url.href };
    },
    readStream: async () => undefined,
    mtimes: async () => ({}),
  } as unknown as Reader;
}

function configDocument(attributes: Record<string, unknown>): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/realm-config',
          name: 'RealmConfig',
        },
      },
    },
  });
}

module(basename(import.meta.filename), function () {
  module('what binds', function () {
    test('an extension the platform reads as a file binds to the named class', function (assert) {
      let { bindingsFor, warnings } = collect();
      let bindings = bindingsFor({ '.txt': AUDIT_LOG });

      assert.deepEqual(bindings, {
        '.txt': { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
      });
      assert.deepEqual(warnings(), [], 'nothing to report');
    });

    test('a relative module resolves against the realm, not the file', function (assert) {
      let { bindingsFor } = collect();
      let bindings = bindingsFor({
        '.txt': { module: './audit-log', name: 'AuditLog' },
      });

      assert.strictEqual(
        bindings['.txt'].module,
        `${REALM.href}audit-log`,
        'a binding is the realm’s statement about a kind of file, so it ' +
          'names one module however deep the file it types sits',
      );
      assert.strictEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}logs/2026/audit.txt`),
          new VirtualNetwork(),
          bindings,
        ).module,
        `${REALM.href}audit-log`,
        'and a file in a subdirectory resolves that same module',
      );
    });

    test('an extension is matched however the author spelled it', function (assert) {
      let { bindingsFor } = collect();

      assert.deepEqual(
        Object.keys(bindingsFor({ '.TXT': AUDIT_LOG })),
        ['.txt'],
        'case is not part of the key',
      );
      assert.deepEqual(
        Object.keys(bindingsFor({ txt: AUDIT_LOG })),
        ['.txt'],
        'nor is the leading dot',
      );
    });
  });

  module('what is refused', function () {
    test("an extension that names the platform's own machinery", function (assert) {
      let { bindingsFor, warnings } = collect();
      let bindings = bindingsFor({
        '.gts': AUDIT_LOG,
        '.ts': AUDIT_LOG,
        '.json': AUDIT_LOG,
      });

      assert.deepEqual(
        bindings,
        {},
        'a module\u2019s source and a card instance\u2019s stored document ' +
          'are the platform\u2019s to type, though all three pass the ' +
          'is-this-a-file test',
      );
      assert.strictEqual(warnings().length, 3, 'each is reported on its own');
    });

    test('an extension the platform does not read as a file', function (assert) {
      let { bindingsFor, warnings } = collect();
      let bindings = bindingsFor({ '.parquet': AUDIT_LOG });

      assert.deepEqual(bindings, {}, 'nothing binds');
      assert.true(
        warnings()[0]?.includes('.parquet'),
        `the refusal names the extension: ${warnings()[0]}`,
      );
    });

    test('a value that does not name a class', function (assert) {
      let { bindingsFor, warnings } = collect();
      let bindings = bindingsFor({
        '.txt': { module: './audit-log' },
        '.md': 'audit-log',
      });

      assert.deepEqual(bindings, {}, 'neither binds');
      assert.strictEqual(warnings().length, 2, 'each is reported on its own');
    });

    test('a map that is not a map', function (assert) {
      let { bindingsFor, warnings } = collect();

      assert.deepEqual(bindingsFor([AUDIT_LOG]), {});
      assert.deepEqual(bindingsFor('audit-log'), {});
      assert.strictEqual(warnings().length, 2);
    });

    test('nothing at all, which is every realm today', function (assert) {
      let { bindingsFor, warnings } = collect();

      assert.deepEqual(bindingsFor(undefined), {});
      assert.deepEqual(bindingsFor(null), {});
      assert.deepEqual(
        warnings(),
        [],
        'a realm that declares none has not made a mistake',
      );
    });

    test('one bad declaration does not cost the others', function (assert) {
      let { bindingsFor, warnings } = collect();
      let bindings = bindingsFor({
        '.txt': AUDIT_LOG,
        '.parquet': AUDIT_LOG,
      });

      assert.deepEqual(Object.keys(bindings), ['.txt']);
      assert.strictEqual(warnings().length, 1);
    });
  });

  module('what a file resolves to', function () {
    let virtualNetwork = new VirtualNetwork();
    let bindings: FileDefBindings = {
      '.txt': { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
    };

    test('a bound extension answers with the realm’s class', function (assert) {
      assert.deepEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}audit.txt`),
          virtualNetwork,
          bindings,
        ),
        { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
      );
    });

    test('an extension the realm says nothing about is untouched', function (assert) {
      assert.deepEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}notes.md`),
          virtualNetwork,
          bindings,
        ),
        {
          module: rri(`${baseRealm.url}markdown-file-def`),
          name: 'MarkdownDef',
        },
      );
    });

    test('a log is a text file, bindable like any other', function (assert) {
      assert.deepEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}audit.log`),
          virtualNetwork,
          {},
        ),
        { module: rri(`${baseRealm.url}text-file-def`), name: 'TextFileDef' },
        'the platform types it as text rather than leaving it a bare FileDef',
      );
      assert.deepEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}audit.log`),
          virtualNetwork,
          {
            '.log': { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
          },
        ),
        { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
        'and a realm can bind it to a subclass of its own',
      );
    });

    test('an extension nothing knows still answers with the base file def', function (assert) {
      assert.deepEqual(
        resolveFileDefCodeRef(
          new URL(`${REALM.href}archive.bin`),
          virtualNetwork,
          bindings,
        ),
        baseFileRef,
      );
    });

    test('a realm that binds nothing resolves exactly as it did before', function (assert) {
      for (let path of ['audit.txt', 'notes.md', 'archive.bin']) {
        let url = new URL(`${REALM.href}${path}`);
        assert.deepEqual(
          resolveFileDefCodeRef(url, virtualNetwork, {}),
          resolveFileDefCodeRef(url, virtualNetwork),
          `${path} is typed the same with an empty map as with none`,
        );
      }
    });
  });

  // The order the three answers take when a file-meta resource is built —
  // the property that makes omitting a config dependency edge safe, since it
  // is what lets a binding take effect on an already-indexed realm without a
  // pass. Asserted against the function both readers call, so reordering it
  // fails here; an end-to-end fixture cannot see this, because every realm
  // that binds before it indexes has a row that already agrees.
  module('what a served resource names', function () {
    const BOUND = { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' };
    const ROW = { module: rri(`${REALM.href}stale`), name: 'StaleDef' };
    const RESOURCE = {
      module: rri(`${REALM.href}resource`),
      name: 'ResourceDef',
    };
    let bindings: FileDefBindings = { '.txt': BOUND };
    let url = new URL(`${REALM.href}audit.txt`);

    test('the realm\u2019s binding wins over a row that disagrees', function (assert) {
      assert.deepEqual(
        servedFileDefCodeRef(url, {
          bindings,
          rowAdoptsFrom: ROW,
          resourceAdoptsFrom: RESOURCE,
          fallback: baseFileRef,
        }),
        BOUND,
        'a row written before the binding does not outrank it',
      );
    });

    test('the row wins where the realm has said nothing', function (assert) {
      assert.deepEqual(
        servedFileDefCodeRef(new URL(`${REALM.href}notes.md`), {
          bindings,
          rowAdoptsFrom: ROW,
          resourceAdoptsFrom: RESOURCE,
          fallback: baseFileRef,
        }),
        ROW,
        'an unbound extension leaves the indexer\u2019s answer in charge',
      );
    });

    test('the resource answers when there is no row', function (assert) {
      assert.deepEqual(
        servedFileDefCodeRef(new URL(`${REALM.href}notes.md`), {
          bindings,
          rowAdoptsFrom: undefined,
          resourceAdoptsFrom: RESOURCE,
          fallback: baseFileRef,
        }),
        RESOURCE,
      );
    });

    test('the fallback answers when nothing else does', function (assert) {
      assert.deepEqual(
        servedFileDefCodeRef(new URL(`${REALM.href}notes.md`), {
          bindings: undefined,
          rowAdoptsFrom: undefined,
          resourceAdoptsFrom: undefined,
          fallback: baseFileRef,
        }),
        baseFileRef,
      );
    });
  });

  module('reading them from the realm', function () {
    test('the bindings come off the config document’s attributes', async function (assert) {
      let bindings = await readFileDefBindings({
        reader: readerOver({
          [`${REALM.href}realm.json`]: configDocument({
            fileTypes: { '.txt': { module: './audit-log', name: 'AuditLog' } },
          }),
        }),
        realmURL: REALM,
        virtualNetwork: new VirtualNetwork(),
        logWarn: () => {},
      });

      assert.deepEqual(bindings, {
        '.txt': { module: rri(`${REALM.href}audit-log`), name: 'AuditLog' },
      });
    });

    test('a realm with no config document binds nothing', async function (assert) {
      let bindings = await readFileDefBindings({
        reader: readerOver({}),
        realmURL: REALM,
        virtualNetwork: new VirtualNetwork(),
        logWarn: () => {},
      });

      assert.deepEqual(bindings, {});
    });

    test('a config document that does not parse is reported rather than thrown', async function (assert) {
      let warnings: string[] = [];
      let bindings = await readFileDefBindings({
        reader: readerOver({ [`${REALM.href}realm.json`]: '{ not json' }),
        realmURL: REALM,
        virtualNetwork: new VirtualNetwork(),
        logWarn: (message) => warnings.push(message),
      });

      assert.deepEqual(bindings, {}, 'the realm keeps serving its files');
      assert.strictEqual(warnings.length, 1, 'and the reason is not lost');
    });
  });
});
