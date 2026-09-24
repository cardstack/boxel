import { on } from '@ember/modifier';
import { click, find, findAll, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import {
  animationsSettled,
  isMotionIdle,
  orphanCount,
  setupMotion,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { eq } from '@cardstack/boxel-ui/helpers';

import StackMotion from '@cardstack/host/components/operator-mode/stack-motion';
import SearchSheetMotion from '@cardstack/host/components/search-sheet/motion';
import headerMotionParts from '@cardstack/host/modifiers/header-motion-parts';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class HeaderFixture extends Component {
  @tracked expanded = false;
  @tracked shifted = false;
  shift = () => (this.shifted = !this.shifted);
  @tracked slot: HTMLElement | null = null;
  toggle = () => (this.expanded = !this.expanded);
  capture = modifier((element: HTMLElement) => {
    this.slot = element;
  });
  get cardStyle() {
    return {
      width: this.expanded ? '42rem' : this.shifted ? '30rem' : '24rem',
      height: this.expanded ? '24rem' : '12rem',
      marginTop: this.expanded ? '4rem' : this.shifted ? '6rem' : '10rem',
      overflow: 'hidden',
    };
  }

  <template>
    <button
      type='button'
      {{on 'click' this.toggle}}
      data-test-toggle
    >Expand</button>
    <button
      type='button'
      {{on 'click' this.shift}}
      data-test-shift
    >Reflow</button>
    <StackMotion @duration={{0.6}} class='stage'>
      <div class='slot' {{this.capture}} data-test-slot></div>
      <div
        {{motion id='card' role='stack-card' style=this.cardStyle}}
        data-test-card
      >
        {{#if this.expanded}}
          {{#if this.slot}}
            {{#in-element this.slot}}
              <div
                class='header expanded'
                {{motion id='card:header' role='stack-header'}}
                {{headerMotionParts 'card:header'}}
                data-test-header
              ><span class='realm-icon-container'>◆</span><span
                  class='card-type-display-name'
                >Card title</span><span class='actions'>×</span></div>
            {{/in-element}}
          {{/if}}
        {{else}}
          <div
            class='header'
            {{motion id='card:header' role='stack-header'}}
            {{headerMotionParts 'card:header'}}
            data-test-header
          ><span class='realm-icon-container'>◆</span><span
              class='card-type-display-name'
            >Card title</span><span class='actions'>×</span></div>
        {{/if}}
        Card content
      </div>
    </StackMotion>
    <style scoped>
      .stage {
        display: flow-root;
        width: 48rem;
        height: 32rem;
        position: relative;
      }
      .slot {
        position: absolute;
        top: 0;
        left: 15rem;
        width: 20rem;
        height: 2rem;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        --stack-header-expanded: 0;
        --stack-header-roundness: var(--stack-header-expanded);
        border-radius: calc(0.5rem + 1rem * var(--stack-header-roundness))
          calc(0.5rem + 1rem * var(--stack-header-roundness))
          calc(1.5rem * var(--stack-header-roundness))
          calc(1.5rem * var(--stack-header-roundness));
        width: 100%;
        min-width: 100%;
        height: 2rem;
        background: white;
        box-shadow: var(--boxel-motion-raised-shadow);
      }
      .card-type-display-name {
        flex: 1;
        text-align: center;
      }
      .expanded .card-type-display-name {
        text-align: left;
      }
      .expanded {
        --stack-header-expanded: 1;
      }
    </style>
  </template>
}

class SheetFixture extends Component {
  @tracked size: 'closed' | 'prompt' | 'results' = 'closed';
  @tracked duration = 0.2;
  @tracked narrow = false;
  prompt = () => (this.size = 'prompt');
  results = () => (this.size = 'results');
  close = () => (this.size = 'closed');
  resize = () => (this.narrow = !this.narrow);
  instant = () => (this.duration = 0);

  <template>
    <button
      type='button'
      {{on 'click' this.prompt}}
      data-test-prompt
    >Prompt</button>
    <button
      type='button'
      {{on 'click' this.results}}
      data-test-results
    >Results</button>
    <button
      type='button'
      {{on 'click' this.close}}
      data-test-close
    >Close</button>
    <button
      type='button'
      {{on 'click' this.resize}}
      data-test-resize
    >Resize</button>
    <button type='button' {{on 'click' this.instant}} data-test-instant>Skip
      motion</button>
    <div class='stage {{if this.narrow "narrow"}}' data-test-stage>
      <SearchSheetMotion
        @size={{this.size}}
        @duration={{this.duration}}
        data-test-sheet
      >
        {{#unless (eq this.size 'closed')}}
          <input
            aria-label='Search'
            {{motion role='search-sheet-content'}}
            data-test-input
          />
          <div
            {{motion role='search-sheet-content'}}
            data-test-results-content
          >Results</div>
          <div
            {{motion role='search-sheet-footer'}}
            data-test-footer
          >Cancel</div>
        {{/unless}}
      </SearchSheetMotion>
    </div>
    <style scoped>
      .stage {
        position: relative;
        width: 48rem;
        height: 32rem;
        --operator-mode-bottom-bar-item-height: 3rem;
        --operator-mode-spacing: 1rem;
        --container-button-size: 3rem;
        --stack-padding-top: 4rem;
      }
      .narrow {
        width: 36rem;
        height: 24rem;
      }
    </style>
  </template>
}

function element(selector: string) {
  return find(selector) as HTMLElement;
}

function assertRect(
  assert: Assert,
  actual: DOMRect,
  expected: DOMRect,
  label: string,
) {
  for (let key of ['x', 'y', 'width', 'height'] as const) {
    assert.true(
      Math.abs(actual[key] - expected[key]) < 1,
      `${label}: ${key} reaches ${expected[key]} (was ${actual[key]})`,
    );
  }
}

function dropFrames() {
  let end = performance.now() + 300;
  while (performance.now() < end) {
    /* Simulate a busy card render. */
  }
}

module('Integration | chrome motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('header flight stays within measured boxes with one visible copy at the correct layer', async function (assert) {
    await renderComponent(HeaderFixture);
    await animationsSettled();
    let cardHeader = element('[data-test-header]').getBoundingClientRect();
    let slot = element('[data-test-slot]').getBoundingClientRect();
    for (let [label, origin, target] of [
      ['expand', cardHeader, slot],
      ['restore', slot, cardHeader],
    ] as const) {
      await click('[data-test-toggle]');
      let frames: DOMRect[] = [];
      let radii: number[] = [];
      let hiddenDonors = true;
      let visibleDonors: string[] = [];
      let correctLayer = true;
      let unscaled = true;
      let nativeTransform = false;
      let layoutSizes = new Set<string>();
      let fixedShadowPaint = true;
      let shadowsAligned = true;
      while (!isMotionIdle()) {
        let header = find('[data-choreo-raised] [data-test-header]');
        if (header) {
          layoutSizes.add(
            `${(header as HTMLElement).offsetWidth}:${(header as HTMLElement).offsetHeight}`,
          );
          nativeTransform ||= header
            .getAnimations({ subtree: true })
            .some((animation) =>
              (animation.effect as KeyframeEffect)
                .getKeyframes()
                .some((frame) => frame.transform),
            );
          for (let part of header.querySelectorAll(
            '.card-type-display-name, .realm-icon-container, .actions',
          )) {
            let matrix = new DOMMatrixReadOnly(
              getComputedStyle(part).transform,
            );
            unscaled &&= matrix.a === 1 && matrix.d === 1;
          }
          let surface = header.querySelector('.header-motion-surface')!;
          let shadow = header.querySelector('.header-motion-shadow')!;
          fixedShadowPaint &&=
            getComputedStyle(surface).boxShadow === 'none' &&
            getComputedStyle(shadow).boxShadow !== 'none' &&
            shadow
              .getAnimations()
              .every((animation) =>
                (animation.effect as KeyframeEffect)
                  .getKeyframes()
                  .every(
                    (frame) =>
                      !('boxShadow' in frame) &&
                      !('borderRadius' in frame) &&
                      !('filter' in frame),
                  ),
              );
          let shadowBox = shadow.getBoundingClientRect();
          let surfaceBox = surface.getBoundingClientRect();
          shadowsAligned &&=
            Math.abs(shadowBox.x - surfaceBox.x) < 1 &&
            Math.abs(shadowBox.width - surfaceBox.width) < 1;
          frames.push(surface.getBoundingClientRect());
          radii.push(
            parseFloat(getComputedStyle(surface).borderBottomLeftRadius),
          );
          hiddenDonors &&= findAll('[data-test-header]').every(
            (copy) =>
              copy === header || getComputedStyle(copy).visibility === 'hidden',
          );
          if (!hiddenDonors && visibleDonors.length < 3) {
            visibleDonors.push(
              `frame ${frames.length}: ${findAll('[data-test-header]')
                .filter((copy) => copy !== header)
                .map((copy) => copy.outerHTML)
                .join('')}`,
            );
          }
          correctLayer &&=
            getComputedStyle(header.parentElement!).zIndex === '150';
          let transform = new DOMMatrixReadOnly(
            getComputedStyle(header).transform,
          );
          unscaled &&=
            Math.abs(transform.a - 1) < 0.001 &&
            Math.abs(transform.d - 1) < 0.001;
        }
        await new Promise<void>((resolve) =>
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Sample painted geometry; animation completion is awaited separately.
          requestAnimationFrame(() => resolve()),
        );
      }
      await animationsSettled();
      assert.true(frames.length > 2, `${label}: sampled the moving receiver`);
      for (let key of ['x', 'y', 'width', 'height'] as const) {
        let min = Math.min(...frames.map((f) => f[key]));
        let max = Math.max(...frames.map((f) => f[key]));
        let withinEnvelope =
          min >= Math.min(origin[key], target[key]) - 1 &&
          max <= Math.max(origin[key], target[key]) + 1;
        assert.true(
          withinEnvelope,
          `${label}: ${key} expected ${origin[key]} → ${target[key]}, measured ${min.toFixed(2)}–${max.toFixed(2)} across ${frames.length} frames`,
        );
      }
      assert.true(
        hiddenDonors,
        `${label}: only the receiver is visible; ${visibleDonors.join('; ')}`,
      );
      assert.true(correctLayer, `${label}: flying header stays at layer 150`);
      assert.strictEqual(
        layoutSizes.size,
        1,
        `${label}: live header layout resolves once`,
      );
      assert.true(nativeTransform, `${label}: browser owns transform playback`);
      assert.true(
        fixedShadowPaint,
        `${label}: shadow paint is independent of the radius tween`,
      );
      assert.true(
        shadowsAligned,
        `${label}: shadow follows the same surface boundary`,
      );
      assert.true(unscaled, `${label}: text and icons are not stretched`);
      let pillRadius =
        1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      let hasIntermediateRadius = radii.some(
        (radius) => radius > 0.1 && radius < pillRadius - 0.1,
      );
      assert.true(
        hasIntermediateRadius,
        `${label}: corners tween through intermediate radii`,
      );
      assert.true(
        Math.min(...radii) >= 0,
        `${label}: radius does not undershoot`,
      );
      assert.true(
        Math.max(...radii) <= pillRadius + 0.1,
        `${label}: radius does not overshoot`,
      );
      assert.strictEqual(
        parseFloat(
          getComputedStyle(element('[data-test-header]'))
            .borderBottomLeftRadius,
        ),
        label === 'expand' ? pillRadius : 0,
        `${label}: corners reach their resting shape`,
      );
      assertRect(
        assert,
        element('[data-test-header]').getBoundingClientRect(),
        target,
        `${label} destination`,
      );
    }
  });

  test('ordinary header reflow rides its card without a second transform', async function (assert) {
    await renderComponent(HeaderFixture);
    await animationsSettled();
    await click('[data-test-shift]');
    let frames = 0;
    let maxError = 0;
    let raised = false;
    while (!isMotionIdle()) {
      let card = element('[data-test-card]').getBoundingClientRect();
      let header = element('[data-test-header]').getBoundingClientRect();
      maxError = Math.max(
        maxError,
        ...(['x', 'y', 'width'] as const).map((key) =>
          Math.abs(card[key] - header[key]),
        ),
      );
      raised ||= Boolean(find('[data-choreo-raised] [data-test-header]'));
      frames++;
      await new Promise<void>((resolve) =>
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Sample painted geometry; animation completion is awaited separately.
        requestAnimationFrame(() => resolve()),
      );
    }
    await animationsSettled();
    assert.true(frames > 2, 'sampled the reflow');
    assert.false(raised, 'ordinary header stays inside its card');
    assert.true(
      maxError < 1,
      `header follows its card exactly: maximum error ${maxError}px`,
    );
  });

  test('header travels between the card and portal and releases its raised layer', async function (assert) {
    await renderComponent(HeaderFixture);
    await animationsSettled();
    let initial = element('[data-test-header]').getBoundingClientRect();
    await click('[data-test-toggle]');
    await waitUntil(() =>
      Boolean(find('[data-choreo-raised] [data-test-header]')),
    );
    let mid = element(
      '[data-choreo-raised] [data-test-header]',
    ).getBoundingClientRect();
    assert.true(
      mid.y > element('[data-test-slot]').getBoundingClientRect().y,
      'the title travels from the card instead of appearing at the destination',
    );
    await animationsSettled();
    assertRect(
      assert,
      element('[data-test-header]').getBoundingClientRect(),
      element('[data-test-slot]').getBoundingClientRect(),
      'expanded header',
    );
    await click('[data-test-toggle]');
    await animationsSettled();
    assertRect(
      assert,
      element('[data-test-header]').getBoundingClientRect(),
      initial,
      'restored header',
    );
    assert.dom('[data-choreo-raised] [data-test-header]').doesNotExist();
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });

  test('header reversal under load reaches the latest expanded state', async function (assert) {
    await renderComponent(HeaderFixture);
    await animationsSettled();
    await click('[data-test-toggle]');
    await click('[data-test-toggle]');
    dropFrames();
    await click('[data-test-toggle]');
    await animationsSettled();
    assert.dom('[data-test-header]').exists({ count: 1 });
    assert.strictEqual(
      parseFloat(
        getComputedStyle(element('[data-test-header]')).borderBottomLeftRadius,
      ),
      1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      'interrupted radius reaches the latest expanded shape',
    );
    assertRect(
      assert,
      element('[data-test-header]').getBoundingClientRect(),
      element('[data-test-slot]').getBoundingClientRect(),
      'latest header',
    );
    assert.dom('[data-choreo-raised] [data-test-header]').doesNotExist();
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });

  test('enabling reduced motion during a header handoff finishes at the destination', async function (assert) {
    let matchMedia = window.matchMedia;
    let preference = matchMedia.call(
      window,
      '(prefers-reduced-motion: reduce)',
    );
    let events = new EventTarget();
    let reduced = false;
    window.matchMedia = (query) =>
      query === '(prefers-reduced-motion: reduce)'
        ? ({
            ...preference,
            get matches() {
              return reduced;
            },
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
          } as MediaQueryList)
        : matchMedia.call(window, query);
    try {
      await renderComponent(HeaderFixture);
      await animationsSettled();
      await click('[data-test-toggle]');
      reduced = true;
      events.dispatchEvent(new Event('change'));
      await animationsSettled();
      assertRect(
        assert,
        element('[data-test-header]').getBoundingClientRect(),
        element('[data-test-slot]').getBoundingClientRect(),
        'reduced-motion header',
      );
      assert.strictEqual(orphanCount(), 0);
      assert.deepEqual(strandedTransforms(), []);
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  test('sheet stays bottom anchored and reaches results after interrupted resize and dropped frames', async function (assert) {
    await renderComponent(SheetFixture);
    await animationsSettled();
    let closed = element('[data-test-sheet]').getBoundingClientRect();
    await click('[data-test-prompt]');
    await waitUntil(
      () =>
        element('[data-test-sheet]').getBoundingClientRect().height >
        closed.height + 5,
    );
    assert.true(
      Math.abs(
        element('[data-test-sheet]').getBoundingClientRect().bottom -
          element('[data-test-stage]').getBoundingClientRect().bottom,
      ) < 1,
      'the bottom remains anchored during motion',
    );
    let sheet = element('[data-test-sheet]');
    let surface = sheet.querySelector<HTMLElement>('.sheet-surface')!;
    let layoutHeight = sheet.offsetHeight;
    let bottom = element('[data-test-stage]').getBoundingClientRect().bottom;
    let bottomError = 0;
    let layoutChanged = false;
    let nativeSurface = false;
    while (!isMotionIdle()) {
      bottomError = Math.max(
        bottomError,
        Math.abs(surface.getBoundingClientRect().bottom - bottom),
      );
      layoutChanged ||= sheet.offsetHeight !== layoutHeight;
      nativeSurface ||= surface
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .some((frame) => frame.transform),
        );
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Observe painted geometry, not application state.
        requestAnimationFrame(() => resolve());
      });
    }
    assert.true(
      bottomError < 1,
      `surface stays bottom anchored: ${bottomError}px`,
    );
    assert.false(
      layoutChanged,
      'the populated sheet does not relayout during playback',
    );
    assert.true(nativeSurface, 'the browser owns the empty surface transform');
    element('[data-test-input]').focus();
    await click('[data-test-results]');
    dropFrames();
    await click('[data-test-resize]');
    await animationsSettled();
    let animated = element('[data-test-sheet]').getBoundingClientRect();
    assert.dom('[data-test-results-content]').hasStyle({ opacity: '1' });
    assert.dom('[data-test-footer]').hasStyle({ opacity: '1' });

    await click('[data-test-instant]');
    await click('[data-test-close]');
    await click('[data-test-results]');
    await animationsSettled();
    assertRect(
      assert,
      animated,
      element('[data-test-sheet]').getBoundingClientRect(),
      'animated and immediate layout',
    );
    assert.deepEqual(strandedTransforms(), []);
  });

  test('closing mid-entry releases content and repositions dropdowns at the final layout', async function (assert) {
    await renderComponent(SheetFixture);
    await animationsSettled();
    let closed = element('[data-test-sheet]').getBoundingClientRect();
    let positions: DOMRect[] = [];
    let onResize = () =>
      positions.push(element('[data-test-sheet]').getBoundingClientRect());
    window.addEventListener('resize', onResize);
    try {
      await click('[data-test-results]');
      await click('[data-test-close]');
      await animationsSettled();
      assert.dom('[data-test-input]').doesNotExist();
      assertRect(
        assert,
        element('[data-test-sheet]').getBoundingClientRect(),
        closed,
        'closed sheet',
      );
      await click('[data-test-instant]');
      await click('[data-test-prompt]');
      await animationsSettled();
      assert.true(
        positions.length > 0,
        'completion also repositions dropdowns with motion disabled',
      );
      assertRect(
        assert,
        positions.at(-1)!,
        element('[data-test-sheet]').getBoundingClientRect(),
        'dropdown completion',
      );
      assert.strictEqual(orphanCount(), 0);
      assert.deepEqual(strandedTransforms(), []);
    } finally {
      window.removeEventListener('resize', onResize);
    }
  });
});
