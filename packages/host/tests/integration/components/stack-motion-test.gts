import { on } from '@ember/modifier';
import { click, find, findAll, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { motion } from 'glimmer-motion';
import {
  animationsSettled,
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
      let scale = new DOMMatrixReadOnly(getComputedStyle(card).transform).a;
      return scale > 0.1 && scale < 0.9;
    });

    await click('[data-test-expand]');
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

  test('entry and reflow finish after the main thread drops the animation frames', async function (assert) {
    await renderComponent(StackFixture);
    await click('[data-test-toggle]');
    let card = find('[data-test-motion-card]') as HTMLElement;
    await waitUntil(() => {
      let scale = new DOMMatrixReadOnly(getComputedStyle(card).transform).a;
      return scale > 0.1 && scale < 0.9;
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
