import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import {
  canTraverseRelationshipDependency,
  relationshipDependencyForms,
} from '@cardstack/runtime-common/index-runner/dependency-normalization';

const realmURL = new URL('http://test/realm/');
const relativeTo = new URL('http://test/realm/consumer.json');
const prefix = '@cardstack/test-realm/';

// A VirtualNetwork stand-in that resolves relative references with the platform
// URL parser and maps one registered prefix onto the realm under test, so both
// branches of `relationshipDependencyForms` (prefix-form and URL-form) are
// reachable without standing up a network.
function makeStubNetwork(): VirtualNetwork {
  return {
    isRegisteredPrefix(reference: string) {
      return reference.startsWith(prefix);
    },
    toURL(reference: string) {
      return new URL(reference.slice(prefix.length), realmURL);
    },
    toURLHref(reference: string) {
      return new URL(reference.slice(prefix.length), realmURL).href;
    },
    resolveURL(reference: string, base: URL | string | undefined) {
      return new URL(reference, base ?? undefined);
    },
    unresolveURL(url: string) {
      return url;
    },
  } as unknown as VirtualNetwork;
}

function forms(dep: string, network = makeStubNetwork()): string[] {
  return relationshipDependencyForms(dep, relativeTo, realmURL, network);
}

module(basename(import.meta.filename), function () {
  module('relationshipDependencyForms', function () {
    test('resolves an extensionless in-realm card id to its `.json` row', function (assert) {
      assert.deepEqual(forms('http://test/realm/Person/mango'), [
        'http://test/realm/Person/mango.json',
      ]);
    });

    test('resolves a relative dep against the consuming resource', function (assert) {
      assert.deepEqual(forms('./Person/mango'), [
        'http://test/realm/Person/mango.json',
      ]);
    });

    test('leaves an in-realm file dep at its own URL', function (assert) {
      let network = makeStubNetwork();
      for (let dep of [
        'http://test/realm/logo.png',
        'http://test/realm/notes.md',
        'http://test/realm/song.mp3',
        'http://test/realm/hello.test.gts',
        'http://test/realm/bundled.js',
        'http://test/realm/person.json',
      ]) {
        assert.deepEqual(forms(dep, network), [dep], dep);
      }
    });

    test('records both forms for a dotted name no extension settles', function (assert) {
      let network = makeStubNetwork();
      assert.deepEqual(
        forms('http://test/realm/hello.test', network),
        ['http://test/realm/hello.test', 'http://test/realm/hello.test.json'],
        'a `hello.test` card id keeps the `.json` form invalidation matches on',
      );
      assert.deepEqual(
        forms(
          'http://test/realm/ModelConfiguration/claude-sonnet-4.6',
          network,
        ),
        [
          'http://test/realm/ModelConfiguration/claude-sonnet-4.6',
          'http://test/realm/ModelConfiguration/claude-sonnet-4.6.json',
        ],
      );
      assert.deepEqual(
        forms('http://test/realm/report.pdf', network),
        ['http://test/realm/report.pdf', 'http://test/realm/report.pdf.json'],
        'a file the FileDef registry does not name keeps its own URL alongside the card-id form',
      );
      assert.deepEqual(
        forms('http://test/realm/.gitignore', network),
        ['http://test/realm/.gitignore', 'http://test/realm/.gitignore.json'],
        'a leading dot is a name, not an extension, so it settles nothing either',
      );
    });

    test('reads a registered extension as a file however it is cased', function (assert) {
      let network = makeStubNetwork();
      assert.deepEqual(forms('http://test/realm/LOGO.PNG', network), [
        'http://test/realm/LOGO.PNG',
      ]);
      assert.deepEqual(
        forms('http://test/realm/types.d.ts', network),
        ['http://test/realm/types.d.ts'],
        'a declaration file is a file, not a card id',
      );
    });

    test('leaves an out-of-realm dep alone', function (assert) {
      let network = makeStubNetwork();
      assert.deepEqual(forms('http://other/realm/hello.test', network), [
        'http://other/realm/hello.test',
      ]);
      assert.deepEqual(forms('http://other/realm/person', network), [
        'http://other/realm/person',
      ]);
    });

    test('keeps a prefix-form dep in prefix form', function (assert) {
      let network = makeStubNetwork();
      assert.deepEqual(forms('@cardstack/test-realm/Person/mango', network), [
        '@cardstack/test-realm/Person/mango.json',
      ]);
      assert.deepEqual(forms('@cardstack/test-realm/logo.png', network), [
        '@cardstack/test-realm/logo.png',
      ]);
      assert.deepEqual(forms('@cardstack/test-realm/hello.test', network), [
        '@cardstack/test-realm/hello.test',
        '@cardstack/test-realm/hello.test.json',
      ]);
    });
  });

  module('canTraverseRelationshipDependency', function () {
    test('traverses in-realm deps that could name an index row', function (assert) {
      let network = makeStubNetwork();
      for (let dep of [
        'http://test/realm/person.json',
        'http://test/realm/hello.test.json',
        'http://test/realm/logo.png',
        'http://test/realm/hello.test.gts',
        'http://test/realm/report.pdf',
        '@cardstack/test-realm/person.json',
      ]) {
        assert.true(
          canTraverseRelationshipDependency(dep, realmURL, network),
          dep,
        );
      }
    });

    test('skips extensionless in-realm deps', function (assert) {
      let network = makeStubNetwork();
      for (let dep of [
        'http://test/realm/person',
        '@cardstack/test-realm/person',
      ]) {
        assert.false(
          canTraverseRelationshipDependency(dep, realmURL, network),
          `${dep} names no row of its own`,
        );
      }
    });

    test('skips deps outside the realm', function (assert) {
      assert.false(
        canTraverseRelationshipDependency(
          'http://other/realm/person.json',
          realmURL,
          makeStubNetwork(),
        ),
      );
    });

    test('rejects a dep that is not a URL at all', function (assert) {
      let network = makeStubNetwork();
      for (let dep of ['not a url', './relative/person.json', '']) {
        assert.false(
          canTraverseRelationshipDependency(dep, realmURL, network),
          JSON.stringify(dep),
        );
      }
    });

    test('classifies by the path alone when a query or hash is present', function (assert) {
      let network = makeStubNetwork();
      assert.true(
        canTraverseRelationshipDependency(
          'http://test/realm/logo.png?cache=1',
          realmURL,
          network,
        ),
        'query string does not hide the file extension',
      );
      assert.false(
        canTraverseRelationshipDependency(
          'http://test/realm/person?v=1.2',
          realmURL,
          network,
        ),
        'a dotted query string does not make an instance id look dotted',
      );
    });
  });
});
