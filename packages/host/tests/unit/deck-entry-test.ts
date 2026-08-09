import { resolveSpecifier } from '@cardstack/deck';
import { module, test } from 'qunit';

// PR 0 wires `@cardstack/deck` into the workspace without changing any realm
// behavior. The one thing that must be proven here is the property the whole
// split rests on: the root entry is browser-safe.
//
// This file is that proof, and it is a host test on purpose. The host graph
// is bundled for a browser, so a `node:fs` anywhere in the closure of
// `@cardstack/deck` fails the build rather than surfacing later as a broken
// production bundle. Deck's own suite asserts the same property by walking
// imports (`packages/deck/tests/entries-test.ts`); this asserts it by
// actually building and running the code in the target environment.
//
// Do not import `@cardstack/deck/node` from host — that entry reaches the
// filesystem and belongs to realm-server.
module('Unit | deck | browser entry', function () {
  test('the root entry loads in the host build and resolves a specifier', function (assert) {
    // Calling it, not just importing it: an import can survive tree-shaking
    // of a broken module, a call cannot.
    let resolved = resolveSpecifier({
      specifier: 'three',
      fromUrl: 'https://example.com/workspace/acme/gallery/scene.gts',
      imports: {
        three:
          'https://example.com/catalog/lib/three@0.169.0/build/three.module.js',
      },
      scopes: {},
    });

    assert.strictEqual(
      resolved,
      'https://example.com/catalog/lib/three@0.169.0/build/three.module.js',
      'a bare specifier resolves through the import map',
    );

    assert.strictEqual(
      resolveSpecifier({
        specifier: 'unmapped',
        fromUrl: 'https://example.com/workspace/acme/gallery/scene.gts',
        imports: {},
        scopes: {},
      }),
      undefined,
      'an unmapped specifier is undefined, not a blank — the fallback signal',
    );
  });
});
