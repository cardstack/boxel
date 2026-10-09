// Pretui — render proof for the second media wave.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// A clean `boxel realm indexing-errors` proves only that the module graph
// evaluates, and for these six components it proves even less: an engine that
// throws inside a modifier is invisible to every other gate. Headless
// Chromium also has no real media pipeline and no reliable GPU, so these
// assertions deliberately target each component's OWN state contract — the
// phase machine, the slider semantics, the teardown — and never a decode, a
// WebGL context or a network fetch.
import { module, test } from 'qunit';
import { render, clearRender, click, triggerKeyEvent, waitFor, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { Lightbox, isLightboxable } from './components/lightbox';
import { TrimBar } from './components/trim-bar';
import { Waveform, waveValueText } from './components/waveform';
import { waveDelta } from './internal/media-wave';
import { formatClock } from './internal/reading-format';
import { Filmstrip, evenFrames, frameAt } from './components/filmstrip';
import { CROP_RATIOS, ImageCropper } from './components/image-cropper';
import { ModelViewer, orbitAttribute, orbitValueText, wrapAzimuth } from './components/model-viewer';
import { resolveAsset } from './internal/media-viewer';
import type { MediaAssetSpec } from './internal/media-viewer';
import { TONE_SECONDS, TONE_WAV, platePoster } from './media-examples';

const PLATE = platePoster('test plate', '4 / 3');

const IMAGES: readonly MediaAssetSpec[] = [
  {
    src: PLATE,
    name: 'One',
    kind: 'image',
    alt: 'One',
    width: 800,
    height: 600,
  },
  { src: PLATE, name: 'Two', kind: 'image', alt: 'Two' },
];

const FRAMES = evenFrames(
  TONE_SECONDS,
  6,
  (_t, i) => platePoster(`f${i}`, '16 / 9'),
  (_t, i) => `Shot ${i + 1}`,
);

module('Pretui | media extras', function (hooks) {
  setupCardTest(hooks);

  // ── pure helpers, which is where the arithmetic bugs live ──────────────

  test('time formatters are total', function (assert) {
    assert.strictEqual(formatClock(0), '0:00');
    assert.strictEqual(formatClock(65), '1:05');
    assert.strictEqual(formatClock(3725), '1:02:05');
    assert.strictEqual(formatClock(Number.NaN), '0:00', 'NaN is 0:00');
    assert.strictEqual(formatClock(-5), '0:00', 'negative is 0:00');
    assert.strictEqual(formatClock(90), '1:30');
    assert.strictEqual(waveValueText(3, 6), '0:03 of 0:06');
  });

  test('waveDelta maps the standard slider triple', function (assert) {
    const steps = { fine: 1, coarse: 5, page: 10 };
    const key = (k: string, shift = false) =>
      waveDelta({ key: k, shiftKey: shift } as KeyboardEvent, steps);
    assert.strictEqual(key('ArrowRight'), 1);
    assert.strictEqual(key('ArrowRight', true), 5, 'Shift is the coarse step');
    assert.strictEqual(key('ArrowLeft'), -1);
    assert.strictEqual(key('PageUp'), 10);
    assert.strictEqual(key('PageDown'), -10);
    assert.strictEqual(key('a'), null, 'an unrelated key is not ours');
  });

  test('frameAt finds the last frame at or before a time', function (assert) {
    assert.strictEqual(frameAt([], 3), -1, 'empty strip has no frame');
    assert.strictEqual(frameAt(FRAMES, 0), 0);
    assert.strictEqual(frameAt(FRAMES, TONE_SECONDS), FRAMES.length - 1);
    assert.strictEqual(frameAt(FRAMES, -10), 0, 'before the start clamps');
  });

  test('orbit maths wraps and reads as a sentence', function (assert) {
    assert.strictEqual(wrapAzimuth(190), -170, '190° right is 170° left');
    assert.strictEqual(wrapAzimuth(-360), 0);
    assert.strictEqual(
      orbitValueText({ azimuth: 45, elevation: 20, zoom: 1.05 }),
      'turned 45° right, 20° above, 105% zoom',
    );
    assert.strictEqual(
      orbitValueText({ azimuth: 0, elevation: 0, zoom: 1 }),
      'facing front, level, 100% zoom',
    );
    assert.ok(
      orbitAttribute({ azimuth: 400, elevation: 200, zoom: 99 }).startsWith('40deg'),
      'azimuth wraps and elevation/zoom clamp rather than escaping',
    );
  });

  test('isLightboxable takes images only', function (assert) {
    assert.true(isLightboxable(resolveAsset({ src: 'a.png' })));
    assert.false(isLightboxable(resolveAsset({ src: 'a.mp4' })));
    assert.false(isLightboxable(resolveAsset({ src: 'a.glb' })));
  });

  test('CROP_RATIOS leads with free', function (assert) {
    assert.strictEqual(CROP_RATIOS[0].value, 0, 'free is first');
    assert.strictEqual(CROP_RATIOS[1].value, 1, '1:1 is a real ratio');
  });

  // ── Lightbox ───────────────────────────────────────────────────────────

  test('Lightbox renders anchors, reserves each ratio, and marks assumptions', async function (assert) {
    await render(<template><Lightbox @assets={{IMAGES}} /></template>);
    const root = document.querySelector('[data-test-pretui-lightbox]');
    assert.ok(root, 'lightbox rendered');
    const links = document.querySelectorAll('a.pretui-lb-link');
    assert.strictEqual(links.length, 2, 'one anchor per image');
    const first = links[0] as HTMLAnchorElement;
    assert.strictEqual(
      first.getAttribute('data-pswp-width'),
      '800',
      'known width travels to PhotoSwipe',
    );
    assert.notOk(
      first.getAttribute('data-assumed-size'),
      'a measured asset is not marked as assumed',
    );
    const second = links[1] as HTMLAnchorElement;
    assert.strictEqual(
      second.getAttribute('data-assumed-size'),
      'true',
      'an unmeasured asset says so rather than guessing silently',
    );
    assert.ok(
      (second.getAttribute('aria-label') ?? '').includes('2 of 2'),
      'each tile announces its position',
    );
    assert.ok(
      document.getElementById('pretui-photoswipe-css'),
      'the vendored stylesheet is installed while a Lightbox is alive',
    );
    await clearRender();
    assert.notOk(
      document.getElementById('pretui-photoswipe-css'),
      'and is removed again when the last Lightbox is destroyed',
    );
  });

  test('Lightbox drops non-images and counts what it dropped', async function (assert) {
    const mixed: readonly MediaAssetSpec[] = [
      ...IMAGES,
      { src: 'clip.mp4', name: 'Clip' },
    ];
    await render(<template><Lightbox @assets={{mixed}} /></template>);
    assert.strictEqual(
      document.querySelectorAll('a.pretui-lb-link').length,
      2,
      'the video is not in the gallery',
    );
    assert.ok(
      document.querySelector('.pretui-lb-note'),
      'and the component says one asset was left out',
    );
  });

  test('Lightbox @sections heads each chapter but numbers the whole set', async function (assert) {
    const sections = [
      { title: 'Arrivals', caption: 'Hellos', assets: IMAGES },
      { title: 'The ribbon', assets: [IMAGES[0]!] },
    ];
    await render(<template><Lightbox @sections={{sections}} @layout='justified' /></template>);
    assert.strictEqual(document.querySelectorAll('.pretui-lb-section').length, 2, 'one section per chapter');
    assert.strictEqual(document.querySelectorAll('.pretui-lb-gallery').length, 1, 'but one gallery, so one viewer');
    assert.dom('.pretui-lb-section-title').exists({ count: 2 }, 'default headings');
    assert.dom('.pretui-lb-section-caption').exists({ count: 1 }, 'a caption only where given');
    const links = [...document.querySelectorAll('a.pretui-lb-link')];
    assert.strictEqual(links.length, 3, 'every image');
    assert.ok(
      (links[2]!.getAttribute('aria-label') ?? '').includes('3 of 3'),
      'positions run across sections, not within them',
    );
    assert.strictEqual(
      document.querySelector('.pretui-lb-grid')?.getAttribute('data-layout'),
      'justified',
      'the layout reaches the grid',
    );
  });

  test('Lightbox <:section> replaces the default heading', async function (assert) {
    const sections = [{ title: 'Arrivals', assets: IMAGES }];
    await render(<template>
      <Lightbox @sections={{sections}}>
        <:section as |section index|><h2 data-test-custom>{{index}} {{section.title}}</h2></:section>
      </Lightbox>
    </template>);
    assert.dom('[data-test-custom]').hasText('0 Arrivals');
    assert.dom('.pretui-lb-section-title').doesNotExist();
  });

  test('Lightbox @filmstrip and @download add a rail and a save link; Escape stays inside', async function (assert) {
    let hostSawEscape = false;
    const hostEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hostSawEscape = true;
    };
    document.addEventListener('keydown', hostEscape);
    try {
      await render(<template><Lightbox @assets={{IMAGES}} @filmstrip={{true}} @download={{true}} /></template>);
      await click('a.pretui-lb-link');
      await waitFor('.pretui-pswp-filmstrip');
      assert.strictEqual(document.querySelectorAll('.pretui-pswp-thumb').length, 2, 'one thumb per image');
      assert.strictEqual(
        document.querySelector('.pretui-pswp-thumb[aria-current="true"]'),
        document.querySelectorAll('.pretui-pswp-thumb')[0],
        'the open image is marked current',
      );
      const save = document.querySelector('a.pretui-pswp-save') as HTMLAnchorElement | null;
      assert.ok(save?.hasAttribute('download'), 'save is a download link');
      assert.strictEqual(save?.getAttribute('href'), PLATE, 'pointing at the open image');
      await triggerKeyEvent(document, 'keydown', 'Escape');
      await waitUntil(() => !document.querySelector('.pswp'), { timeout: 3000 });
      assert.false(hostSawEscape, 'the keypress that closed the viewer never reached the host');
    } finally {
      document.removeEventListener('keydown', hostEscape);
    }
  });

  // ── Waveform ───────────────────────────────────────────────────────────

  test('Waveform is one slider with a name, a value and a phase', async function (assert) {
    await render(
      <template><Waveform @src={{TONE_WAV}} @label='Desk note' /></template>,
    );
    const root = document.querySelector('[data-test-pretui-waveform]');
    assert.ok(root, 'waveform rendered');
    const scrub = document.querySelector('.pretui-wave-scrub');
    assert.ok(scrub, 'the scrubber exists');
    assert.strictEqual(scrub?.getAttribute('role'), 'slider');
    assert.strictEqual(scrub?.getAttribute('aria-label'), 'Desk note');
    assert.strictEqual(scrub?.getAttribute('tabindex'), '0', 'one tab stop');
    assert.strictEqual(
      scrub?.children.length,
      0,
      "role='slider' takes presentational children only, so it has none",
    );
    assert.ok(
      (scrub?.getAttribute('aria-valuetext') ?? '').includes(' of '),
      'the announced value is a time, not a float',
    );
    // Not "did it decode" — a headless browser may or may not. The contract is
    // that the phase is one of the four the type names, and never blank.
    const phase = root?.getAttribute('data-phase');
    assert.ok(
      ['loading', 'ready', 'error'].includes(phase ?? ''),
      `the engine modifier ran and moved off idle (was ${phase})`,
    );
    // Proof the ENGINE really built, not merely that the template did:
    // WaveSurfer.create() attaches its own shadow root to the container
    // synchronously, so its absence would mean construction threw.
    const container = document.querySelector('.pretui-wave-canvas');
    assert.ok(
      container?.shadowRoot ?? container?.querySelector('canvas, div'),
      'wavesurfer built its own render target inside the container',
    );
    // Keys must not throw whatever the phase, which is the regression that
    // matters: a handler that assumes an engine crashes the page offline.
    await triggerKeyEvent('.pretui-wave-scrub', 'keydown', 'ArrowRight');
    await triggerKeyEvent('.pretui-wave-scrub', 'keydown', 'Home');
    await triggerKeyEvent('.pretui-wave-scrub', 'keydown', 'End');
    assert.ok(true, 'arrow, Home and End are safe in every phase');
    await clearRender();
    assert.notOk(
      document.querySelector('[data-test-pretui-waveform]'),
      'teardown leaves nothing behind',
    );
  });

  test('Waveform @bare drops the transport but keeps the scrubber', async function (assert) {
    await render(
      <template>
        <Waveform @src={{TONE_WAV}} @label='Desk note' @bare={{true}} />
      </template>,
    );
    assert.notOk(document.querySelector('.pretui-wave-play'), 'no transport');
    assert.ok(document.querySelector('.pretui-wave-scrub'), 'still a slider');
  });

  // ── TrimBar ────────────────────────────────────────────────────────────

  test('TrimBar has two named handles that cannot cross', async function (assert) {
    await render(
      <template>
        <TrimBar @src={{TONE_WAV}} @label='Desk note' @start={{1}} @end={{4}} />
      </template>,
    );
    assert.ok(document.querySelector('[data-test-pretui-trimbar]'), 'rendered');
    const handles = document.querySelectorAll('.pretui-trim-handle');
    assert.strictEqual(handles.length, 2, 'an in point and an out point');
    const inHandle = handles[0] as HTMLElement;
    const outHandle = handles[1] as HTMLElement;
    assert.strictEqual(inHandle.getAttribute('role'), 'slider');
    assert.strictEqual(outHandle.getAttribute('role'), 'slider');
    assert.notStrictEqual(
      inHandle.getAttribute('aria-label'),
      outHandle.getAttribute('aria-label'),
      'two sliders with the same name would be unusable',
    );
    assert.ok(
      (inHandle.getAttribute('aria-valuetext') ?? '').startsWith('In point'),
      'the in point says what it is',
    );
    const container = document.querySelector('.pretui-trim-canvas');
    assert.ok(
      container?.shadowRoot ?? container?.querySelector('canvas, div'),
      'wavesurfer built its render target here too, with the regions plugin',
    );
    assert.strictEqual(inHandle.getAttribute('tabindex'), '0');
    await triggerKeyEvent('.pretui-trim-handle--in', 'keydown', 'ArrowRight');
    await triggerKeyEvent('.pretui-trim-handle--out', 'keydown', 'ArrowLeft');
    assert.ok(true, 'both handles take keys in every phase');
    await clearRender();
    assert.notOk(document.querySelector('[data-test-pretui-trimbar]'), 'torn down');
  });

  // ── Filmstrip ──────────────────────────────────────────────────────────

  test('Filmstrip is one tab stop over N frames', async function (assert) {
    await render(
      <template>
        <Filmstrip
          @frames={{FRAMES}}
          @duration={{TONE_SECONDS}}
          @label='Reel'
        />
      </template>,
    );
    assert.ok(document.querySelector('[data-test-pretui-filmstrip]'), 'rendered');
    const cells = document.querySelectorAll('.pretui-strip-cell');
    assert.strictEqual(cells.length, 6, 'one tile per frame');
    const tabStops = Array.from(cells).filter(
      (c) => c.getAttribute('tabindex') !== '-1',
    );
    assert.strictEqual(tabStops.length, 0, 'no tile is a tab stop');
    const scrub = document.querySelector('.pretui-strip-scrub');
    assert.strictEqual(scrub?.getAttribute('role'), 'slider');
    assert.strictEqual(scrub?.getAttribute('tabindex'), '0', 'exactly one');
    assert.strictEqual(scrub?.children.length, 0, 'and it has no children');
    assert.strictEqual(
      cells[0].getAttribute('data-active'),
      'true',
      'the first frame starts active',
    );
    await triggerKeyEvent('.pretui-strip-scrub', 'keydown', 'End');
    assert.strictEqual(
      document.querySelectorAll('.pretui-strip-cell')[5].getAttribute('data-active'),
      'true',
      'End moves to the last frame',
    );
    await triggerKeyEvent('.pretui-strip-scrub', 'keydown', 'Home');
    assert.strictEqual(
      document.querySelectorAll('.pretui-strip-cell')[0].getAttribute('data-active'),
      'true',
      'Home moves back to the first',
    );
    await click('.pretui-strip-cell:nth-child(3)');
    assert.strictEqual(
      document.querySelectorAll('.pretui-strip-cell')[2].getAttribute('data-active'),
      'true',
      'a pointer reaches the same state as the keyboard',
    );
  });

  test('Filmstrip with no frames says so', async function (assert) {
    const none: never[] = [];
    await render(<template><Filmstrip @frames={{none}} @label='Reel' /></template>);
    assert.strictEqual(
      document.querySelectorAll('.pretui-strip-cell').length,
      0,
      'no tiles',
    );
    assert.ok(
      document.querySelector('[data-test-pretui-filmstrip]')?.textContent?.includes(
        'No frames',
      ),
      'and the empty state names the gap',
    );
  });

  // ── ImageCropper ───────────────────────────────────────────────────────

  test('Cropper.js custom elements are defined by the import', function (assert) {
    assert.ok(customElements.get('cropper-canvas'), 'cropper-canvas defined');
    assert.ok(customElements.get('cropper-image'), 'cropper-image defined');
    assert.ok(
      customElements.get('cropper-selection'),
      'cropper-selection defined',
    );
  });

  test('ImageCropper renders the crop surface and four named sliders', async function (assert) {
    await render(
      <template><ImageCropper @src={{PLATE}} @alt='Plate' /></template>,
    );
    assert.ok(
      document.querySelector('[data-test-pretui-image-cropper]'),
      'cropper rendered',
    );
    const canvas = document.querySelector('cropper-canvas');
    assert.ok(canvas, 'cropper-canvas in the DOM');
    assert.ok(
      canvas instanceof (customElements.get('cropper-canvas') as never),
      'and it upgraded to its class',
    );
    assert.ok(canvas?.shadowRoot, 'it built a shadow root');
    const selection = document.querySelector('cropper-selection');
    // The trap this asserts against: a boolean attribute bound dynamically
    // goes through the PROPERTY and silently does nothing. These are static
    // attributes, so they are really there.
    assert.true(
      selection?.hasAttribute('movable'),
      'the selection is movable, not falsily-movable',
    );
    assert.true(selection?.hasAttribute('resizable'), 'and resizable');
    const ranges = document.querySelectorAll('.pretui-crop-field input');
    assert.strictEqual(ranges.length, 4, 'left, top, width and height');
    for (const range of Array.from(ranges)) {
      assert.strictEqual(
        (range as HTMLInputElement).type,
        'range',
        'a native range, so the platform owns the key handling',
      );
      assert.ok(
        (range.getAttribute('aria-valuetext') ?? '').includes('pixels'),
        'each announces a value a person can act on',
      );
    }
    assert.notOk(
      selection?.hasAttribute('keyboard'),
      "Cropper's document-level keyboard mode is deliberately off",
    );
    await clearRender();
    assert.notOk(document.querySelector('cropper-canvas'), 'torn down');
  });

  // ── ModelViewer ────────────────────────────────────────────────────────

  test('model-viewer custom element is defined by the import', function (assert) {
    assert.ok(customElements.get('model-viewer'), 'model-viewer defined');
  });

  test('ModelViewer rests at its poster and loads nothing until asked', async function (assert) {
    await render(
      <template>
        <ModelViewer @src='crate.glb' @alt='A crate' @poster={{PLATE}} />
      </template>,
    );
    const root = document.querySelector('[data-test-pretui-model-viewer]');
    assert.ok(root, 'rendered');
    assert.strictEqual(
      root?.getAttribute('data-phase'),
      'poster',
      'nothing has been fetched — this is the no-autoplay contract',
    );
    const el = document.querySelector('model-viewer');
    assert.strictEqual(
      el?.getAttribute('reveal'),
      'manual',
      'and the element is held at manual reveal',
    );
    const orbit = document.querySelector('.pretui-model-orbit');
    assert.strictEqual(orbit?.getAttribute('role'), 'slider');
    assert.strictEqual(orbit?.children.length, 0, 'no semantic descendants');
    assert.strictEqual(
      orbit?.getAttribute('aria-valuetext'),
      'facing front, 12° above, 100% zoom',
      'the camera announces itself in words',
    );
    assert.strictEqual(
      orbit?.getAttribute('aria-disabled'),
      'true',
      'and is disabled until the model is revealed',
    );
    assert.ok(document.querySelector('.pretui-model-gate'), 'a load button');
    await click('.pretui-model-gate');
    assert.notStrictEqual(
      document
        .querySelector('[data-test-pretui-model-viewer]')
        ?.getAttribute('data-phase'),
      'poster',
      'pressing it leaves the poster phase',
    );
    await clearRender();
    assert.notOk(document.querySelector('model-viewer'), 'torn down');
  });

  test('ModelViewer keyboard turns the camera without a GPU', async function (assert) {
    await render(
      <template><ModelViewer @src='crate.glb' @alt='A crate' /></template>,
    );
    await click('.pretui-model-gate');
    // Elevation and azimuth are OUR state, so they move whether or not a
    // WebGL context ever existed — which is exactly why they are our state.
    await triggerKeyEvent('.pretui-model-orbit', 'keydown', 'PageUp');
    const orbit = document.querySelector('.pretui-model-orbit');
    const text = orbit?.getAttribute('aria-valuetext') ?? '';
    assert.ok(
      text.includes('right') || text.includes('left'),
      `a quarter turn is announced (was "${text}")`,
    );
  });
});
