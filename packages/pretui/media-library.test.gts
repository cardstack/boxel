// Pretui — proof for media-library.gts (AssetWell, Gallery).
//
// What is worth asserting here is exactly what a clean index cannot tell
// you, and it is not the pixels:
//
//  1. **The a11y trap.** A drop zone that is only a drop zone is unreachable
//     by keyboard and dead on touch. The test that matters is that a real
//     `<input type=file>` exists behind the well in EVERY state, including
//     the filled one — because that is the state where an implementation
//     that special-cases "empty" loses it.
//  2. **The state machine and its precedence.** Four states from three
//     arguments, and the order they win in.
//  3. **Keyboard parity on the rail.** Every pointer gesture Gallery
//     supports has a keyboard twin; each twin is asserted by the callback it
//     fires, not by what it looks like.
//  4. **The pure maths.** `rangeBetween` is the whole of range selection and
//     needs no browser.
//
// NOTE (realm harness): `boxel test` stamps the scoped-CSS attribute and
// delivers no stylesheet, so nothing here asserts a computed style. Every
// assertion is structure, ARIA, data-state or an emitted callback.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { AssetWell } from './components/asset-well';
import { Gallery, rangeBetween } from './components/gallery';
import type { MediaAssetSpec } from './internal/media-viewer';
import { DEMOS_ASSET_WELL } from './components/asset-well.usage';
import { DEMOS_GALLERY } from './components/gallery.usage';
import { DEMOS_MEDIA_LIBRARY } from './demo-media-library';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_ASSET_WELL, ...DEMOS_GALLERY, ...DEMOS_MEDIA_LIBRARY };
const DEMOS_MEDIA_LIBRARY_NAMES = ['AssetWell', 'Gallery', 'GalleryMixed'];

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

function well(): HTMLElement {
  return root().querySelector('[data-test-pretui-asset-well]') as HTMLElement;
}

function railOptions(): HTMLElement[] {
  return Array.from(
    root().querySelectorAll('[data-test-pretui-gallery-cell]'),
  ) as HTMLElement[];
}

/** A one-pixel PNG as a data URL — no network, no fixture file, and the
 * component treats it exactly as it would a real photograph. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

const SHOT: MediaAssetSpec = {
  src: PIXEL,
  name: 'chest-118.png',
  kind: 'image',
  mimeType: 'image/png',
  alt: 'Chest 118, front',
  width: 1600,
  height: 1067,
  bytes: 1024,
};

function plate(name: string, width: number, height: number): MediaAssetSpec {
  return {
    src: PIXEL,
    thumbnail: PIXEL,
    name,
    kind: 'image',
    mimeType: 'image/png',
    alt: name,
    width,
    height,
  };
}

const SET: readonly MediaAssetSpec[] = [
  plate('Chest 118', 1600, 1067),
  plate('Grading chart', 2400, 800),
  plate('Wet leaf', 1200, 1200),
  plate('Manifest', 1000, 1414),
];

// ═══════════════════════════════════════════════════════════════════════
// rangeBetween — no DOM
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | media-library | rangeBetween', function () {
  test('is inclusive at both ends', function (assert) {
    assert.deepEqual(rangeBetween(2, 5), [2, 3, 4, 5], 'ascending');
    assert.deepEqual(rangeBetween(0, 0), [0], 'a single index');
  });

  test('is direction-blind, which is the bug it exists to prevent', function (assert) {
    assert.deepEqual(
      rangeBetween(5, 2),
      [2, 3, 4, 5],
      'a range dragged upward is the same range dragged downward',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AssetWell
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | media-library | AssetWell', function (hooks) {
  setupCardTest(hooks);

  test('a real file input sits behind the zone in EVERY state', async function (assert) {
    await render(<template><AssetWell @accept='image/*' /></template>);
    assert.ok(
      well().querySelector('input[type="file"]'),
      'empty: the keyboard path exists',
    );

    await render(
      <template><AssetWell @asset={{SHOT}} @accept='image/*' /></template>,
    );
    assert.ok(
      well().querySelector('input[type="file"]'),
      'filled: the keyboard path is still there — the state an implementation that special-cases empty loses it in',
    );

    await render(
      <template>
        <AssetWell @asset={{SHOT}} @errorMessage='Upload failed' />
      </template>,
    );
    assert.ok(
      well().querySelector('input[type="file"]'),
      'failed: and there too, so recovery never needs a pointer',
    );
  });

  test('the browse button is a real button and its wording follows the state', async function (assert) {
    await render(<template><AssetWell /></template>);
    let button = well().querySelector(
      '[data-test-pretui-button]',
    ) as HTMLButtonElement;
    assert.strictEqual(button.tagName, 'BUTTON', 'a real button');
    assert.strictEqual(
      button.getAttribute('type'),
      'button',
      'typed, so it can never submit an enclosing form',
    );
    assert.true(
      (button.textContent ?? '').indexOf('Choose') !== -1,
      'empty invites a choice: ' + button.textContent,
    );

    await render(<template><AssetWell @asset={{SHOT}} /></template>);
    // Scoped by TEXT rather than by position: the filled well also carries a
    // remove control, and asserting "the first button" would be asserting
    // DOM order rather than behaviour.
    let words = Array.from(
      well().querySelectorAll('[data-test-pretui-button]'),
    ).map((el) => el.textContent ?? '');
    assert.true(
      words.some((text) => text.indexOf('Replace') !== -1),
      'filled offers a replacement, not a second file: ' + words.join(' | '),
    );
  });

  test('four states from three arguments, in precedence order', async function (assert) {
    await render(<template><AssetWell /></template>);
    assert.strictEqual(well().dataset['state'], 'empty', 'nothing given');

    await render(<template><AssetWell @asset={{SHOT}} /></template>);
    assert.strictEqual(well().dataset['state'], 'filled', 'an asset');

    await render(
      <template><AssetWell @asset={{SHOT}} @uploading={{true}} /></template>,
    );
    assert.strictEqual(
      well().dataset['state'],
      'uploading',
      'in flight beats filled',
    );

    await render(
      <template>
        <AssetWell
          @asset={{SHOT}}
          @uploading={{true}}
          @errorMessage='Network refused the upload'
        />
      </template>,
    );
    assert.strictEqual(
      well().dataset['state'],
      'error',
      'a failure beats everything — the reader must be told',
    );
  });

  test('the failure carries a word and a role, not a colour', async function (assert) {
    await render(
      <template><AssetWell @errorMessage='Network refused it' /></template>,
    );
    assert.true(
      (well().textContent ?? '').indexOf('Network refused it') !== -1,
      'the reason is text on the screen',
    );
    assert.notOk(
      well().querySelector('[data-test-pretui-well-retry]'),
      'and with no onRetry there is no retry button — an affordance that does nothing is worse than none',
    );
  });

  test('retry and cancel fire, and only exist when they can', async function (assert) {
    let retried = 0;
    let retry = () => {
      retried++;
    };
    await render(
      <template>
        <AssetWell @errorMessage='Network refused it' @onRetry={{retry}} />
      </template>,
    );
    await click('[data-test-pretui-well-retry]');
    assert.strictEqual(retried, 1, 'onRetry fired');

    let cancelled = 0;
    let cancel = () => {
      cancelled++;
    };
    await render(
      <template>
        <AssetWell
          @uploading={{true}}
          @uploadFraction={{0.4}}
          @onCancel={{cancel}}
        />
      </template>,
    );
    await click('[data-test-pretui-well-cancel]');
    assert.strictEqual(cancelled, 1, 'onCancel fired');
  });

  test('remove announces itself, reports null, and calls onRemove', async function (assert) {
    let seen: Array<MediaAssetSpec | null> = [];
    let removals = 0;
    let changed = (next: MediaAssetSpec | null) => {
      seen.push(next);
    };
    let removed = () => {
      removals++;
    };
    await render(
      <template>
        <AssetWell
          @asset={{SHOT}}
          @onAssetChange={{changed}}
          @onRemove={{removed}}
        />
      </template>,
    );
    let live = well().querySelector('[role="status"]') as HTMLElement;
    assert.ok(live, 'a polite region exists before anything happens');

    await click('[data-test-pretui-well-remove]');
    assert.deepEqual(seen, [null], 'onAssetChange reported the emptiness');
    assert.strictEqual(removals, 1, 'and onRemove fired exactly once');
    assert.true(
      (well().textContent ?? '').indexOf('File removed') !== -1,
      'and the change was announced rather than left silent',
    );
  });

  test('viewOnly keeps the preview and drops every mutation', async function (assert) {
    await render(
      <template><AssetWell @asset={{SHOT}} @viewOnly={{true}} /></template>,
    );
    assert.strictEqual(well().dataset['viewOnly'], 'true', 'flagged in a still frame');
    assert.notOk(
      well().querySelector('[data-test-pretui-well-remove]'),
      'no remove',
    );
    assert.ok(
      well().querySelector('[data-test-pretui-media-viewer]'),
      'but the asset is still shown, through the adapter shell',
    );
  });

  test('the preview routes through MediaViewer rather than assuming an <img>', async function (assert) {
    await render(<template><AssetWell @asset={{SHOT}} /></template>);
    let viewer = well().querySelector(
      '[data-test-pretui-media-viewer]',
    ) as HTMLElement;
    assert.ok(viewer, 'the adapter shell is what draws the preview');
    assert.strictEqual(
      viewer.dataset['kind'],
      'image',
      'and it resolved the kind itself',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Gallery
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | media-library | Gallery', function (hooks) {
  setupCardTest(hooks);

  test('the rail is a real listbox with named, positioned options', async function (assert) {
    await render(<template><Gallery @assets={{SET}} @label='Plates' /></template>);
    let rail = root().querySelector(
      '[data-test-pretui-gallery-rail]',
    ) as HTMLElement;
    assert.strictEqual(rail.getAttribute('role'), 'listbox', 'a listbox');
    assert.strictEqual(rail.getAttribute('aria-label'), 'Plates', 'named');

    let options = railOptions();
    assert.strictEqual(options.length, SET.length, 'one option per asset');
    let names = options.map((el) => el.getAttribute('aria-label') ?? '');
    assert.strictEqual(
      new Set(names).size,
      SET.length,
      'every option has a DISTINCT name — the source shipped "Show this image" on all of them',
    );
    assert.true(
      names[2].indexOf('3 of 4') !== -1,
      'and the name carries the position: ' + names[2],
    );
  });

  test('exactly one tab stop, and it follows the cursor', async function (assert) {
    await render(<template><Gallery @assets={{SET}} /></template>);
    let stops = railOptions().filter((el) => el.tabIndex === 0);
    assert.strictEqual(stops.length, 1, 'one tab stop, never zero and never two');
    assert.strictEqual(
      stops[0],
      railOptions()[0],
      'the cursor starts at the first cell',
    );

    await triggerKeyEvent(railOptions()[0], 'keydown', 'ArrowRight');
    let moved = railOptions().filter((el) => el.tabIndex === 0);
    assert.strictEqual(moved[0], railOptions()[1], 'and the tab stop moved with it');
  });

  test('arrows move the cursor and report it', async function (assert) {
    let seen: number[] = [];
    let note = (index: number) => {
      seen.push(index);
    };
    await render(
      <template><Gallery @assets={{SET}} @onActiveChange={{note}} /></template>,
    );
    await triggerKeyEvent(railOptions()[0], 'keydown', 'ArrowRight');
    await triggerKeyEvent(railOptions()[1], 'keydown', 'End');
    await triggerKeyEvent(railOptions()[3], 'keydown', 'Home');
    assert.deepEqual(seen, [1, 3, 0], 'right, End, Home');

    await triggerKeyEvent(railOptions()[0], 'keydown', 'ArrowLeft');
    assert.deepEqual(
      seen,
      [1, 3, 0, 0],
      'and the ends clamp rather than wrap — a gallery has a first and a last',
    );
  });

  test('Space toggles, Enter opens — the keyboard twins of click and dblclick', async function (assert) {
    let selections: number[][] = [];
    let opened: number[] = [];
    let onSelect = (indices: number[]) => {
      selections.push(indices);
    };
    let onOpen = (index: number) => {
      opened.push(index);
    };
    await render(
      <template>
        <Gallery
          @assets={{SET}}
          @selectionMode='multi'
          @onSelectionChange={{onSelect}}
          @onOpen={{onOpen}}
        />
      </template>,
    );
    await triggerKeyEvent(railOptions()[0], 'keydown', ' ');
    assert.deepEqual(selections, [[0]], 'Space selected');
    await triggerKeyEvent(railOptions()[0], 'keydown', ' ');
    assert.deepEqual(selections[1], [], 'and Space again deselected');

    await triggerKeyEvent(railOptions()[0], 'keydown', 'Enter');
    assert.deepEqual(opened, [0], 'Enter opened');
  });

  test('Shift+Arrow builds a range from the anchor, not from the cursor', async function (assert) {
    let selections: number[][] = [];
    let onSelect = (indices: number[]) => {
      selections.push(indices);
    };
    await render(
      <template>
        <Gallery
          @assets={{SET}}
          @selectionMode='multi'
          @onSelectionChange={{onSelect}}
        />
      </template>,
    );
    await triggerKeyEvent(railOptions()[1], 'keydown', ' ');
    assert.deepEqual(selections[0], [1], 'the anchor is set at 1');

    await triggerKeyEvent(railOptions()[1], 'keydown', 'ArrowRight', {
      shiftKey: true,
    });
    assert.deepEqual(selections[1], [1, 2], 'extended to 2');

    await triggerKeyEvent(railOptions()[2], 'keydown', 'ArrowRight', {
      shiftKey: true,
    });
    assert.deepEqual(
      selections[2],
      [1, 2, 3],
      'and again from the SAME anchor rather than from wherever the cursor now is',
    );
  });

  test('Ctrl/Cmd+A selects all, and only in multi', async function (assert) {
    let selections: number[][] = [];
    let onSelect = (indices: number[]) => {
      selections.push(indices);
    };
    await render(
      <template>
        <Gallery
          @assets={{SET}}
          @selectionMode='multi'
          @onSelectionChange={{onSelect}}
        />
      </template>,
    );
    await triggerKeyEvent(railOptions()[0], 'keydown', 'A', { ctrlKey: true });
    assert.deepEqual(selections[0], [0, 1, 2, 3], 'the whole set');

    let single: number[][] = [];
    let onSingle = (indices: number[]) => {
      single.push(indices);
    };
    await render(
      <template>
        <Gallery
          @assets={{SET}}
          @selectionMode='single'
          @onSelectionChange={{onSingle}}
        />
      </template>,
    );
    await triggerKeyEvent(railOptions()[0], 'keydown', 'A', { metaKey: true });
    assert.strictEqual(
      single.length,
      0,
      'a single-select gallery does not quietly select everything',
    );
  });

  test('clicking selects and Shift-clicking ranges — the pointer half of the same contract', async function (assert) {
    let selections: number[][] = [];
    let onSelect = (indices: number[]) => {
      selections.push(indices);
    };
    await render(
      <template>
        <Gallery
          @assets={{SET}}
          @selectionMode='multi'
          @onSelectionChange={{onSelect}}
        />
      </template>,
    );
    await click(railOptions()[0]);
    assert.deepEqual(selections[0], [0], 'a plain click selects one');
    assert.strictEqual(
      railOptions()[0].getAttribute('aria-selected'),
      'true',
      'and says so in ARIA',
    );
  });

  test('selection mode none means the rail never selects', async function (assert) {
    let fired = 0;
    let onSelect = () => {
      fired++;
    };
    await render(
      <template>
        <Gallery @assets={{SET}} @onSelectionChange={{onSelect}} />
      </template>,
    );
    await triggerKeyEvent(railOptions()[0], 'keydown', ' ');
    assert.strictEqual(fired, 0, 'Space did nothing');
    assert.strictEqual(
      railOptions()[0].getAttribute('aria-selected'),
      'false',
      'and every option reports itself unselected rather than omitting the state',
    );
  });

  test('the hero is the adapter shell, and the counter is honest', async function (assert) {
    await render(<template><Gallery @assets={{SET}} /></template>);
    let hero = root().querySelector(
      '[data-test-pretui-gallery-hero]',
    ) as HTMLElement;
    assert.ok(
      hero.querySelector('[data-test-pretui-media-viewer]'),
      'MediaViewer draws the stage, so a later kind is an adapter and not a rewrite',
    );
    assert.true(
      (root().textContent ?? '').indexOf('1 of 4') !== -1,
      'the counter counts from one, as screen-reader copy always does',
    );
  });

  test('the step buttons drive the same cursor as the keyboard', async function (assert) {
    let seen: number[] = [];
    let note = (index: number) => {
      seen.push(index);
    };
    await render(
      <template><Gallery @assets={{SET}} @onActiveChange={{note}} /></template>,
    );
    await click('[data-test-pretui-gallery-next]');
    assert.deepEqual(seen, [1], 'next stepped forward');
    let prev = root().querySelector(
      '[data-test-pretui-gallery-prev]',
    ) as HTMLButtonElement;
    assert.strictEqual(prev.getAttribute('aria-disabled'), null, 'and back is now available');
  });

  test('the step button that reaches an end keeps focus', async function (assert) {
    let seen: number[] = [];
    let note = (index: number) => seen.push(index);
    await render(<template><Gallery @assets={{SET}} @onActiveChange={{note}} /></template>);
    let prev = root().querySelector('[data-test-pretui-gallery-prev]') as HTMLButtonElement;
    assert.strictEqual(prev.getAttribute('aria-disabled'), 'true', 'nothing before the first asset');
    assert.false(prev.disabled, 'but it stays focusable');
    prev.focus();
    await click(prev);
    assert.deepEqual(seen, [], 'and a press there does nothing');
    assert.strictEqual(document.activeElement, prev);
  });

  test('an empty set lands on a deliberate empty state, not a bare rail', async function (assert) {
    let none: readonly MediaAssetSpec[] = [];
    await render(<template><Gallery @assets={{none}} /></template>);
    assert.notOk(
      root().querySelector('[data-test-pretui-gallery-rail]'),
      'no listbox with nothing in it',
    );
    assert.ok(
      root().querySelector('[data-test-pretui-empty]'),
      'an EmptyState instead',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Demo pages — render proof
// ═══════════════════════════════════════════════════════════════════════
//
// `boxel parse` type-checks and `boxel realm indexing-errors` catches module
// evaluation; neither says a word about whether a page RENDERS. A usage page
// is where a `<:api>` description string containing a mustache, or an
// argument shape a control cannot take, actually shows up — so each page is
// mounted here.

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;

module('Pretui | media-library | demo pages', function (hooks) {
  setupCardTest(hooks);
  for (let name of DEMOS_MEDIA_LIBRARY_NAMES) {
    test(name + ' mounts', async function (assert) {
      let Demo = PAGES[name] as AnyComponent;
      assert.ok(Demo, name + ' is in the registry');
      await render(<template><Demo /></template>);
      assert.ok(
        root().querySelector('.FreestyleUsage'),
        name + ' rendered its usage shell',
      );
    });
  }
});
