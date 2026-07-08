import { module, test } from 'qunit';

import {
  canonicalQuerySignature,
  VirtualNetwork,
  rri,
  type Query,
} from '@cardstack/runtime-common';

module('Unit | canonicalQuerySignature', function (hooks) {
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(function () {
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping('@scope/realm/', 'https://realm.example/');
  });

  function sig(query: Query) {
    return canonicalQuerySignature(query, virtualNetwork);
  }

  test('prefix and URL spellings of the same query produce the same signature', function (assert) {
    let urlForm: Query = {
      filter: {
        on: { module: rri('https://realm.example/defs'), name: 'Pet' },
        in: { id: ['https://realm.example/Pet/mango'] },
      },
      sort: [
        {
          by: 'name',
          on: { module: rri('https://realm.example/defs'), name: 'Pet' },
        },
      ],
    };
    let prefixForm: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        in: { id: ['@scope/realm/Pet/mango'] },
      },
      sort: [
        {
          by: 'name',
          on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        },
      ],
    };
    assert.strictEqual(
      sig(urlForm),
      sig(prefixForm),
      'equivalent spellings collapse to one signature',
    );
  });

  test('genuinely different queries keep different signatures', function (assert) {
    let base: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        in: { id: ['@scope/realm/Pet/mango'] },
      },
    };
    let differentName: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Person' },
        in: { id: ['@scope/realm/Pet/mango'] },
      },
    };
    let differentId: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        in: { id: ['@scope/realm/Pet/paper'] },
      },
    };
    assert.notStrictEqual(sig(base), sig(differentName));
    assert.notStrictEqual(sig(base), sig(differentId));
  });

  test('non-reference filter values are not collapsed', function (assert) {
    // `title` is not a reference leaf, so a prefix-looking string value and
    // its resolved URL remain distinct queries.
    let a: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        eq: { cardTitle: '@scope/realm/Pet/mango' },
      },
    };
    let b: Query = {
      filter: {
        on: { module: rri('@scope/realm/defs'), name: 'Pet' },
        eq: { cardTitle: 'https://realm.example/Pet/mango' },
      },
    };
    assert.notStrictEqual(sig(a), sig(b));
  });

  test('unmapped references pass through unchanged', function (assert) {
    let a: Query = {
      filter: {
        on: { module: rri('https://other.example/defs'), name: 'Pet' },
        in: { id: ['https://other.example/Pet/mango'] },
      },
    };
    assert.strictEqual(sig(a), sig(a), 'deterministic');
    let b: Query = {
      filter: {
        on: { module: rri('https://other.example/defs'), name: 'Pet' },
        in: { id: ['https://other.example/Pet/paper'] },
      },
    };
    assert.notStrictEqual(sig(a), sig(b));
  });
});
