import { on } from '@ember/modifier';
import { click, find, findAll, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { motion } from 'glimmer-motion';
import {
  animationsSettled,
  isMotionIdle,
  orphanCount,
  setupMotion,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import StackMotion from '@cardstack/host/components/operator-mode/stack-motion';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class StackFixture extends Component {
  @tracked open = false;
  @tracked expanded = false;
  toggle = () => (this.open = !this.open);
  expand = () => (this.expanded = !this.expanded);

  get cardStyle() {
    return { width: this.expanded ? '24rem' : '12rem', height: '8rem' };
  }

  <template>
    <button
      type='button'
      {{on 'click' this.toggle}}
      data-test-toggle
    >Toggle</button>
    <button
      type='button'
      {{on 'click' this.expand}}
      data-test-expand
    >Expand</button>
    <StackMotion @duration={{0.2}} data-test-motion-region>
      {{#if this.open}}
        <div data-test-stack>
          <div
            {{motion id='card' role='opening-card' style=this.cardStyle}}
            data-test-motion-card
          >Card content</div>
        </div>
      {{/if}}
    </StackMotion>
  </template>
}

class MultiCardFixture extends Component {
  @tracked count = 0;
  @tracked expanded = false;
  push = () => this.count++;
  pop = () => this.count--;
  expand = () => (this.expanded = !this.expanded);

  get cards() {
    return Array.from({ length: this.count }, (_, index) => {
      let depth = this.count - index - 1;
      let top = depth === 0;
      // Resting stack geometry from main: 30px for a two-card stack,
      // then 0/25/50px, with buried cards shrinking by a factor of 1.2.
      let marginTop = top
        ? this.count === 2
          ? 30
          : 50
        : depth === 1 && this.count > 2
          ? 25
          : 0;
      if (this.count === 1 || (top && this.expanded)) marginTop = 0;
      return {
        id: `card-${index}`,
        role: top ? 'opening-card' : 'stack-card',
        covered: !top && this.expanded,
        style: {
          position: 'absolute',
          zIndex: index + 1,
          marginTop,
          height: `calc(100% - ${marginTop}px)`,
          width: top && this.expanded ? '100%' : `${50 / 1.2 ** depth}rem`,
          maxWidth: `${100 - depth * 10}%`,
        },
      };
    });
  }

  <template>
    <button type='button' {{on 'click' this.push}} data-test-push>Push</button>
    <button type='button' {{on 'click' this.pop}} data-test-pop>Pop</button>
    <button
      type='button'
      {{on 'click' this.expand}}
      data-test-expand
    >Expand</button>
    <StackMotion @duration={{0.2}}>
      <div class='multi-card-stage'>
        {{#each this.cards key='id' as |card|}}
          <div
            data-test-motion-card={{card.id}}
            data-stack-covered={{card.covered}}
            {{motion id=card.id role=card.role style=card.style}}
          >Card content</div>
        {{/each}}
      </div>
    </StackMotion>
    <style scoped>
      .multi-card-stage {
        position: relative;
        width: 60rem;
        height: 40rem;
        display: grid;
      }
      .multi-card-stage > div {
        justify-self: center;
      }
    </style>
  </template>
}

module('Integration | stack motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('closing the last card retains its exit after the stack is removed', async function (assert) {
    await renderComponent(StackFixture);
    await click('[data-test-toggle]');
    await animationsSettled();
    assert.dom('[data-test-motion-card]').hasStyle({ opacity: '1' });

    await click('[data-test-toggle]');
    assert.dom('[data-test-stack]').doesNotExist();
    assert.strictEqual(
      orphanCount(),
      1,
      'the departing card is still animated',
    );
    await animationsSettled();
    assert.dom('[data-test-motion-card]').doesNotExist();
    assert.strictEqual(orphanCount(), 0, 'the exit is released');
  });

  test('reopening during an exit preserves one card and finishes at its new size', async function (assert) {
    await renderComponent(StackFixture);
    await click('[data-test-toggle]');
    await animationsSettled();
    await click('[data-test-toggle]');
    await waitUntil(() => orphanCount() === 1);
    await click('[data-test-toggle]');
    await click('[data-test-expand]');
    let card = find('[data-test-motion-card]') as HTMLElement;
    let deadline = performance.now() + 1500;
    let proportions: number[][] = [];
    while (!isMotionIdle() && performance.now() < deadline) {
      let matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
      proportions.push([matrix.a, matrix.d]);
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Sample painted glyph proportions.
        requestAnimationFrame(() => resolve());
      });
    }
    assert.true(proportions.length > 0, 'sampled live reflow');
    assert.true(
      proportions.every(([x, y]) => x === 1 && y === 1),
      'live card and header text never stretch during resizing',
    );
    await animationsSettled();

    assert.dom('[data-test-motion-card]').exists({ count: 1 });
    assert.dom('[data-test-motion-card]').hasStyle({ opacity: '1' });
    assert.strictEqual(
      (find('[data-test-motion-card]') as HTMLElement).offsetWidth,
      24 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      'the interrupted card lands at the expanded width',
    );
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), [], 'no stale transforms survive');
  });

  test('a layout change during entry finishes at full size and opacity', async function (assert) {
    await renderComponent(StackFixture);
    await click('[data-test-toggle]');
    let card = find('[data-test-motion-card]') as HTMLElement;
    await waitUntil(() => {
      let opacity = Number(getComputedStyle(card).opacity);
      return opacity > 0 && opacity < 0.9;
    });

    let beforeY = new DOMMatrixReadOnly(getComputedStyle(card).transform).m42;
    await click('[data-test-expand]');
    let afterY = new DOMMatrixReadOnly(getComputedStyle(card).transform).m42;
    assert.true(afterY > 0, 'a replacement pass does not snap to rest');
    assert.true(afterY <= beforeY + 1, 'the entrance continues forward');
    await animationsSettled();

    let transform = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    assert.strictEqual(transform.a, 1, 'the card finishes at full width');
    assert.strictEqual(transform.d, 1, 'the card finishes at full height');
    assert.dom(card).hasStyle({ opacity: '1' });
  });

  test('interrupted stacking, expansion, and closing reach every resting pose', async function (assert) {
    await renderComponent(MultiCardFixture);
    let assertRest = (label: string) => {
      for (let card of findAll('[data-test-motion-card]')) {
        let matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
        assert.true(
          matrix.isIdentity,
          `${label}: ${card.getAttribute('data-test-motion-card')} has no residual transform`,
        );
        assert.dom(card).hasStyle({
          opacity: card.hasAttribute('data-stack-covered') ? '0' : '1',
        });
      }
      assert.strictEqual(orphanCount(), 0, `${label}: departures released`);
    };

    await click('[data-test-push]');
    await click('[data-test-push]');
    await click('[data-test-push]');
    await animationsSettled();
    assertRest('three cards');

    await click('[data-test-expand]');
    await animationsSettled();
    assertRest('expanded');

    await click('[data-test-expand]');
    await click('[data-test-pop]');
    await animationsSettled();
    assertRest('collapse and pop');

    await click('[data-test-pop]');
    await animationsSettled();
    assertRest('one card');

    await click('[data-test-pop]');
    await animationsSettled();
    assert.dom('[data-test-motion-card]').doesNotExist();
    assertRest('empty stack');
  });

  test('opening a stack keeps the parent centered and the incoming card above it at natural size', async function (assert) {
    await renderComponent(MultiCardFixture);
    await click('[data-test-push]');
    await animationsSettled();
    let parent = find('[data-test-motion-card="card-0"]')!;
    let initial = parent.getBoundingClientRect();
    let center = initial.x + initial.width / 2;
    await click('[data-test-push]');
    let incoming = find('[data-test-motion-card="card-1"]')!;
    await waitUntil(() =>
      incoming
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .some((frame) => frame.transform),
        ),
    );
    assert.true(
      incoming
        .getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .some((frame) => frame.transform),
        ),
      'the browser owns the incoming transform track',
    );
    let samples: {
      center: number;
      parentWidth: number;
      incomingWidth: number;
      y: number;
      scaleX: number;
      scaleY: number;
    }[] = [];
    while (!isMotionIdle()) {
      let a = parent.getBoundingClientRect();
      let b = incoming.getBoundingClientRect();
      let transform = new DOMMatrixReadOnly(
        getComputedStyle(incoming).transform,
      );
      samples.push({
        center: a.x + a.width / 2,
        parentWidth: a.width,
        incomingWidth: b.width,
        y: b.y,
        scaleX: transform.a,
        scaleY: transform.d,
      });
      await new Promise<void>((resolve) => {
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Verify every painted stack pose, not application state.
        requestAnimationFrame(() => resolve());
      });
    }
    await animationsSettled();
    let finalParent = parent.getBoundingClientRect();
    let finalIncoming = incoming.getBoundingClientRect();
    assert.true(samples.length > 2, 'sampled the entrance');
    assert.true(
      samples.every((s) => Math.abs(s.center - center) < 1),
      'parent never slides sideways as its width changes',
    );
    assert.true(
      samples.every(
        (s) =>
          Math.abs(s.parentWidth - finalParent.width) < 1 &&
          Math.abs(s.incomingWidth - finalIncoming.width) < 1,
      ),
      'content dimensions resolve once without width playback',
    );
    assert.true(
      samples.every((s) => s.scaleX === 1 && s.scaleY === 1),
      'incoming typography keeps its proportions',
    );
    assert.true(
      samples.every(
        (s) => s.y >= finalIncoming.y - 1 && s.y <= finalIncoming.y + 25,
      ),
      'entrance is a bounded 24px lift',
    );
    assert.true(
      Number(getComputedStyle(incoming).zIndex) >
        Number(getComputedStyle(parent).zIndex),
      'the incoming card owns the front plane',
    );
    assert.dom(incoming).hasStyle({ opacity: '1', transform: 'none' });
    assert.deepEqual(strandedTransforms(), []);
  });

  test('entry and reflow finish after the main thread drops the animation frames', async function (assert) {
    await renderComponent(StackFixture);
    await click('[data-test-toggle]');
    let card = find('[data-test-motion-card]') as HTMLElement;
    await waitUntil(() => {
      let opacity = Number(getComputedStyle(card).opacity);
      return opacity > 0 && opacity < 0.9;
    });

    // Block rendering longer than the 200ms tween, as heavy card rendering can.
    let blockedUntil = performance.now() + 300;
    while (performance.now() < blockedUntil) {
      // Deliberately drop every remaining animation frame.
    }
    await click('[data-test-expand]');
    await animationsSettled();

    assert.true(
      new DOMMatrixReadOnly(getComputedStyle(card).transform).isIdentity,
      'missed frames never leave the card between its start and final pose',
    );
    assert.dom(card).hasStyle({ opacity: '1' });
    assert.strictEqual(
      card.offsetWidth,
      24 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      'the resize also reaches its final width',
    );
    assert.deepEqual(strandedTransforms(), []);
  });
});
