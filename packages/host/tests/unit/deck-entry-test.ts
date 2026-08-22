import { resolveRRI, rri } from '@cardstack/deck';
import { module, test } from 'qunit';

// A0 adds Deck Core without changing realm behavior. This host test proves
// the important integration property: the root entry and its RRI resolver
// really load in Boxel's browser bundle. Server code may additionally import
// @cardstack/deck/node; host code must not.
module('Unit | deck | browser entry', function () {
  test('the root entry resolves canonical identity in the host build', function (assert) {
    let resolved = resolveRRI({
      specifier: 'three',
      fromRRI: '@acme/gallery/scene.gts',
      imports: {
        three: rri('@catalog/three@0.169.0/build/three.module.js'),
      },
      scopes: {},
    });

    assert.strictEqual(
      resolved,
      '@catalog/three@0.169.0/build/three.module.js',
      'a bare specifier resolves to an exact Version RRI',
    );

    assert.strictEqual(
      resolveRRI({
        specifier: 'unmapped',
        fromRRI: '@acme/gallery/scene.gts',
        imports: {},
        scopes: {},
      }),
      undefined,
      'an unmapped specifier remains the loader fallback signal',
    );
  });
});
