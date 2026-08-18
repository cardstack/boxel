import { module, test } from 'qunit';

import {
  applyStickyHeaderClip,
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

module('Unit | overlays | applyStickyHeaderClip', function (hooks) {
  // Exercises the middleware wiring end to end: it reads the live rects of the
  // card and its sticky header and assigns `floating.style.clipPath`. That
  // needs real layout, so the fixture is attached to `document.body` (outside
  // `#ember-testing`, so no runner scale) and each element is `position: fixed`
  // to pin its rect to a known viewport coordinate independent of scroll. The
  // header bottom lands at 50px throughout.
  let mounted: HTMLElement[] = [];

  hooks.afterEach(function () {
    mounted.forEach((el) => el.remove());
    mounted = [];
  });

  function mountCard(cardTop: number) {
    let container = document.createElement('div');
    container.setAttribute('data-overlay-clip-container', '');

    let header = document.createElement('div');
    header.setAttribute('data-overlay-clip-header', '');
    header.style.cssText =
      'position: fixed; top: 0; left: 0; width: 200px; height: 50px;';

    let card = document.createElement('div');
    card.style.cssText = `position: fixed; left: 0; top: ${cardTop}px; width: 200px; height: 200px;`;

    container.append(header, card);
    document.body.append(container);
    mounted.push(container);
    return card;
  }

  test('clips the overlay while the card sits behind the sticky header', function (assert) {
    let card = mountCard(20); // card top 20 is 30px above the header bottom (50)
    let floating = document.createElement('div');

    applyStickyHeaderClip(card, floating);

    assert.notStrictEqual(floating.style.clipPath, '', 'a clip is applied');
    assert.ok(
      floating.style.clipPath.includes('30px'),
      'the clip reads the live rects — the top 30px behind the header is cut',
    );
  });

  test('clears the clip once the card scrolls clear of the header', function (assert) {
    let card = mountCard(100); // card top 100 is below the header bottom (50)
    let floating = document.createElement('div');
    floating.style.clipPath = 'inset(30px -0.5rem -0.5rem -0.5rem)'; // stale clip

    applyStickyHeaderClip(card, floating);

    assert.strictEqual(
      floating.style.clipPath,
      '',
      'the stale clip is cleared when nothing occludes the card',
    );
  });

  test('clears the clip for a card outside any marked container', function (assert) {
    let card = document.createElement('div');
    let floating = document.createElement('div');
    floating.style.clipPath = 'inset(30px -0.5rem -0.5rem -0.5rem)'; // stale clip

    applyStickyHeaderClip(card, floating);

    assert.strictEqual(floating.style.clipPath, '', 'no container, no clip');
  });
});
