import { on } from '@ember/modifier';
import { click, find, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { module, test } from 'qunit';

import { afterMotionPaint } from '@cardstack/host/lib/after-motion-paint';
import { crossfadeCardBitmap } from '@cardstack/host/lib/bitmap-crossing';
import {
  embeddedCardElement,
  embeddedCardOrigin,
  cardActionOrigin,
  forgetCardActionOrigin,
} from '@cardstack/host/lib/card-open-origin';
import {
  boundaryEase,
  boundaryReturnEase,
  motionDurations,
} from '@cardstack/host/lib/motion-timing';
import cardActivation from '@cardstack/host/modifiers/card-activation';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let completion: Promise<void> | undefined;
let bitmapReady: Promise<void> | undefined;
let focusAtUpdate: Element | null = null;
class EmbeddedFixture extends Component {
  @tracked opened = false;
  @tracked duplicate = false;
  @tracked flattened = false;
  @tracked deferred = false;
  @tracked bodyReady = true;
  @tracked custom = false;
  useCustom = () => (this.custom = true);
  defer = () => (this.deferred = true);
  flatten = () => (this.flattened = true);
  duplicatePreview = () => (this.duplicate = true);
  close = (event: Event) => {
    let source = (event.currentTarget as HTMLElement).parentElement!;
    let underlay =
      source.parentElement!.querySelector<HTMLElement>('[data-test-index]')!;
    let ready!: () => void;
    bitmapReady = new Promise<void>((resolve) => (ready = resolve));
    completion = crossfadeCardBitmap({
      from: source,
      to: this.custom
        ? '[data-test-open-gallery]'
        : this.flattened
          ? '.preview-surface'
          : '[data-boxel-card-format="fitted"]',
      update: () => {
        focusAtUpdate = document.activeElement;
        this.opened = false;
      },
      duration: motionDurations.boundaryReturn,
      ease: boundaryReturnEase,
      onReady: ready,
      parent: underlay,
    });
  };
  open = (event: Event) => {
    let boundary = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '[data-test-index]',
    )!;
    let source = cardActionOrigin(
      boundary,
      'https://example.test/gallery',
    )?.source;
    if (!source) return;
    let ready!: () => void;
    bitmapReady = new Promise<void>((resolve) => (ready = resolve));
    completion = crossfadeCardBitmap({
      from: source,
      to: '[data-test-opened-gallery]',
      update: () => {
        this.bodyReady = !this.deferred;
        this.opened = true;
      },
      duration: motionDurations.boundary,
      ease: boundaryEase,
      onReady: () => ready(),
      parent: boundary,
    }).finally(async () => {
      if (this.deferred)
        await new Promise<void>((resolve) => {
          afterMotionPaint(() => {
            this.bodyReady = true;
            resolve();
          });
        });
    });
  };
  <template>
    <section
      class='index {{if this.opened "underneath"}}'
      data-test-index
      {{cardActivation}}
    >
      {{#if this.opened}}
        <header class='stack-item-header' data-test-matched-header>
          <span class='realm-icon'>A</span>
          <span class='card-type-display-name'>Workspace — Recipe Library</span>
        </header>
      {{else}}
        <header class='stack-item-header' data-test-matched-header>
          <span class='realm-icon'>A</span>
          <span class='card-type-display-name'>Workspace — Recipe Library</span>
        </header>
      {{/if}}
      <div class='stack-item-content'>
        <div
          class='preview {{if this.flattened "flattened"}}'
          data-boxel-card-id='https://example.test/gallery'
          data-boxel-card-format={{unless this.custom 'fitted'}}
        ><article class='preview-surface'>Gallery preview</article></div>
        {{#if this.duplicate}}
          {{! A fitted tile opens on click without being a button itself. }}
          {{! template-lint-disable no-invalid-interactive }}
          <div
            class='preview'
            data-boxel-card-id='https://example.test/gallery'
            data-boxel-card-format='fitted'
            data-test-duplicate-preview
            {{on 'click' this.open}}
          ><span data-test-duplicate-face>Another preview</span></div>
        {{/if}}
        <button
          type='button'
          {{on 'click' this.open}}
          data-test-open-gallery
        >Open Gallery</button>
      </div>
      <button type='button' {{on 'click' this.flatten}} data-test-flatten>Use
        delegated layout</button>
      <button type='button' {{on 'click' this.defer}} data-test-defer>Defer
        content</button>
      <button type='button' {{on 'click' this.useCustom}} data-test-custom>Use
        custom action</button>
      <button
        type='button'
        {{on 'click' this.duplicatePreview}}
        data-test-duplicate
      >Duplicate</button>
    </section>
    {{#if this.opened}}
      <section class='opened stack-item-card' data-test-opened-gallery>
        {{#if this.bodyReady}}<h1>Recipe Gallery</h1>{{/if}}
        <button
          type='button'
          {{on 'click' this.close}}
          data-test-close-gallery
        >Close</button>
      </section>
    {{/if}}
    <style scoped>
      .index {
        position: relative;
        width: 42rem;
        height: 30rem;
        border-radius: 1rem;
        background: white;
        box-shadow: var(--boxel-motion-raised-shadow);
      }
      .index.underneath {
        width: 24rem;
        height: 36rem;
      }
      .stack-item-content {
        height: calc(100% - 3rem);
        overflow: hidden;
      }
      .underneath .stack-item-content {
        display: none;
      }
      .underneath .stack-item-content[data-retained-body-size] {
        display: block;
        position: absolute;
        visibility: hidden;
        width: var(--retained-body-width);
        height: var(--retained-body-height);
      }
      .preview {
        width: 12rem;
        height: 8rem;
        border-radius: 0.5rem;
        box-shadow: 0 0.125rem 0.5rem rgb(28 28 50 / 5%);
      }
      .preview.flattened {
        display: contents;
        overflow: hidden;
      }
      .preview-surface {
        width: 12rem;
        height: 8rem;
        border-radius: 0.5rem;
      }
      .stack-item-header {
        display: flex;
        align-items: center;
        height: 3rem;
        background: white;
        border-radius: 1rem 1rem 0 0;
      }
      .realm-icon {
        width: 2rem;
        height: 2rem;
      }
      .underneath .realm-icon {
        width: 1.5rem;
        height: 1.5rem;
      }
      .card-type-display-name {
        flex: 1;
        font-size: 1rem;
        text-align: center;
      }
      .underneath .card-type-display-name {
        font-size: 0.875rem;
      }
      .opened {
        position: fixed;
        left: 3rem;
        top: 12rem;
        width: 36rem;
        height: 24rem;
        border-radius: 1.5rem;
      }
    </style>
  </template>
}
class BitmapFixture extends Component {
  @tracked opened = false;
  @tracked modal = false;
  openModal = () => (this.modal = true);
  close = (event: Event) => {
    completion = crossfadeCardBitmap({
      from: event.currentTarget as HTMLElement,
      to: '[data-test-bitmap-source]',
      update: () => {
        this.opened = false;
      },
      duration: 0.8,
    });
  };
  open = (event: Event) => {
    completion = crossfadeCardBitmap({
      from: event.currentTarget as HTMLElement,
      to: '[data-test-bitmap-target]',
      update: () => {
        this.opened = true;
      },
      duration: 0.8,
    });
  };
  <template>
    <div class='submode-layout-top-bar' data-test-bitmap-chrome>Stationary
      toolbar</div>
    <div class='search-sheet closed' data-test-search-dock>Search</div>
    <button
      type='button'
      class='add-card-to-neighbor-stack'
      data-test-edge-control
    >Add stack</button>
    <button
      type='button'
      {{on 'click' this.openModal}}
      data-test-open-modal
    >Open modal</button>
    {{#if this.modal}}
      <div
        role='dialog'
        aria-modal='true'
        aria-label='Modal above workspace'
      ></div>
    {{/if}}
    <div>
      {{#if this.opened}}
        <button
          type='button'
          class='card'
          data-test-bitmap-target
          {{on 'click' this.close}}
        ><span>Natural card typography</span></button>
      {{else}}
        <button
          class='tile'
          type='button'
          {{on 'click' this.open}}
          data-test-bitmap-source
        >Fitted preview</button>
      {{/if}}
    </div>
    <style scoped>
      .tile {
        width: 10rem;
        height: 6rem;
        border-radius: 1rem;
      }
      .card {
        width: 30rem;
        height: 22rem;
        border-radius: 1rem;
      }
      .card span {
        display: inline-block;
        font-size: 1rem;
      }
    </style>
  </template>
}
module('Integration | bitmap motion', function (hooks) {
  setupRenderingTest(hooks);
  test('custom viewCard actions use the activated button and retain a parent-scoped reverse address', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-custom]');
    let parent = find('[data-test-index]') as HTMLElement;
    let button = find('[data-test-open-gallery]') as HTMLElement;
    let id = 'https://example.test/gallery';
    assert.strictEqual(
      cardActionOrigin(parent, id),
      undefined,
      'an earlier unrelated click is not an origin',
    );
    await click(button);
    await bitmapReady;
    assert.ok(
      (find('[data-test-opened-gallery]') as HTMLElement).style
        .viewTransitionName,
      'custom action owns native crossing',
    );
    await completion;
    assert.strictEqual(
      embeddedCardElement(parent, id),
      button,
      'return keeps the exact activated button',
    );
    assert.strictEqual(
      embeddedCardElement(parent, 'https://example.test/other'),
      undefined,
      'address cannot match another card',
    );
    await click('[data-test-close-gallery]');
    await bitmapReady;
    assert.ok(
      button.style.viewTransitionName,
      'close transmutates back to the custom button',
    );
    await completion;
    forgetCardActionOrigin(parent, id);
    assert.strictEqual(
      embeddedCardElement(parent, id),
      undefined,
      'return address released',
    );
  });
  test('native playback is ready before the card body mounts, and interruption cannot leave content deferred', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-defer]');
    await click('[data-test-open-gallery]');
    await bitmapReady;
    assert
      .dom('[data-test-opened-gallery] h1')
      .doesNotExist('capture completes without the destination body');
    let target = find('[data-test-opened-gallery]') as HTMLElement;
    let bounds = target.getBoundingClientRect();
    await waitUntil(() => !!find('[data-test-opened-gallery] h1'));
    assert.notOk(
      target.style.viewTransitionName,
      'body waits until native playback and its snapshot cleanup finish',
    );
    assert.strictEqual(
      target.getBoundingClientRect().width,
      bounds.width,
      'mounting content does not change the shell endpoint',
    );
    await completion;
    let calls = 0;
    let finish = afterMotionPaint(() => calls++);
    finish();
    finish();
    assert.strictEqual(
      calls,
      1,
      'finishing an interrupted reveal runs it exactly once',
    );
  });
  test('delegated display-contents cards match their visible surface at any stack depth and return to it', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-flatten]');
    let parent = find('[data-test-index]') as HTMLElement;
    let surface = find('.preview-surface') as HTMLElement;
    let id = 'https://example.test/gallery';
    let origin = embeddedCardOrigin(parent, id);
    assert.strictEqual(
      origin?.source,
      surface,
      'boxless identity resolves to its actual card surface',
    );
    assert.ok(
      Math.min(origin?.width ?? 0, origin?.height ?? 0) > 0,
      'boxless overflow ancestor does not erase visible bounds',
    );
    await click('[data-test-open-gallery]');
    await bitmapReady;
    assert.ok(
      (find('[data-test-opened-gallery]') as HTMLElement).style
        .viewTransitionName,
      'selected child owns a bitmap match',
    );
    await completion;
    assert.strictEqual(
      embeddedCardElement(parent, id),
      surface,
      'hidden parent still resolves the exact return surface',
    );
    assert.strictEqual(
      embeddedCardOrigin(parent, id),
      undefined,
      'hidden content is not an opening origin',
    );
    await click('[data-test-close-gallery]');
    await bitmapReady;
    assert.ok(
      surface.style.viewTransitionName,
      'return matches the surface, not its zero-size wrapper',
    );
    await completion;
    assert.strictEqual(
      embeddedCardOrigin(parent, id)?.source,
      surface,
      'surface is visible at its original endpoint',
    );
    await waitUntil(() => !surface.style.viewTransitionName);
    assert.strictEqual(
      surface.style.viewTransitionName,
      '',
      'temporary match is released',
    );
    assert.dom('[data-bitmap-body]').doesNotExist();
    // The host releases the return address once the card has closed.
    forgetCardActionOrigin(parent, id);
    await click('[data-test-duplicate]');
    assert.strictEqual(
      embeddedCardElement(parent, id),
      undefined,
      'duplicate identities remain ambiguous',
    );
  });
  test('a card shown twice opens from the clicked preview and returns to it', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-duplicate]');
    let parent = find('[data-test-index]') as HTMLElement;
    let clicked = find('[data-test-duplicate-preview]') as HTMLElement;
    let id = 'https://example.test/gallery';
    assert.strictEqual(
      embeddedCardOrigin(parent, id),
      undefined,
      'two visible previews are ambiguous by identity alone',
    );
    await click('[data-test-duplicate-face]');
    await bitmapReady;
    assert.ok(
      (find('[data-test-opened-gallery]') as HTMLElement).style
        .viewTransitionName,
      'the clicked preview is an opening origin',
    );
    await completion;
    assert.strictEqual(
      embeddedCardElement(parent, id),
      clicked,
      'the hidden parent returns to the preview it left from',
    );
    forgetCardActionOrigin(parent, id);
  });
  test('capture reads shared-element styles before writing participant names', async function (assert) {
    await renderComponent(EmbeddedFixture);
    let sources = [
      find('[data-boxel-card-format="fitted"]'),
      find('[data-test-index]'),
      find('.stack-item-header'),
      find('.card-type-display-name'),
      find('.realm-icon'),
    ] as HTMLElement[];
    let original = window.getComputedStyle;
    let interleavedReads = 0;
    window.getComputedStyle = (element, pseudo) => {
      if (!pseudo && sources.includes(element as HTMLElement)) {
        let named = sources.filter((source) => source.style.viewTransitionName);
        // Reading an as-yet unnamed source after another source was named
        // forces another recalc. Geometry reads after ALL names are assigned
        // are a separate, necessary phase and are not counted here.
        if (named.length && !named.includes(element as HTMLElement))
          interleavedReads++;
      }
      return original.call(window, element, pseudo);
    };
    try {
      await click('[data-test-open-gallery]');
      await bitmapReady;
    } finally {
      window.getComputedStyle = original;
    }
    await completion;
    assert.strictEqual(
      interleavedReads,
      0,
      'additional header/shadow matches do not add read-write style flushes',
    );
    assert
      .dom('[data-test-opened-gallery]')
      .exists('destination still renders');
  });
  test('workspace and selected preview transmute in parallel to the lower and upper stack boundaries', async function (assert) {
    await renderComponent(EmbeddedFixture);
    let source = find('[data-boxel-card-format="fitted"]') as HTMLElement;
    let from = source.getBoundingClientRect();
    let index = find('[data-test-index]') as HTMLElement;
    let indexFrom = index.getBoundingClientRect();
    await click('[data-test-open-gallery]');
    await bitmapReady;
    await waitUntil(
      () =>
        !!(find('[data-test-opened-gallery]') as HTMLElement | null)?.style
          .viewTransitionName,
    );
    let target = find('[data-test-opened-gallery]') as HTMLElement;
    let name = target.style.viewTransitionName;
    let indexName = index.style.viewTransitionName;
    let header = index.querySelector<HTMLElement>('.stack-item-header')!;
    let body = find('[data-bitmap-body]') as HTMLElement;
    let title = index.querySelector<HTMLElement>('.card-type-display-name')!;
    let icon = index.querySelector<HTMLElement>('.realm-icon')!;
    let partPose = (part: HTMLElement, type = 'group') =>
      getComputedStyle(
        document.documentElement,
        `::view-transition-${type}(${part.style.viewTransitionName})`,
      );
    assert.strictEqual(
      new Set([name, indexName, header.style.viewTransitionName]).size,
      3,
      'card, parent, and its entering header have distinct matches',
    );
    assert.strictEqual(
      title.style.viewTransitionName,
      '',
      'title rides in the entering header snapshot',
    );
    assert.strictEqual(
      icon.style.viewTransitionName,
      '',
      'realm icon rides in the entering header snapshot',
    );
    assert.notStrictEqual(indexName, name, 'two independent boundary matches');
    await waitUntil(() =>
      document
        .getAnimations()
        .some(
          (animation) =>
            (animation.effect as KeyframeEffect)?.pseudoElement ===
            `::view-transition-group(${name})`,
        ),
    );
    let animations = document.getAnimations();
    let groups = animations.filter(
      (animation) =>
        (animation.effect as KeyframeEffect)?.pseudoElement ===
        `::view-transition-group(${name})`,
    );
    for (let animation of groups) {
      assert.strictEqual(
        animation.effect!.getComputedTiming().duration,
        360,
        'opening uses a bounded 360ms browser animation',
      );
      assert.true(
        animation.effect!.getTiming().easing!.startsWith('linear('),
        'spring response is baked into native easing',
      );
    }
    for (let animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    await new Promise<void>((resolve) => {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Wait for the paused compositor pose to be painted before measuring it.
      requestAnimationFrame(() => resolve());
    });
    let pose = () =>
      getComputedStyle(
        document.documentElement,
        `::view-transition-group(${name})`,
      );
    let indexPose = () =>
      getComputedStyle(
        document.documentElement,
        `::view-transition-group(${indexName})`,
      );
    // QUnit scales its fixture container. Native group width/height are CSS
    // dimensions; include the captured transform when comparing painted boxes.
    let painted = (style: CSSStyleDeclaration) => {
      let matrix = new DOMMatrixReadOnly(style.transform);
      let [originX = 0, originY = 0] = style.transformOrigin
        .split(' ')
        .map(parseFloat);
      return {
        width: parseFloat(style.width) * Math.hypot(matrix.a, matrix.b),
        height: parseFloat(style.height) * Math.hypot(matrix.c, matrix.d),
        x: matrix.e + originX * (1 - matrix.a) - originY * matrix.c,
      };
    };
    assert.strictEqual(
      Math.round(painted(indexPose()).width),
      Math.round(indexFrom.width),
      'workspace starts at its measured index width',
    );
    assert.strictEqual(indexPose().zIndex, '0', 'workspace stays underneath');
    let shadows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-bitmap-shadow]'),
    );
    assert.strictEqual(
      shadows.length,
      2,
      'only the primary card allocates contact and pool',
    );
    for (let shadow of shadows) {
      let shadowPose = () => partPose(shadow);
      assert.notStrictEqual(
        getComputedStyle(shadow).boxShadow,
        'none',
        'generated tokens actually paint the captured layer',
      );
      assert.strictEqual(
        shadowPose().zIndex,
        '4',
        'shadow above parent and below card',
      );
      assert.strictEqual(
        shadowPose().overflow,
        'visible',
        'ink escapes card crop',
      );
      assert.ok(
        Math.abs(painted(shadowPose()).width - painted(pose()).width) < 1,
        'shadow starts at selected boundary',
      );
      assert.ok(
        Math.abs(painted(shadowPose()).x - painted(pose()).x) < 1,
        'shadow starts aligned',
      );
    }
    assert.true(
      !!body.style.viewTransitionName,
      'body has a separate proportional bitmap match',
    );
    assert.strictEqual(
      partPose(body).zIndex,
      '1',
      'body sits between tray and header',
    );
    assert.strictEqual(
      partPose(header).zIndex,
      '2',
      'header sits above the body',
    );
    assert.strictEqual(
      pose().zIndex,
      '5',
      'selected Gallery stays above the complete parent',
    );
    let headerOffset = () =>
      new DOMMatrixReadOnly(partPose(header, 'new').transform).f;
    assert.ok(
      Math.abs(headerOffset() + parseFloat(partPose(header, 'new').height)) < 1,
      'the buried header starts one header-height above its strip',
    );
    assert.strictEqual(
      indexPose().overflow,
      'visible',
      'parent shadow is never clipped during travel',
    );
    assert.strictEqual(
      Math.round(painted(pose()).width),
      Math.round(from.width),
      'starts at the measured index boundary',
    );
    assert.ok(
      Math.abs(painted(pose()).height - from.height) < 1,
      'starts at the preview height',
    );
    for (let shadow of shadows)
      assert.strictEqual(
        partPose(shadow, 'new').opacity,
        '0',
        'the raised shadow starts from the tile lighting',
      );
    assert.strictEqual(
      painted(pose()).x,
      from.x,
      'starts at the index x position',
    );
    assert.true(
      groups.length > 0,
      'the one matched boundary owns browser geometry tracks',
    );
    for (let animation of animations) animation.currentTime = 30;
    for (let shadow of shadows) {
      let opacity = Number(partPose(shadow, 'new').opacity);
      assert.ok(opacity > 0, 'shadow has begun to enter at lift');
      assert.ok(opacity < 1, 'shadow enters without a hard jump');
      if (shadow.dataset.bitmapShadow === 'contact') {
        let old = Number(partPose(shadow, 'old').opacity);
        assert.ok(old > 0, 'faint tile contact shadow is still present');
        assert.ok(old < 1, 'tile contact yields to the raised card');
        assert.ok(
          Math.abs(old + opacity - 1) < 0.001,
          'the two painted contact faces trade opacity without a gap',
        );
      }
    }
    for (let animation of animations) animation.currentTime = 90;
    for (let shadow of shadows) {
      assert.ok(
        Math.abs(painted(partPose(shadow)).width - painted(pose()).width) < 1,
        'shadow follows the card width during travel',
      );
      assert.ok(
        Math.abs(painted(partPose(shadow)).height - painted(pose()).height) < 1,
        'shadow follows the card height during travel',
      );
      assert.ok(
        Math.abs(painted(partPose(shadow)).x - painted(pose()).x) < 1,
        'shadow never travels independently',
      );
    }
    let progress =
      (painted(pose()).width - from.width) /
      (target.getBoundingClientRect().width - from.width);
    assert.ok(progress > 0.05, 'the boundary has started moving');
    let indexProgress =
      (painted(indexPose()).width - indexFrom.width) /
      (index.getBoundingClientRect().width - indexFrom.width);
    assert.ok(
      Math.abs(indexProgress - progress) < 0.01,
      'workspace and Gallery use the same clock and easing',
    );
    assert.ok(
      progress < 0.4,
      'a quarter of the timeline still reads as departure, not completion',
    );
    assert.dom(target).hasStyle({ transform: 'none' });
    assert.dom(target.querySelector('h1')).hasStyle({ transform: 'none' });
    assert.strictEqual(
      partPose(body, 'old').objectFit,
      'contain',
      'complete content pane scales uniformly without cover cropping',
    );
    let bodyOpacity = Number(partPose(body, 'old').opacity);
    assert.ok(bodyOpacity > 0, 'departing body remains visible during travel');
    assert.ok(bodyOpacity < 1, 'departing body fades while shrinking');
    assert.strictEqual(
      partPose(body, 'new').opacity,
      '0',
      'empty buried frame never paints a duplicate body',
    );
    assert.ok(
      headerOffset() < 0,
      'the header is still sliding down while the card travels',
    );
    assert.dom(title).hasStyle({ fontSize: '14px', transform: 'none' });
    for (let time of [90, 300, 359]) {
      for (let animation of animations) animation.currentTime = time;
      for (let shadow of shadows) {
        assert.strictEqual(
          partPose(shadow, 'new').mixBlendMode,
          'plus-lighter',
          'shadow blend stays constant beyond the UA fade duration',
        );
        assert.strictEqual(
          partPose(shadow, 'old').opacity,
          '0',
          'the tile shadow has yielded after the early lighting handoff',
        );
        assert.strictEqual(
          partPose(shadow, 'new').opacity,
          '1',
          'the raised shadow stays fully painted throughout card travel',
        );
      }
    }
    for (let animation of animations) animation.currentTime = 360;
    assert.ok(Math.abs(headerOffset()) < 0.5, 'the header lands in its strip');
    for (let shadow of shadows)
      assert.ok(
        Math.abs(
          painted(partPose(shadow)).width -
            target.getBoundingClientRect().width,
        ) < 1,
        'shadow reaches the exact endpoint',
      );
    assert.ok(
      Math.abs(
        painted(partPose(header)).width - header.getBoundingClientRect().width,
      ) < 1,
      'header match has its final measured width',
    );
    assert.strictEqual(
      Math.round(painted(indexPose()).width),
      Math.round(index.getBoundingClientRect().width),
      'workspace lands at its underneath width',
    );
    assert.ok(
      Math.abs(painted(pose()).width - target.getBoundingClientRect().width) <
        1,
      'lands at the real stack width',
    );
    assert.ok(
      Math.abs(painted(pose()).height - target.getBoundingClientRect().height) <
        1,
      'lands at the real stack height',
    );
    for (let animation of animations) animation.finish();
    await completion;
    await waitUntil(() => !target.style.viewTransitionName);
    assert
      .dom('[data-bitmap-shadow]')
      .doesNotExist('shadow allocation released');
    assert
      .dom('[data-bitmap-shadowed]')
      .doesNotExist('resting shadow restored');
    assert.strictEqual(
      index.style.viewTransitionName,
      '',
      'workspace match released too',
    );
    assert.strictEqual(
      source.style.viewTransitionName,
      '',
      'the persistent preview releases its match',
    );
    assert.dom('[data-test-index]').exists();
    for (let part of [header, title, icon]) {
      assert.strictEqual(
        part.style.viewTransitionName,
        '',
        'temporary header match released',
      );
    }
    assert.notOk(
      index.dataset.bitmapUnderlay,
      'temporary parent selector released',
    );
    assert
      .dom('[data-bitmap-body]')
      .doesNotExist('temporary content frame released');
    // The host releases the return address once the card has closed.
    forgetCardActionOrigin(index, 'https://example.test/gallery');
    await click('[data-test-duplicate]');
    assert.strictEqual(
      embeddedCardElement(
        find('[data-test-index]') as HTMLElement,
        'https://example.test/gallery',
      ),
      undefined,
      'ambiguous previews do not create extra matches',
    );
  });
  test('closing reverses both card boundaries and brings the same parent header forward', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-open-gallery]');
    await completion;
    let source = find('[data-test-opened-gallery]') as HTMLElement;
    await waitUntil(() => !source.style.viewTransitionName);
    let from = source.getBoundingClientRect();
    let parent = find('[data-test-index]') as HTMLElement;
    let parentFrom = parent.getBoundingClientRect();
    assert.false(
      (find('.preview') as HTMLElement).checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
      }),
      'return target retains layout but is hidden behind the top card',
    );
    assert.ok(
      embeddedCardElement(parent, 'https://example.test/gallery'),
      'hidden identity is available without a retained DOM reference',
    );
    await click('[data-test-close-gallery]');
    await bitmapReady;
    let target = find('.preview') as HTMLElement;
    let header = parent.querySelector<HTMLElement>('.stack-item-header')!;
    let title = parent.querySelector<HTMLElement>('.card-type-display-name')!;
    let icon = parent.querySelector<HTMLElement>('.realm-icon')!;
    let body = parent.querySelector<HTMLElement>('.stack-item-content')!;
    assert.true(
      !!target.style.viewTransitionName,
      'the reappearing preview receives the closing card identity',
    );
    assert.true(
      !!parent.style.viewTransitionName,
      'the sibling parent also owns a reverse boundary',
    );
    let animations = document.getAnimations();
    for (let animation of animations.filter(
      (animation) =>
        (animation.effect as KeyframeEffect)?.pseudoElement ===
        `::view-transition-group(${target.style.viewTransitionName})`,
    )) {
      assert.strictEqual(
        animation.effect!.getComputedTiming().duration,
        260,
        'return is bounded at 260ms with no spring tail',
      );
    }
    for (let animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    await new Promise<void>((resolve) => {
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Measure a painted paused compositor pose.
      requestAnimationFrame(() => resolve());
    });
    let width = (element: HTMLElement) => {
      let style = getComputedStyle(
        document.documentElement,
        `::view-transition-group(${element.style.viewTransitionName})`,
      );
      let matrix = new DOMMatrixReadOnly(style.transform);
      return parseFloat(style.width) * Math.hypot(matrix.a, matrix.b);
    };
    assert.ok(
      Math.abs(width(target) - from.width) < 1,
      'reverse starts at the full top card',
    );
    assert.ok(
      Math.abs(width(parent) - parentFrom.width) < 1,
      'parent starts at its buried width',
    );
    for (let animation of animations) animation.currentTime = 130;
    let shadows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-bitmap-shadow]'),
    );
    for (let shadow of shadows) {
      let name = shadow.style.viewTransitionName;
      assert.strictEqual(
        getComputedStyle(
          document.documentElement,
          `::view-transition-old(${name})`,
        ).opacity,
        '1',
        'raised shadow remains visible through the return journey',
      );
      assert.strictEqual(
        getComputedStyle(
          document.documentElement,
          `::view-transition-new(${name})`,
        ).opacity,
        '0',
        'tile shadow waits until the card nears landing',
      );
    }
    let titleFace = getComputedStyle(
      document.documentElement,
      `::view-transition-new(${title.style.viewTransitionName})`,
    );
    let titleScale = new DOMMatrixReadOnly(titleFace.transform);
    let titleReturns = titleScale.a > 14 / 16 && titleScale.a < 1;
    assert.ok(
      titleReturns,
      'return grows title proportionally from its buried size',
    );
    assert.strictEqual(
      titleScale.a,
      titleScale.d,
      'return does not stretch glyphs',
    );
    assert.dom(title).hasStyle({ fontSize: '16px', transform: 'none' });
    let progress =
      (width(target) - from.width) /
      (target.getBoundingClientRect().width - from.width);
    let parentProgress =
      (width(parent) - parentFrom.width) /
      (parent.getBoundingClientRect().width - parentFrom.width);
    let followsReversedCurve = progress > 0.7 && progress < 0.85;
    assert.ok(
      followsReversedCurve,
      'return responds promptly and eases into its landing',
    );
    assert.ok(
      Math.abs(progress - parentProgress) < 0.01,
      'both boundaries reverse on the same clock',
    );
    for (let part of [header, title, icon])
      assert.true(
        !!part.style.viewTransitionName,
        'parent header part remains matched',
      );
    assert.true(
      !!body.style.viewTransitionName,
      'return content has its own match',
    );
    let bodyFace = getComputedStyle(
      document.documentElement,
      `::view-transition-new(${body.style.viewTransitionName})`,
    );
    assert.strictEqual(
      bodyFace.objectFit,
      'contain',
      'return content also scales uniformly',
    );
    assert.ok(Number(bodyFace.opacity) > 0, 'return content fades in');
    assert.ok(
      Number(bodyFace.opacity) < 1,
      'return content is still fading at midpoint',
    );
    for (let animation of animations) animation.currentTime = 245;
    for (let shadow of shadows) {
      let opacity = Number(
        getComputedStyle(
          document.documentElement,
          `::view-transition-old(${shadow.style.viewTransitionName})`,
        ).opacity,
      );
      assert.ok(opacity > 0, 'shadow persists during landing');
      assert.ok(opacity < 1, 'raised shadow eases toward the tile');
      if (shadow.dataset.bitmapShadow === 'contact') {
        let incoming = Number(
          getComputedStyle(
            document.documentElement,
            `::view-transition-new(${shadow.style.viewTransitionName})`,
          ).opacity,
        );
        assert.ok(incoming > 0, 'tile contact shadow returns at landing');
        assert.ok(incoming < 1, 'tile contact shadow does not pop on');
      }
    }
    for (let animation of animations) animation.currentTime = 260;
    for (let part of [target, parent, header, title, icon, body]) {
      assert.ok(
        Math.abs(width(part) - part.getBoundingClientRect().width) < 1,
        'reverse reaches the real destination width',
      );
    }
    for (let animation of animations) animation.finish();
    await completion;
    await waitUntil(() => !target.style.viewTransitionName);
    for (let part of [source, target, parent, header, title, icon, body])
      assert.strictEqual(
        part.style.viewTransitionName,
        '',
        'reverse capture identity released',
      );
    assert.dom('[data-test-opened-gallery]').doesNotExist();
    assert.dom('.preview').isVisible();
    assert.dom(title).hasStyle({ fontSize: '16px', transform: 'none' });
    assert.notOk(parent.dataset.bitmapUnderlay, 'parent marker released');
    assert
      .dom('[data-bitmap-body]')
      .doesNotExist('return content frame released');
  });
  test('search and card faces crossfade as proportionally cropped browser bitmaps', async function (assert) {
    await renderComponent(BitmapFixture);
    await click('[data-test-bitmap-source]');
    let done = false;
    void completion?.then(() => (done = true));
    await waitUntil(
      () => {
        let name = (find('[data-test-bitmap-target]') as HTMLElement | null)
          ?.style.viewTransitionName;
        return (
          done ||
          (!!name &&
            document
              .getAnimations()
              .some((animation) =>
                (animation.effect as KeyframeEffect)?.pseudoElement?.includes(
                  `view-transition-new(${name})`,
                ),
              ))
        );
      },
      { timeout: 3000 },
    );
    let card = find('[data-test-bitmap-target]') as HTMLElement;
    let name = card.style.viewTransitionName;
    assert.true(!!name, 'browser owns a named bitmap handoff');
    let chrome = find('[data-test-bitmap-chrome]') as HTMLElement;
    let edges = ['[data-test-search-dock]', '[data-test-edge-control]'].map(
      (selector) => find(selector) as HTMLElement,
    );
    assert.true(
      document
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect)?.pseudoElement?.includes(name),
        ),
      'browser snapshot playback is active before inspecting or stalling it',
    );
    let root = document.documentElement;
    assert.true(
      !!chrome.style.viewTransitionName,
      'stationary chrome has its own snapshot above the crossing',
    );
    for (let edge of edges) {
      assert.true(
        !!edge.style.viewTransitionName,
        'edge control owns a snapshot plane',
      );
      assert.strictEqual(
        getComputedStyle(
          root,
          `::view-transition-group(${edge.style.viewTransitionName})`,
        ).zIndex,
        '9',
        'edge plane stays above the card and toolbar planes',
      );
    }
    assert.strictEqual(
      getComputedStyle(root).viewTransitionName,
      'none',
      'the full document is excluded from the default root crossfade',
    );
    for (let face of ['old', 'new']) {
      let style = getComputedStyle(root, `::view-transition-${face}(${name})`);
      assert.strictEqual(
        style.objectFit,
        'cover',
        `${face} bitmap preserves aspect ratio`,
      );
    }
    assert.dom(card).hasStyle({ transform: 'none' });
    assert
      .dom(card.querySelector('span'))
      .hasStyle({ fontSize: '16px', transform: 'none' });
    // Even if rendering drops every remaining frame, cleanup uses completion.
    let until = performance.now() + 1000;
    while (performance.now() < until) {
      /* deliberate stall */
    }
    await completion;
    // The browser releases snapshot names on the paint after WAAPI finishes.
    await waitUntil(() => !card.style.viewTransitionName);
    assert.strictEqual(
      chrome.style.viewTransitionName,
      '',
      'stationary chrome identity released',
    );
    for (let edge of edges)
      assert.strictEqual(
        edge.style.viewTransitionName,
        '',
        'edge snapshot released',
      );
    assert.strictEqual(
      card.style.viewTransitionName,
      '',
      'temporary snapshot identity released',
    );
    assert.dom('[data-test-bitmap-source]').doesNotExist();
    assert.dom(card).hasStyle({ transform: 'none', opacity: '1' });
  });
  test('a reversed bitmap handoff commits the latest card and releases both capture identities', async function (assert) {
    await renderComponent(BitmapFixture);
    await click('[data-test-bitmap-source]');
    let opening = completion;
    await waitUntil(() => !!find('[data-test-bitmap-target]'));
    await click('[data-test-bitmap-target]');
    await Promise.all([opening, completion]);
    // Native snapshot cleanup follows the controls' finished promise by a paint.
    await waitUntil(
      () =>
        !(find('[data-test-bitmap-source]') as HTMLElement)?.style
          .viewTransitionName,
    );
    assert.dom('[data-test-bitmap-source]').exists();
    assert.dom('[data-test-bitmap-target]').doesNotExist();
    assert.strictEqual(
      (find('[data-test-bitmap-source]') as HTMLElement).style
        .viewTransitionName,
      '',
      'reversal cannot restore an obsolete snapshot name',
    );
    await waitUntil(
      () =>
        !(find('[data-test-bitmap-chrome]') as HTMLElement).style
          .viewTransitionName,
    );
    assert.strictEqual(
      document.documentElement.style.viewTransitionName,
      '',
      'document capture state restored',
    );
  });
  test('an active modal keeps navigation out of the topmost bitmap layer', async function (assert) {
    await renderComponent(BitmapFixture);
    await click('[data-test-open-modal]');
    await click('[data-test-bitmap-source]');
    await completion;
    assert
      .dom('[data-test-bitmap-target]')
      .hasStyle({ transform: 'none', opacity: '1' });
    assert.strictEqual(
      (find('[data-test-bitmap-target]') as HTMLElement).style
        .viewTransitionName,
      '',
      'modal navigation does not capture the card',
    );
    assert.strictEqual(
      (find('[data-test-bitmap-chrome]') as HTMLElement).style
        .viewTransitionName,
      '',
      'modal navigation does not capture chrome',
    );
  });
  test('zero-duration bitmap navigation applies its destination exactly once', async function (assert) {
    await renderComponent(BitmapFixture);
    let calls = 0;
    await crossfadeCardBitmap({
      from: find('[data-test-bitmap-source]') as HTMLElement,
      to: '.unused-target',
      update: () => {
        calls++;
      },
      duration: 0,
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(
      (find('[data-test-bitmap-source]') as HTMLElement).style
        .viewTransitionName,
      '',
    );
  });
  test('closing releases focus inside the leaving card before capture', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-open-gallery]');
    await completion;
    let closeButton = find('[data-test-close-gallery]') as HTMLElement;
    await waitUntil(() => !closeButton.style.viewTransitionName);
    focusAtUpdate = null;
    await click(closeButton);
    await completion;
    assert.strictEqual(
      focusAtUpdate,
      document.body,
      'the focused Close button is released before the update removes it',
    );
  });
  test('a skipped view transition still mounts the destination and releases the crossing', async function (assert) {
    await renderComponent(EmbeddedFixture);
    await click('[data-test-defer]');
    let transition: ViewTransition | undefined;
    let start = document.startViewTransition;
    document.startViewTransition = function (
      this: Document,
      ...args: Parameters<typeof start>
    ) {
      transition = start.apply(this, args);
      return transition;
    } as typeof start;
    let settledPromptly: boolean;
    try {
      await click('[data-test-open-gallery]');
      await bitmapReady;
      // A viewport resize makes the browser skip the transition and cancel
      // its pseudo-element animations, which never settles motion's finished.
      transition!.skipTransition();
      for (let animation of document.getAnimations()) {
        if (
          (
            animation.effect as KeyframeEffect | null
          )?.pseudoElement?.startsWith('::view-transition')
        ) {
          animation.cancel();
        }
      }
      window.dispatchEvent(new Event('resize'));
      settledPromptly = await Promise.race([
        completion!.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 400),
        ),
      ]);
    } finally {
      document.startViewTransition = start;
    }
    assert.true(
      settledPromptly,
      'the crossing settles once the browser drops it',
    );
    assert
      .dom('[data-test-opened-gallery] h1')
      .exists('deferred destination body mounts');
    assert.strictEqual(
      document.querySelectorAll(
        '[data-bitmap-shadow], [data-bitmap-shadowed], [data-bitmap-body], [data-bitmap-underlay]',
      ).length,
      0,
      'temporary shadow layers and capture markers are released',
    );
    assert.strictEqual(
      document.querySelectorAll('[style*="view-transition-name"]').length,
      0,
      'no participant keeps a transition name',
    );
  });
});
