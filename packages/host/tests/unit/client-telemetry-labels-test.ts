import { module, test } from 'qunit';

import {
  normalizeEndpoint,
  codeRefURL,
} from '@cardstack/host/lib/client-telemetry-labels';

// Both of these exist to keep a dashboard label low-cardinality. A label carrying
// a per-instance id gives Loki a new series per card, so what they collapse — and
// what they deliberately keep — is the contract worth pinning.
module('Unit | lib | client-telemetry-labels', function () {
  module('normalizeEndpoint', function () {
    let cases: Array<[string, string, string, string]> = [
      [
        'an underscore endpoint collapses to its own name',
        'POST',
        'https://realm.example/my-realm/_search',
        '_search',
      ],
      [
        'and does so from anywhere in the path',
        'GET',
        'https://realm.example/_catalog-realms',
        '_catalog-realms',
      ],
      [
        'an instance id collapses to the kind, carrying no id',
        'GET',
        'https://realm.example/my-realm/Person/abc123',
        'GET card',
      ],
      [
        'a source module is its own kind',
        'GET',
        'https://realm.example/my-realm/person.gts',
        'GET source',
      ],
      [
        'a json document reads as file metadata',
        'GET',
        'https://realm.example/my-realm/Person/abc123.json',
        'GET file-meta',
      ],
      [
        'anything else with an extension is a file',
        'GET',
        'https://realm.example/my-realm/logo.png',
        'GET file',
      ],
      [
        'the method is part of the label, so writes read apart from reads',
        'PATCH',
        'https://realm.example/my-realm/Person/abc123',
        'PATCH card',
      ],
    ];

    cases.forEach(([label, method, url, expected]) => {
      test(label, function (assert) {
        assert.strictEqual(normalizeEndpoint(url, method), expected);
      });
    });

    test('an unparseable url still yields a label rather than throwing', function (assert) {
      // The middleware hands over whatever `request.url` held; a label is worth
      // more than an exception thrown from a telemetry hook.
      assert.strictEqual(normalizeEndpoint('not a url', 'GET'), 'GET card');
    });

    test('two instances of one type share a label', function (assert) {
      // The whole point: per-id labels would be a Loki series per card.
      assert.strictEqual(
        normalizeEndpoint('https://realm.example/my-realm/Person/abc', 'GET'),
        normalizeEndpoint('https://realm.example/my-realm/Person/xyz', 'GET'),
      );
    });
  });

  module('codeRefURL', function () {
    test('addresses a type by module and export, not a bare class name', function (assert) {
      assert.strictEqual(
        codeRefURL(
          { module: 'https://realm.example/my-realm/person', name: 'Person' },
          'https://realm.example/my-realm/Person/abc123',
        ),
        'https://realm.example/my-realm/person/Person',
        'so a dashboard row says where the code lives',
      );
    });

    test('resolves a relative module against the instance it came from', function (assert) {
      assert.strictEqual(
        codeRefURL(
          { module: '../person', name: 'Person' },
          'https://realm.example/my-realm/people/abc123',
        ),
        'https://realm.example/my-realm/person/Person',
      );
    });

    test('passes a scoped specifier through as already canonical', function (assert) {
      assert.strictEqual(
        codeRefURL(
          { module: '@cardstack/base/card-api', name: 'CardDef' },
          'https://realm.example/my-realm/Person/abc123',
        ),
        '@cardstack/base/card-api/CardDef',
      );
    });

    test('keeps the relative spelling rather than dropping the event', function (assert) {
      // No instance id to resolve against — a partial label beats none.
      assert.strictEqual(
        codeRefURL({ module: './person', name: 'Person' }, undefined),
        './person/Person',
      );
    });

    test('returns null for a ref that names no export', function (assert) {
      // fieldOf / ancestorOf refs have no direct name, and a card can be built
      // locally with no adoptsFrom at all.
      assert.strictEqual(codeRefURL(undefined, 'https://x/y'), null);
      assert.strictEqual(codeRefURL({}, 'https://x/y'), null);
      assert.strictEqual(
        codeRefURL({ module: 'https://x/person' }, 'https://x/y'),
        null,
      );
      assert.strictEqual(codeRefURL({ name: 'Person' }, 'https://x/y'), null);
    });
  });
});
