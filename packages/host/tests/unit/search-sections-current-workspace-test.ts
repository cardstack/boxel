import { module, test } from 'qunit';

import { baseRRI, rri, type CodeRef } from '@cardstack/runtime-common';

import {
  buildQuerySections,
  type OfferToCreate,
} from '@cardstack/host/utils/search/sections';

// The card chooser lists the workspace of the card being edited first and
// marks it current.
module('Unit | search sections | current workspace', function () {
  const PARENT = 'https://realm.example/user/';
  const NESTED = 'https://realm.example/user/alice/';
  const OTHER = 'https://realm.example/other/';
  const ref: CodeRef = { module: rri(`${baseRRI}card-api`), name: 'CardDef' };

  function sections(
    realmURLs: string[],
    offerToCreate: OfferToCreate,
    canonical?: (identifier: string) => string,
  ) {
    let result = buildQuerySections([], {
      isURL: false,
      isSearchKeyEmpty: true,
      hasBaseFilter: true,
      realmURLs,
      offerToCreate,
      realm: { info: () => null },
      canonical,
    })!;
    return {
      order: result.map((section) => section.realmUrl),
      current: result
        .filter((section) => section.isCurrent)
        .map((section) => section.realmUrl),
    };
  }

  test('lists the workspace named by realmURL first and marks it', function (assert) {
    let { order, current } = sections([OTHER, NESTED], {
      ref,
      relativeTo: new URL(`${OTHER}Person/1`),
      realmURL: new URL(NESTED),
    });
    assert.deepEqual(order, [NESTED, OTHER], 'realmURL wins over relativeTo');
    assert.deepEqual(current, [NESTED]);
  });

  test('falls back to the workspace holding relativeTo', function (assert) {
    let { current } = sections([NESTED, OTHER], {
      ref,
      relativeTo: new URL(`${OTHER}Person/1`),
    });
    assert.deepEqual(current, [OTHER]);
  });

  test('picks the nested workspace over the one it sits in', function (assert) {
    let { current } = sections([PARENT, NESTED], {
      ref,
      relativeTo: undefined,
      realmURL: new URL(NESTED),
    });
    assert.deepEqual(current, [NESTED]);
  });

  test('matches a workspace listed under its prefix form', function (assert) {
    let { current } = sections(
      ['@cardstack/alice/', OTHER],
      { ref, relativeTo: undefined, realmURL: new URL(NESTED) },
      (identifier) => identifier.replace('@cardstack/alice/', NESTED),
    );
    assert.deepEqual(current, ['@cardstack/alice/']);
  });

  test('marks nothing when the workspace is not listed', function (assert) {
    let { order, current } = sections([OTHER], {
      ref,
      relativeTo: undefined,
      realmURL: new URL(NESTED),
    });
    assert.deepEqual(order, [OTHER]);
    assert.deepEqual(current, []);
  });
});
