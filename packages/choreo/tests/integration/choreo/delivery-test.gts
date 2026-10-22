/**
 * Delivery — @by / @order / @stagger (packages/choreo-gallery/realm/docs/choreo-constructs.md §4.3).
 * The split is a costume: the sprite's own text nodes come back exactly,
 * and the sprite lands on the delivery's end values.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled, whatIsBusy } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

let app: { toggle(): void };
let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

class Fixture extends Component<{ Args: { by: 'character' | 'word' } }> {
  @tracked visible = false;
  constructor(o: unknown, a: { by: 'character' | 'word' }) {
    super(o as never, a);
    app = { toggle: () => (this.visible = !this.visible) };
  }
  <template>
    <Choreo class='stage' style='width:300px;height:100px' as |c|>
      {{grab c}}
      {{#if this.visible}}
        <p id='line' {{motion id='line' role='line'}}>Pour 42 complete</p>
      {{/if}}
      <c.Tween
        @of={{c.inserted 'line'}}
        @by={{@by}}
        @order='reverse'
        @opacity={{1}}
        @duration={{0.12}}
      />
    </Choreo>
  </template>
}

/** the same delivery with a long hold after it, so the run outlives the cue */
class TailFixture extends Component {
  @tracked visible = false;
  constructor(o: unknown, a: object) {
    super(o as never, a);
    app = { toggle: () => (this.visible = !this.visible) };
  }
  <template>
    <Choreo class='stage' style='width:300px;height:100px' as |c|>
      {{grab c}}
      {{#if this.visible}}
        <p id='line' {{motion id='line' role='line'}}>Pour 42 complete</p>
      {{/if}}
      <c.Sequence>
        <c.Tween
          @of={{c.inserted 'line'}}
          @by='character'
          @order='reverse'
          @opacity={{1}}
          @duration={{0.12}}
        />
        <c.Wait @duration={{1}} />
      </c.Sequence>
    </Choreo>
  </template>
}

/** split the line, then hold its slots' platform animations short of their
 *  landing, so the delivery's tail runs behind the run's clock */
async function splitAndHoldTail(): Promise<HTMLElement[]> {
  app.toggle();
  await framesUntil(() => !!find('#line')?.querySelector('span'));
  const spans = Array.from(find('#line')!.querySelectorAll('span'));
  spans.flatMap((span) => span.getAnimations()).forEach((a) => a.pause());
  return spans as HTMLElement[];
}

const runBusy = () =>
  whatIsBusy().some((reason) => /run in flight|pass pending/.test(reason));

/** step frames until `done()` holds, giving up after a bounded number */
async function framesUntil(done: () => boolean) {
  for (let i = 0; i < 600 && !done(); i++) {
    await nextFrame();
  }
}

module('Integration | choreo | delivery', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a character delivery reassembles the text exactly and lands the end value', async function (assert) {
    await render(<template><Fixture @by='character' /></template>);
    await animationsSettled();
    app.toggle();
    await animationsSettled();
    const line = find('#line') as HTMLElement;
    assert.strictEqual(
      line.textContent,
      'Pour 42 complete',
      'the original nodes are back, byte-identical',
    );
    assert.strictEqual(
      line.querySelectorAll('span').length,
      0,
      'no stand-in span survives the run',
    );
    assert.strictEqual(
      parseFloat(getComputedStyle(line).opacity),
      1,
      'the sprite sits at the delivery end value',
    );
  });

  test('the region stays busy until a delivery has given its text back, even after the clock ends', async function (assert) {
    await render(<template><Fixture @by='character' /></template>);
    await animationsSettled();
    const spans = await splitAndHoldTail();
    assert.ok(spans.length > 0, 'the delivery has split the line');
    await framesUntil(() => !runBusy());
    assert.notOk(runBusy(), "the run's clock has ended");
    const line = find('#line') as HTMLElement;
    assert.strictEqual(
      line.querySelectorAll('span').length,
      spans.length,
      'the stand-in spans are still up',
    );
    assert.ok(
      whatIsBusy().some((reason) => reason.includes('delivery in flight')),
      'the region reports the delivery as busy',
    );
    spans.flatMap((span) => span.getAnimations()).forEach((a) => a.play());
    await animationsSettled();
    assert.strictEqual(
      line.querySelectorAll('span').length,
      0,
      'settled only once the spans are gone',
    );
    assert.strictEqual(line.textContent, 'Pour 42 complete');
  });

  test('pausing and resuming a run past a delivery cue lands its tail', async function (assert) {
    await render(<template><TailFixture /></template>);
    await animationsSettled();
    await splitAndHoldTail();
    const run = ctx!.run!;
    await framesUntil(() => run.time > 0.2);
    assert.ok(run.time > 0.12, "the clock is past the delivery's cue");
    assert.notOk(run.isDone(), 'the run is still playing its hold');
    run.pause();
    run.play();
    await animationsSettled();
    const line = find('#line') as HTMLElement;
    assert.strictEqual(
      line.querySelectorAll('span').length,
      0,
      'no stand-in span survives the pause',
    );
    assert.strictEqual(line.textContent, 'Pour 42 complete');
  });

  test("pausing a run whose clock has ended lands a delivery's tail", async function (assert) {
    await render(<template><Fixture @by='character' /></template>);
    await animationsSettled();
    await splitAndHoldTail();
    await framesUntil(() => !runBusy());
    const run = ctx!.run!;
    assert.ok(run.isDone(), "the run's clock has ended");
    run.pause();
    await animationsSettled();
    const line = find('#line') as HTMLElement;
    assert.strictEqual(
      line.querySelectorAll('span').length,
      0,
      'no stand-in span survives the pause',
    );
    assert.strictEqual(line.textContent, 'Pour 42 complete');
  });

  test('a word delivery keeps whitespace and accessibility whole mid-flight', async function (assert) {
    await render(<template><Fixture @by='word' /></template>);
    await animationsSettled();
    app.toggle();
    await settled();
    // mid-flight: the label carries the full text while the copy is chopped
    const line = find('#line') as HTMLElement;
    if (line.querySelector('span')) {
      assert.strictEqual(line.getAttribute('aria-label'), 'Pour 42 complete');
    }
    await animationsSettled();
    assert.strictEqual(find('#line')!.textContent, 'Pour 42 complete');
  });
});
