import { on } from '@ember/modifier';
import { click, find, triggerKeyEvent } from '@ember/test-helpers';
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

import DockCardMotion from '@cardstack/host/components/operator-mode/dock-card-motion';
import StackMotion from '@cardstack/host/components/operator-mode/stack-motion';
import {
  searchCardOrigin,
  type CardOpenOrigin,
} from '@cardstack/host/lib/card-open-origin';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class DockFixture extends Component {
  @tracked dockOpen = true;
  @tracked wide = false;
  @tracked duration = 0.6;
  @tracked items: { id: string; origin: CardOpenOrigin }[] = [];
  private selected?: ReturnType<typeof searchCardOrigin>;
  private sequence = 0;
  capture = (event: Event) => {
    this.selected = searchCardOrigin(event);
  };
  open = () => {
    if (!this.selected) return;
    this.items = [
      { id: `dock-${++this.sequence}`, origin: this.selected.origin },
    ];
    this.dockOpen = false;
    this.selected = undefined;
  };
  keydown = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key === 'Enter') this.open();
  };
  reopen = () => (this.dockOpen = true);
  resize = () => (this.wide = !this.wide);
  instant = () => (this.duration = 0);

  <template>
    <button
      type='button'
      {{on 'click' this.reopen}}
      data-test-reopen
    >Search</button>
    <button
      type='button'
      {{on 'click' this.resize}}
      data-test-resize
    >Resize</button>
    <button
      type='button'
      {{on 'click' this.instant}}
      data-test-instant
    >Skip</button>
    <StackMotion
      @duration={{this.duration}}
      class='scene {{if this.wide "wide"}}'
      data-test-scene
    >
      {{#if this.dockOpen}}
        {{! Capture selection geometry before the child button handles it. }}
        {{! template-lint-disable no-invalid-interactive }}
        <section
          class='dock'
          {{on 'click' this.capture capture=true}}
          {{on 'keydown' this.capture capture=true}}
        >
          <button
            class='tile first'
            type='button'
            data-search-card-id='card-a'
            data-test-tile='a'
            {{on 'click' this.open}}
            {{on 'keydown' this.keydown}}
          >Card A</button>
          <button
            class='tile second'
            type='button'
            data-search-card-id='card-b'
            data-test-tile='b'
            {{on 'click' this.open}}
            {{on 'keydown' this.keydown}}
          >Card B</button>
        </section>
        {{! template-lint-enable no-invalid-interactive }}
      {{/if}}
      {{#each this.items key='id' as |item|}}
        <DockCardMotion
          @id={{item.id}}
          @origin={{item.origin}}
          @duration={{this.duration}}
        />
        <div
          class='card'
          {{motion id=item.id role='dock-card'}}
          data-test-open-card={{item.id}}
        >
          <div class='card-body' data-test-card-body>Full card content</div>
        </div>
      {{/each}}
    </StackMotion>
    <style scoped>
      .scene {
        position: relative;
        width: 50rem;
        height: 38rem;
      }
      .dock {
        position: absolute;
        inset: 0;
      }
      .tile {
        position: absolute;
        width: 12rem;
        height: 7rem;
        border-radius: 0.25rem;
      }
      .first {
        left: 2rem;
        top: 28rem;
      }
      .second {
        left: 35rem;
        top: 24rem;
      }
      .card {
        position: absolute;
        left: 10rem;
        top: 2rem;
        width: 30rem;
        height: 24rem;
        border-radius: calc(0.25rem + 0.75rem * var(--dock-open-progress, 1));
        background: white;
      }
      .wide .card {
        width: 40rem;
        height: 30rem;
        left: 5rem;
      }
      .card-body {
        opacity: var(--dock-content-opacity, 1);
      }
    </style>
  </template>
}

function card() {
  return (
    find('[data-choreo-raised] [data-test-open-card]') ??
    find('[data-test-open-card]')!
  );
}
function frame() {
  return new Promise<void>((resolve) => {
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Sample painted animation geometry; completion is awaited separately.
    requestAnimationFrame(() => resolve());
  });
}
function rectMatches(
  assert: Assert,
  actual: DOMRect,
  expected: DOMRect,
  label: string,
) {
  for (let key of ['x', 'y', 'width', 'height'] as const) {
    assert.true(
      Math.abs(actual[key] - expected[key]) < 1,
      `${label}: ${key} is ${expected[key]} (was ${actual[key]})`,
    );
  }
}

module('Integration | dock motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('unsupported bitmap crossing reveals a full-size card with a short unscaled lift', async function (assert) {
    await renderComponent(DockFixture);
    await animationsSettled();
    await click('[data-test-tile="a"]');
    let samples: DOMRect[] = [];
    let unscaled = true;
    let layer = true;
    while (!isMotionIdle()) {
      let el = card();
      samples.push(el.getBoundingClientRect());
      let transform = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      unscaled &&=
        Math.abs(transform.a - 1) < 0.001 && Math.abs(transform.d - 1) < 0.001;
      if (el.parentElement?.hasAttribute('data-choreo-raised'))
        layer &&= getComputedStyle(el.parentElement).zIndex === '150';
      await frame();
    }
    await animationsSettled();
    let destination = card().getBoundingClientRect();
    assert.true(samples.length > 2, 'sampled the transition');
    assert.true(
      samples[0]!.y >= destination.y,
      'enters from just below its destination',
    );
    assert.true(
      samples.every(
        (sample) =>
          Math.abs(sample.width - destination.width) < 1 &&
          Math.abs(sample.height - destination.height) < 1 &&
          Math.abs(sample.x - destination.x) < 1 &&
          sample.y >= destination.y - 1 &&
          sample.y <= destination.y + 25,
      ),
      'no live card resize or long travel in the fallback',
    );
    assert.true(unscaled, 'text is not stretched');
    assert.true(layer, 'the flight uses layer 150');
    assert.dom('[data-test-card-body]').hasStyle({ opacity: '1' });
    assert.dom('[data-choreo-raised] [data-test-open-card]').doesNotExist();
    await click('[data-test-instant]');
    await click('[data-test-reopen]');
    await click('[data-test-tile="a"]');
    await animationsSettled();
    rectMatches(
      assert,
      card().getBoundingClientRect(),
      destination,
      'same destination with motion disabled',
    );
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });

  test('a keyboard selection replaces an in-flight card and finishes after a resize and stalled frames', async function (assert) {
    await renderComponent(DockFixture);
    await animationsSettled();
    await click('[data-test-tile="a"]');
    await click('[data-test-reopen]');
    await triggerKeyEvent('[data-test-tile="b"]', 'keydown', 'Enter');
    assert
      .dom('[data-test-open-card="dock-2"]')
      .exists('latest keyboard selection owns the destination');
    let until = performance.now() + 700;
    while (performance.now() < until) {
      /* Longer than the entire tween. */
    }
    await click('[data-test-resize]');
    await animationsSettled();
    let destination = card().getBoundingClientRect();
    assert.dom('[data-test-open-card]').exists({ count: 1 });
    assert.dom('[data-test-card-body]').hasStyle({ opacity: '1' });
    await click('[data-test-instant]');
    await click('[data-test-reopen]');
    await click('[data-test-tile="b"]');
    await animationsSettled();
    rectMatches(
      assert,
      card().getBoundingClientRect(),
      destination,
      'latest resized destination',
    );
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });
});
