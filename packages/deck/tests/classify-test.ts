import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  classifyReference,
  summarise,
  type Classification,
} from '../src/classify.ts';

// The decklist a Boxel realm would carry once its base fields are a
// dependency rather than a special case.
const IMPORTS = {
  '@cardstack/base/': 'https://cardstack.com/base/',
  '@cardstack/boxel-ui/': 'https://cardstack.com/boxel-ui/',
  three: 'https://deck.example/lib/three@0.169.0/three.js',
  'three-bvh-csg': 'https://deck.example/lib/three-bvh-csg@0.0.16/index.js',
};

const SOURCE = 'https://realms.example/chris/my-realm/';

function ref(value: string, extra = {}): Classification {
  return classifyReference({
    value,
    role: 'reference',
    imports: IMPORTS,
    sourceBase: SOURCE,
    ...extra,
  });
}

module('classify: data is never touched', function () {
  // The whole reason this module exists. cardpack treated every string in
  // every JSON file as a rewrite candidate; an asset URL survived only by
  // not matching a rule.
  test('an opaque value is left alone whatever it looks like', function (assert) {
    for (let value of [
      'https://boxel-images.example/icons/Letter-c.png',
      'https://cardstack.com/base/realm-config', // matches a dependency!
      `${SOURCE}looks/exactly/like/ours.json`, // matches the source base!
      './even/a/relative/one.png',
    ]) {
      assert.deepEqual(
        classifyReference({
          value,
          role: 'opaque',
          imports: IMPORTS,
          sourceBase: SOURCE,
        }),
        { action: 'leave', reason: 'opaque' },
        value,
      );
    }
  });
});

module('classify: references', function () {
  test('a within-tree relative reference needs no help', function (assert) {
    assert.deepEqual(ref('./catalog-app/catalog'), {
      action: 'leave',
      reason: 'relative',
    });
    assert.deepEqual(ref('../Theme/catalog-storefront'), {
      action: 'leave',
      reason: 'relative',
    });
  });

  test('a bare specifier resolves through the map, so it moves with it', function (assert) {
    assert.deepEqual(ref('notes/theme'), { action: 'leave', reason: 'bare' });
  });

  test('a declared dependency rebinds, and reports its specifier', function (assert) {
    assert.deepEqual(ref('https://cardstack.com/base/realm-config'), {
      action: 'rebind',
      reason: 'declared-dependency',
      specifier: '@cardstack/base/',
      rest: 'realm-config',
    });
  });

  test('a reference into the tree being moved is rewritten', function (assert) {
    assert.deepEqual(ref(`${SOURCE}Theme/storefront.json`), {
      action: 'rewrite',
      reason: 'source-base',
      rest: 'Theme/storefront.json',
    });
  });

  // The one that would corrupt content if it were guessed at.
  test('an absolute that is neither declared nor ours is left, and reported', function (assert) {
    assert.deepEqual(ref('https://boxel-images.example/icons/Letter-c.png'), {
      action: 'leave',
      reason: 'foreign',
    });
    assert.deepEqual(ref('https://other-realm.example/someone/else/card.json'), {
      action: 'leave',
      reason: 'foreign',
    });
  });

  // Same discipline as resolveSpecifier: `three` and `three-bvh-csg` must
  // not depend on the order the keys happen to be in.
  test('the longest declared target wins, not the first', function (assert) {
    let overlapping = {
      lib: 'https://deck.example/lib/',
      'lib/three': 'https://deck.example/lib/three@0.169.0/',
    };
    assert.deepEqual(
      classifyReference({
        value: 'https://deck.example/lib/three@0.169.0/three.js',
        role: 'reference',
        imports: overlapping,
      }),
      {
        action: 'rebind',
        reason: 'declared-dependency',
        specifier: 'lib/three',
        rest: 'three.js',
      },
    );
  });

  // A deck lists its own modules in its map, so those match both rules.
  // Rebinding re-resolves through the destination's map instead of assuming
  // the destination lays the tree out the same way.
  test('declared beats source-base when both match', function (assert) {
    assert.deepEqual(
      classifyReference({
        value: `${SOURCE}theme.js`,
        role: 'reference',
        imports: { 'notes/theme': `${SOURCE}theme.js` },
        sourceBase: SOURCE,
      }),
      {
        action: 'rebind',
        reason: 'declared-dependency',
        specifier: 'notes/theme',
        rest: '',
      },
    );
  });

  test('with no decklist and no source base, every absolute is foreign', function (assert) {
    assert.deepEqual(
      classifyReference({ value: 'https://x.example/a.js', role: 'reference' }),
      { action: 'leave', reason: 'foreign' },
    );
  });
});

module('classify: reporting', function () {
  // A migration that reports only its successes reads as complete when it
  // is not.
  test('the summary names what was not carried', function (assert) {
    let values = [
      './local.js',
      'https://cardstack.com/base/string',
      `${SOURCE}other.json`,
      'https://third-party.example/widget.js',
    ];
    let seen = values.map((value) => ({ value, result: ref(value) }));
    let report = summarise(seen);
    assert.strictEqual(report.rebind, 1);
    assert.strictEqual(report.rewrite, 1);
    assert.strictEqual(report.leave, 2);
    assert.deepEqual(report.foreign, ['https://third-party.example/widget.js']);
  });
});

// The acceptance gate from the work plan, using the strings that are
// actually in ~/Projects/boxel-catalog today.
module('classify: the boxel-catalog gate', function () {
  const CATALOG_IMPORTS = { '@cardstack/base/': 'https://cardstack.com/base/' };
  const CATALOG_BASE = 'https://app.example/catalog/';

  test('index.json: relative references survive relocation untouched', function (assert) {
    for (let value of [
      './catalog-app/catalog', // meta.adoptsFrom.module
      './Theme/catalog-storefront', // relationships.cardInfo.theme
      './4b6602-wine-cellar-card-definition/CardListing/6152b86e', // featured.0
    ]) {
      assert.strictEqual(
        classifyReference({
          value,
          role: 'reference',
          imports: CATALOG_IMPORTS,
          sourceBase: CATALOG_BASE,
        }).action,
        'leave',
        value,
      );
    }
  });

  test('realm.json: the base module rebinds, the artwork does not move', function (assert) {
    // meta.adoptsFrom.module — a reference, and a declared dependency.
    assert.deepEqual(
      classifyReference({
        value: 'https://cardstack.com/base/realm-config',
        role: 'reference',
        imports: CATALOG_IMPORTS,
        sourceBase: CATALOG_BASE,
      }),
      {
        action: 'rebind',
        reason: 'declared-dependency',
        specifier: '@cardstack/base/',
        rest: 'realm-config',
      },
    );

    // attributes.backgroundURL and attributes.iconURL — data. This is the
    // assertion that matters: a classifier that corrupts these is worse than
    // no classifier at all.
    for (let value of [
      'https://boxel-images.boxel.ai/background-images/background-for-catalog-82x.jpg',
      'https://boxel-images.boxel.ai/icons/Letter-c.png',
    ]) {
      assert.deepEqual(
        classifyReference({
          value,
          role: 'opaque',
          imports: CATALOG_IMPORTS,
          sourceBase: CATALOG_BASE,
        }),
        { action: 'leave', reason: 'opaque' },
        value,
      );
      // And even if a caller wrongly labelled it a reference, it is still
      // left alone — belt and braces, because this is the corrupting case.
      assert.strictEqual(
        classifyReference({
          value,
          role: 'reference',
          imports: CATALOG_IMPORTS,
          sourceBase: CATALOG_BASE,
        }).action,
        'leave',
        `${value} as a reference`,
      );
    }
  });
});
