import { module, test } from 'qunit';

import {
  stickyClipHeaderFor,
  stickyHeaderClipPath,
} from '@cardstack/host/components/operator-mode/overlays';

module('Unit | overlays | stickyHeaderClipPath', function () {
  test('no clip while the card sits below the sticky header', function (assert) {
    // Card top (100) is below the header bottom (50): nothing is occluded.
    assert.strictEqual(stickyHeaderClipPath(100, 50), '');
  });

  test('no clip when the card top is flush with the header bottom', function (assert) {
    assert.strictEqual(stickyHeaderClipPath(50, 50), '');
  });

  test('clips the strip that has slid behind the header', function (assert) {
    // Card top (20) is 30px above the header bottom (50): clip the top 30px,
    // extending the other edges so the box-shadow ring survives on the
    // still-visible portion.
    assert.strictEqual(
      stickyHeaderClipPath(20, 50),
      'inset(30px -0.5rem -0.5rem -0.5rem)',
    );
  });

  test('clamps to no clip when the card top is far below the header', function (assert) {
    assert.strictEqual(stickyHeaderClipPath(500, 50), '');
  });
});

module('Unit | overlays | stickyClipHeaderFor', function () {
  // Builds a detached clip container with its header and a card inside it —
  // mirroring the `data-overlay-clip-*` markers the codemirror editor renders.
  // closest()/querySelector() work on detached DOM, so no fixture is needed.
  function makeContainer() {
    let container = document.createElement('div');
    container.setAttribute('data-overlay-clip-container', '');
    let header = document.createElement('div');
    header.setAttribute('data-overlay-clip-header', '');
    let card = document.createElement('div');
    container.append(header, card);
    return { container, header, card };
  }

  test('finds the sticky header for a card inside a marked container', function (assert) {
    let { header, card } = makeContainer();
    assert.strictEqual(stickyClipHeaderFor(card), header);
  });

  test('returns null for a card outside any marked container', function (assert) {
    let card = document.createElement('div');
    assert.strictEqual(stickyClipHeaderFor(card), null);
  });

  test('scopes to the nearest container when editors are nested', function (assert) {
    let outer = makeContainer();
    let inner = makeContainer();
    outer.container.append(inner.container);

    // A card in the inner editor clips against the inner toolbar...
    assert.strictEqual(stickyClipHeaderFor(inner.card), inner.header);
    // ...while a card in the outer editor clips against the outer toolbar
    // (the first `[data-overlay-clip-header]` in document order).
    assert.strictEqual(stickyClipHeaderFor(outer.card), outer.header);
  });
});
