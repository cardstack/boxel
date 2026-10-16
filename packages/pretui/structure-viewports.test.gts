// Pretui — runtime proof for structure-scroll.gts and structure-morph.gts.
//
// Seven components whose whole value is behaviour: an edge affordance that
// appears, a carousel that moves, a frame that zooms, an image that stops, a
// capsule that morphs, a dialog and a popover that open and give focus back.
// A clean index proves none of that — `boxel realm indexing-errors` is a
// module-evaluation gate — so it is asserted here against the real renderer.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push it to the realm.
import { module, test } from 'qunit';
import { render, click, settled, triggerEvent, triggerKeyEvent, waitUntil } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Carousel } from './components/carousel';
import { Scroller } from './components/scroller';
import { ZoomableFrame } from './components/zoomable-frame';
import { AnimatedImage } from './components/animated-image';
import { DynamicIsland } from './components/dynamic-island';
import { MorphingDialog } from './components/morphing-dialog';
import { MorphingPopover } from './components/morphing-popover';
import { DEMOS_ANIMATED_IMAGE } from './components/animated-image.usage';
import { DEMOS_BAR_LIST } from './components/bar-list.usage';
import { DEMOS_CAROUSEL } from './components/carousel.usage';
import { DEMOS_CHART } from './components/chart.usage';
import { DEMOS_DYNAMIC_ISLAND } from './components/dynamic-island.usage';
import { DEMOS_MORPHING_DIALOG } from './components/morphing-dialog.usage';
import { DEMOS_MORPHING_POPOVER } from './components/morphing-popover.usage';
import { DEMOS_SCROLLER } from './components/scroller.usage';
import { DEMOS_ZOOMABLE_FRAME } from './components/zoomable-frame.usage';
import { htmlSafe } from '@ember/template';

const ROW = htmlSafe('display:flex');
const WIDE = htmlSafe('flex:0 0 400px');

const SLIDES = ['Gyokuro', 'Sencha', 'Da Hong Pao', 'Silver Needle'];

// A one-pixel transparent GIF: enough for <img> load and canvas draw, and
// it needs no network.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function query(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null;
}
function must(selector: string): HTMLElement {
  let el = query(selector);
  if (!el) {
    throw new Error('missing element: ' + selector);
  }
  return el;
}

module('Pretui | Scroller', function (hooks) {
  setupCardTest(hooks);

  test('renders a viewport that carries the four edge facts', async function (assert) {
    await render(<template>
      <Scroller @label='Recent lots' @orientation='horizontal'>
        <div style={{ROW}}>
          <span style={{WIDE}}>one</span>
          <span style={{WIDE}}>two</span>
        </div>
      </Scroller>
    </template>);
    let viewport = must('[data-test-pretui-scroller-viewport]');
    assert.strictEqual(viewport.getAttribute('role'), 'region', 'named region');
    assert.strictEqual(
      viewport.getAttribute('aria-label'),
      'Recent lots',
      'and it is named',
    );
    // The four facts are always present, even when flush — CSS reads them.
    for (let name of ['startX', 'endX', 'startY', 'endY']) {
      assert.ok(
        viewport.dataset[name] !== undefined,
        'data-' + name + ' is maintained',
      );
    }
    assert.strictEqual(
      viewport.dataset['startX'],
      'flush',
      'nothing is clipped before the left edge at rest',
    );
  });

  test('no accessible role at all when no name was given', async function (assert) {
    await render(<template>
      <Scroller><span>plain</span></Scroller>
    </template>);
    assert.strictEqual(
      must('[data-test-pretui-scroller-viewport]').getAttribute('role'),
      null,
      'an unnamed region would be noise in a rotor, so there is none',
    );
  });
});

// `boxel test` loads no component CSS, so without help every slide stacks
// as a block and nothing scrolls. This is the layout the scroll behaviour
// depends on, injected for the Carousel tests only.
const CAROUSEL_LAYOUT = `
  .t-carousel-host { inline-size: 300px; }
  .t-carousel-host .pretui-scroller-viewport { overflow-x: auto; overflow-y: hidden; }
  .t-carousel-host .pretui-carousel-track { position: relative; display: flex; gap: 0; }
  .t-carousel-host .pretui-carousel-slide { flex: 0 0 var(--pretui-carousel-slide, 100%); min-inline-size: 0; block-size: 40px; scroll-snap-align: start; }
`;

function viewport(): HTMLElement {
  return must('[data-test-pretui-scroller-viewport]');
}

/** The resting scrollLeft for slide `index`, clamped at the far end. */
function restOf(index: number): number {
  let slide = document.querySelectorAll('.pretui-carousel-slide')[index] as HTMLElement;
  let v = viewport();
  return Math.min(slide.offsetLeft, v.scrollWidth - v.clientWidth);
}

async function scrolledTo(left: number) {
  await waitUntil(() => Math.abs(viewport().scrollLeft - left) <= 1, { timeout: 3000 });
  await settled();
}

module('Pretui | Carousel', function (hooks) {
  setupCardTest(hooks);

  let style: HTMLStyleElement;
  hooks.beforeEach(function () {
    style = document.createElement('style');
    style.textContent = CAROUSEL_LAYOUT;
    document.head.appendChild(style);
  });
  hooks.afterEach(function () {
    style.remove();
  });

  test('the controls scroll the viewport to the slide they name', async function (assert) {
    await render(<template>
      <div class='t-carousel-host'>
        <Carousel @items={{SLIDES}} @label='Featured lots'>
          <:slide as |tea|><span>{{tea}}</span></:slide>
        </Carousel>
      </div>
    </template>);
    let status = () => must('[data-test-pretui-carousel-status]').textContent?.trim();
    assert.ok(viewport().scrollWidth > viewport().clientWidth, 'the layout scrolls');

    await click('[data-test-pretui-carousel-next]');
    await scrolledTo(restOf(1));
    assert.strictEqual(status(), 'Slide 2 of 4', 'next moved the slides, and the index held while they moved');

    await click('[data-test-pretui-carousel-dot="3"]');
    await scrolledTo(restOf(3));
    assert.strictEqual(status(), 'Slide 4 of 4', 'a dot jumps the viewport');

    await triggerKeyEvent('[data-test-pretui-carousel]', 'keydown', 'Home');
    await scrolledTo(0);
    assert.strictEqual(status(), 'Slide 1 of 4', 'Home returns');
  });

  test('the reader scrolling the viewport moves the index, both ways', async function (assert) {
    await render(<template>
      <div class='t-carousel-host'>
        <Carousel @items={{SLIDES}} @label='Featured lots'>
          <:slide as |tea|><span>{{tea}}</span></:slide>
        </Carousel>
      </div>
    </template>);
    let status = () => must('[data-test-pretui-carousel-status]').textContent?.trim();
    viewport().scrollTo({ left: restOf(2), behavior: 'instant' });
    await waitUntil(() => status() === 'Slide 3 of 4', { timeout: 3000 });
    assert.strictEqual(status(), 'Slide 3 of 4', 'forward');
    viewport().scrollTo({ left: restOf(1), behavior: 'instant' });
    await waitUntil(() => status() === 'Slide 2 of 4', { timeout: 3000 });
    assert.strictEqual(status(), 'Slide 2 of 4', 'and back');
  });

  test('with two per view, the last slide stays current at the far end and a backward scroll still moves the index', async function (assert) {
    await render(<template>
      <div class='t-carousel-host'>
        <Carousel @items={{SLIDES}} @label='Featured lots' @perView={{2}}>
          <:slide as |tea|><span>{{tea}}</span></:slide>
        </Carousel>
      </div>
    </template>);
    let status = () => must('[data-test-pretui-carousel-status]').textContent?.trim();
    await click('[data-test-pretui-carousel-dot="3"]');
    await scrolledTo(restOf(3));
    assert.strictEqual(status(), 'Slide 4 of 4', 'not read back as slide 3, which rests in the same place');
    // a reader's scroll starts with a wheel, touch or pointer event, which
    // hands the viewport back from the dot's requested move
    await triggerEvent(viewport(), 'wheel');
    viewport().scrollTo({ left: restOf(1), behavior: 'instant' });
    await waitUntil(() => status() === 'Slide 2 of 4', { timeout: 3000 });
    assert.strictEqual(status(), 'Slide 2 of 4', 'a backward scroll moves it');
  });

  test('renders every slide with a slide role and a position name', async function (assert) {
    await render(<template>
      <Carousel @items={{SLIDES}} @label='Featured lots'>
        <:slide as |tea|><span class='t'>{{tea}}</span></:slide>
      </Carousel>
    </template>);
    let slides = Array.from(document.querySelectorAll('.pretui-carousel-slide'));
    assert.strictEqual(slides.length, 4, 'four slides');
    assert.strictEqual(
      slides[0]?.getAttribute('aria-roledescription'),
      'slide',
      'slide roledescription',
    );
    assert.strictEqual(
      slides[2]?.getAttribute('aria-label'),
      '3 of 4',
      'each slide names its position',
    );
    assert.strictEqual(
      must('[data-test-pretui-carousel]').getAttribute('aria-roledescription'),
      'carousel',
      'the group is a carousel',
    );
    assert.strictEqual(
      must('[data-test-pretui-carousel-status]').textContent?.trim(),
      'Slide 1 of 4',
      'one polite status line',
    );
  });

  test('arrows, dots and the keyboard all move the same index', async function (assert) {
    await render(<template>
      <Carousel @items={{SLIDES}} @label='Featured lots'>
        <:slide as |tea|><span class='t'>{{tea}}</span></:slide>
      </Carousel>
    </template>);
    let status = () =>
      must('[data-test-pretui-carousel-status]').textContent?.trim();

    // aria-disabled, not `disabled`: the arrow must keep focus when it
    // reaches an end (2026-08-13).
    assert
      .dom('[data-test-pretui-carousel-previous]')
      .hasAttribute('aria-disabled', 'true');
    await click('[data-test-pretui-carousel-next]');
    assert.strictEqual(status(), 'Slide 2 of 4', 'next advances');
    assert
      .dom('[data-test-pretui-carousel-previous]')
      .doesNotHaveAttribute('aria-disabled');

    await click('[data-test-pretui-carousel-dot="3"]');
    assert.strictEqual(status(), 'Slide 4 of 4', 'a dot jumps');
    assert
      .dom('[data-test-pretui-carousel-next]')
      .hasAttribute('aria-disabled', 'true');
    assert.strictEqual(
      must('[data-test-pretui-carousel-dot="3"]').getAttribute('aria-current'),
      'true',
      'and marks itself current',
    );

    await triggerKeyEvent(
      '[data-test-pretui-carousel-track]',
      'keydown',
      'Home',
    );
    await settled();
    assert.strictEqual(status(), 'Slide 1 of 4', 'Home returns to the first');

    await triggerKeyEvent(
      '[data-test-pretui-carousel-track]',
      'keydown',
      'ArrowRight',
    );
    await settled();
    assert.strictEqual(status(), 'Slide 2 of 4', 'ArrowRight advances');
  });

  test('loop wraps past the ends and never disables the arrows', async function (assert) {
    await render(<template>
      <Carousel @items={{SLIDES}} @label='Featured' @loop={{true}}>
        <:slide as |tea|><span>{{tea}}</span></:slide>
      </Carousel>
    </template>);
    assert
      .dom('[data-test-pretui-carousel-previous]')
      .doesNotHaveAttribute('aria-disabled');
    await click('[data-test-pretui-carousel-previous]');
    assert.strictEqual(
      must('[data-test-pretui-carousel-status]').textContent?.trim(),
      'Slide 4 of 4',
      'previous from the first wraps to the last',
    );
  });
});

module('Pretui | ZoomableFrame', function (hooks) {
  setupCardTest(hooks);

  test('buttons and keys drive the same scale, and reset returns to 100%', async function (assert) {
    await render(<template>
      <ZoomableFrame @label='Floor plan'>
        <span class='content'>plan</span>
      </ZoomableFrame>
    </template>);
    let readout = () =>
      must('[data-test-pretui-frame-status]').textContent?.trim();
    let transform = () =>
      (query('.pretui-frame-content')?.getAttribute('style') ?? '');

    assert.strictEqual(readout(), 'Zoom 100%', 'starts at 100%');
    assert.dom('[data-test-pretui-frame-reset]').hasAttribute('aria-disabled', 'true');

    await click('[data-test-pretui-frame-in]');
    assert.strictEqual(readout(), 'Zoom 125%', 'one multiplicative step in');
    assert.ok(transform().includes('scale(1.25'), 'transform follows');
    assert.dom('[data-test-pretui-frame-reset]').doesNotHaveAttribute('aria-disabled');

    await click('[data-test-pretui-frame-out]');
    assert.strictEqual(readout(), 'Zoom 100%', 'and back out');

    await triggerKeyEvent('[data-test-pretui-frame-viewport]', 'keydown', '+');
    await settled();
    assert.strictEqual(readout(), 'Zoom 125%', 'the keyboard twin works');

    await triggerKeyEvent(
      '[data-test-pretui-frame-viewport]',
      'keydown',
      'ArrowRight',
    );
    await settled();
    assert.ok(transform().includes('translate(-24'), 'arrows pan');

    await triggerKeyEvent('[data-test-pretui-frame-viewport]', 'keydown', '0');
    await settled();
    assert.strictEqual(readout(), 'Zoom 100%', 'zero resets the scale');
    assert.ok(transform().includes('translate(0.00px, 0.00px)'), 'and the pan');
  });

  test('the viewport is a named, focusable group with a described keyboard path', async function (assert) {
    await render(<template>
      <ZoomableFrame @label='Floor plan'><span>plan</span></ZoomableFrame>
    </template>);
    let viewport = must('[data-test-pretui-frame-viewport]');
    assert.strictEqual(viewport.getAttribute('tabindex'), '0', 'focusable');
    assert.strictEqual(viewport.getAttribute('aria-label'), 'Floor plan');
    let describedBy = viewport.getAttribute('aria-describedby') ?? '';
    assert.ok(describedBy.length > 0, 'has a description id');
    assert.ok(
      (document.getElementById(describedBy)?.textContent ?? '').includes(
        'arrow keys',
      ),
      'and the description explains the keys',
    );
  });
});

module('Pretui | AnimatedImage', function (hooks) {
  setupCardTest(hooks);

  test('pairs the image with a frozen-frame canvas and toggles state', async function (assert) {
    await render(<template>
      <AnimatedImage @src={{PIXEL}} @alt='A rising bar' @playing={{true}} />
    </template>);
    let root = must('[data-test-pretui-animated-image]');
    assert.strictEqual(root.dataset['playing'], 'true', 'playing');
    assert.dom('.pretui-animated-img').hasAttribute('alt', 'A rising bar');
    assert.ok(query('.pretui-animated-canvas'), 'the frozen-frame canvas');
    assert.strictEqual(
      query('.pretui-animated-canvas')?.getAttribute('aria-hidden'),
      'true',
      'the canvas is not a second announcement of the same picture',
    );
    assert.strictEqual(
      must('[data-test-pretui-animated-toggle]').getAttribute('aria-label'),
      'Pause animation',
      'the control name states what pressing it will do',
    );
  });

  test('@fill drops the frame and @controlPlacement moves the control', async function (assert) {
    await render(<template>
      <AnimatedImage @src={{PIXEL}} @alt='A rising bar' @playing={{true}} @fill={{true}} @controlPlacement='end' />
    </template>);
    let root = must('[data-test-pretui-animated-image]');
    assert.strictEqual(root.dataset['fill'], 'true', 'full-bleed');
    assert.strictEqual(root.dataset['controlPlacement'], 'end', 'control in the end corner');
    assert.strictEqual(getComputedStyle(root).borderRadius, '0px', 'no frame radius');
  });

  test('defaults: framed, control in the start corner', async function (assert) {
    await render(<template>
      <AnimatedImage @src={{PIXEL}} @alt='A rising bar' @playing={{true}} />
    </template>);
    let root = must('[data-test-pretui-animated-image]');
    assert.notOk(root.dataset['fill'], 'not full-bleed unless asked');
    assert.strictEqual(root.dataset['controlPlacement'], 'start', 'start corner');
  });

  test('uncontrolled: the control flips playback and the name follows', async function (assert) {
    await render(<template>
      <AnimatedImage
        @src={{PIXEL}}
        @alt='A rising bar'
        @defaultPlaying={{true}}
      />
    </template>);
    await click('[data-test-pretui-animated-toggle]');
    assert.strictEqual(
      must('[data-test-pretui-animated-image]').dataset['playing'],
      'false',
      'paused',
    );
    assert.strictEqual(
      must('[data-test-pretui-animated-toggle]').getAttribute('aria-label'),
      'Play animation',
      'and the name inverts',
    );
    await click('[data-test-pretui-animated-toggle]');
    assert.strictEqual(
      must('[data-test-pretui-animated-image]').dataset['playing'],
      'true',
      'and back',
    );
  });
});

module('Pretui | DynamicIsland', function (hooks) {
  setupCardTest(hooks);

  test('renders exactly one view and morphs between them', async function (assert) {
    await render(<template>
      <DynamicIsland @label='Indexing status' @defaultView='compact'>
        <:idle><span class='v-idle'>·</span></:idle>
        <:compact><span class='v-compact'>Indexing 42 cards</span></:compact>
        <:expanded><span class='v-expanded'>Three realms</span></:expanded>
      </DynamicIsland>
    </template>);
    let capsule = must('[data-test-pretui-island-capsule]');
    assert.strictEqual(capsule.dataset['view'], 'compact', 'starts compact');
    assert.strictEqual(capsule.getAttribute('role'), 'status', 'announces');
    assert.ok(query('.v-compact'), 'the compact block is rendered');
    assert.notOk(query('.v-expanded'), 'and only that one');

    let toggle = must('[data-test-pretui-island-toggle]');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(
      toggle.getAttribute('aria-controls'),
      capsule.getAttribute('id'),
      'the toggle names what it controls',
    );

    await click(toggle);
    assert.strictEqual(
      must('[data-test-pretui-island-capsule]').dataset['view'],
      'expanded',
      'expands',
    );
    assert.ok(query('.v-expanded'), 'the expanded block took over');
    assert.notOk(query('.v-compact'), 'and the compact one left');
  });

  test('controlled: the host owns the view and the toggle only reports', async function (assert) {
    await render(<template>
      <DynamicIsland @label='Status' @view='idle'>
        <:idle><span class='v-idle'>·</span></:idle>
        <:compact><span class='v-compact'>working</span></:compact>
        <:expanded><span class='v-expanded'>detail</span></:expanded>
      </DynamicIsland>
    </template>);
    assert.ok(query('.v-idle'), 'shows the controlled view');
    await click('[data-test-pretui-island-toggle]');
    assert.ok(query('.v-idle'), 'and does not move without the host');
  });
});

module('Pretui | MorphingDialog', function (hooks) {
  setupCardTest(hooks);

  test('the trigger is a real button that opens a native modal dialog', async function (assert) {
    await render(<template>
      <MorphingDialog @label='Lot B-204'>
        <:trigger><span class='face'>Lot B-204</span></:trigger>
        <:default><p class='body'>Cleared and bonded.</p></:default>
        <:actions><span class='hint'>Escape closes</span></:actions>
      </MorphingDialog>
    </template>);
    let trigger = must('[data-test-pretui-morphing-dialog-trigger]');
    assert.strictEqual(trigger.tagName, 'BUTTON', 'a button, not a div');
    assert.strictEqual(
      trigger.getAttribute('aria-haspopup'),
      'dialog',
      'and it says what it opens',
    );
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');

    let dialog = must('[data-test-pretui-dialog]') as HTMLDialogElement;
    assert.notOk(dialog.open, 'closed to begin with');

    await click(trigger);
    assert.ok(dialog.open, 'showModal() ran — the platform owns the trap');
    assert.strictEqual(
      must('[data-test-pretui-morphing-dialog-trigger]').getAttribute(
        'aria-expanded',
      ),
      'true',
      'and the trigger reports it',
    );
    assert.ok(query('.body'), 'the body block rendered');
    assert.ok(query('.hint'), 'the actions block rendered');
    assert.ok(
      (query('.pretui-dialog-title')?.textContent ?? '').includes('Lot B-204'),
      'the label became the visible title',
    );
  });
});

module('Pretui | MorphingPopover', function (hooks) {
  setupCardTest(hooks);

  test('opens an anchored named dialog, and the yielded close dismisses it', async function (assert) {
    await render(<template>
      <MorphingPopover @label='Filters'>
        <:trigger>Filters</:trigger>
        <:default as |close|>
          <button type='button' class='done' {{on 'click' close}}>Done</button>
        </:default>
      </MorphingPopover>
    </template>);
    let trigger = must('[data-test-pretui-morphing-popover-trigger]');
    assert.strictEqual(trigger.tagName, 'BUTTON', 'a button trigger');
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
    assert.notOk(query('[data-test-pretui-morphing-popover-panel]'), 'closed');

    await click(trigger);
    let panel = must('[data-test-pretui-morphing-popover-panel]');
    assert.strictEqual(panel.getAttribute('role'), 'dialog', 'a named dialog');
    assert.strictEqual(panel.getAttribute('aria-label'), 'Filters');
    assert.strictEqual(
      document.activeElement,
      panel,
      'focus moved INTO the panel — an overlay the keyboard cannot reach is a decoration',
    );

    await click('.done');
    assert.notOk(
      query('[data-test-pretui-morphing-popover-panel]'),
      'the yielded close action dismissed it',
    );
    assert.strictEqual(
      document.activeElement,
      must('[data-test-pretui-morphing-popover-trigger]'),
      'and focus went back to the trigger',
    );
  });

  test('Escape closes and returns focus', async function (assert) {
    await render(<template>
      <MorphingPopover @label='Filters'>
        <:trigger>Filters</:trigger>
        <:default><span class='panel-body'>body</span></:default>
      </MorphingPopover>
    </template>);
    await click('[data-test-pretui-morphing-popover-trigger]');
    assert.ok(query('[data-test-pretui-morphing-popover-panel]'), 'open');
    await triggerKeyEvent(document, 'keydown', 'Escape');
    await settled();
    assert.notOk(
      query('[data-test-pretui-morphing-popover-panel]'),
      'Escape closed it',
    );
    assert.strictEqual(
      document.activeElement,
      must('[data-test-pretui-morphing-popover-trigger]'),
      'focus returned',
    );
  });

  test('a zero distance reaches the positioning primitive as zero', async function (assert) {
    await render(<template>
      <MorphingPopover
        @label='Zero-gap panel'
        @open={{true}}
        @placement='bottom-start'
        @distance={{0}}
      >
        <:trigger>Open</:trigger>
        <:default>Panel</:default>
      </MorphingPopover>
    </template>);
    await settled();

    let anchor = must('.pretui-popup-anchor') as HTMLElement;
    let popup = must('.pretui-popup') as HTMLElement;
    let actualGap =
      parseFloat(popup.style.top) - anchor.getBoundingClientRect().bottom;
    assert.ok(
      Math.abs(actualGap) < 1,
      `zero remains zero at the rendered position (actual ${actualGap}px)`,
    );
  });
});

// ── Demo pages ───────────────────────────────────────────────────────────
//
// A usage page that throws is a dead tile in the gallery, and nothing else
// in the gate chain looks at one: the demo modules evaluate fine (so the
// index is clean) and are only ever RENDERED by the catalog. So every page
// this wave adds is rendered once here, and asserted to have produced its
// component rather than a blank frame.
/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;
const PAGES: Record<string, unknown> = { ...DEMOS_ANIMATED_IMAGE, ...DEMOS_BAR_LIST, ...DEMOS_CAROUSEL, ...DEMOS_CHART, ...DEMOS_DYNAMIC_ISLAND, ...DEMOS_MORPHING_DIALOG, ...DEMOS_MORPHING_POPOVER, ...DEMOS_SCROLLER, ...DEMOS_ZOOMABLE_FRAME };
const ChartDemo = PAGES['Chart'] as AnyComponent;
const BarListDemo = PAGES['BarList'] as AnyComponent;
const ScrollerDemo = PAGES['Scroller'] as AnyComponent;
const CarouselDemo = PAGES['Carousel'] as AnyComponent;
const ZoomableFrameDemo = PAGES['ZoomableFrame'] as AnyComponent;
const AnimatedImageDemo = PAGES['AnimatedImage'] as AnyComponent;
const DynamicIslandDemo = PAGES['DynamicIsland'] as AnyComponent;
const MorphingDialogDemo = PAGES['MorphingDialog'] as AnyComponent;
const MorphingPopoverDemo = PAGES['MorphingPopover'] as AnyComponent;
/* eslint-enable @typescript-eslint/no-explicit-any */

module('Pretui | structure usage pages render', function (hooks) {
  setupCardTest(hooks);

  test('chart pages', async function (assert) {
    await render(<template><ChartDemo /></template>);
    assert.ok(query('[data-test-pretui-chart-plot] svg'), 'Chart page drew');
    await render(<template><BarListDemo /></template>);
    assert.ok(query('.pretui-barlist-row'), 'BarList page drew');
  });

  test('viewport pages', async function (assert) {
    await render(<template><ScrollerDemo /></template>);
    assert.ok(query('[data-test-pretui-scroller-viewport]'), 'Scroller page');
    await render(<template><CarouselDemo /></template>);
    assert.ok(query('.pretui-carousel-slide'), 'Carousel page');
    await render(<template><ZoomableFrameDemo /></template>);
    assert.ok(query('[data-test-pretui-frame-viewport]'), 'ZoomableFrame page');
  });

  test('morph pages', async function (assert) {
    await render(<template><AnimatedImageDemo /></template>);
    assert.ok(query('[data-test-pretui-animated-image]'), 'AnimatedImage page');
    await render(<template><DynamicIslandDemo /></template>);
    assert.ok(query('[data-test-pretui-island-capsule]'), 'DynamicIsland page');
    await render(<template><MorphingDialogDemo /></template>);
    assert.ok(
      query('[data-test-pretui-morphing-dialog-trigger]'),
      'MorphingDialog page',
    );
    await render(<template><MorphingPopoverDemo /></template>);
    assert.ok(
      query('[data-test-pretui-morphing-popover-trigger]'),
      'MorphingPopover page',
    );
  });
});
