/**
 * SETTLE runs after a pass's mounts and before any region measures.
 *
 * A scroll owner holds its anchor there: content grows above a box, the
 * owner scrolls by exactly that much, and the box keeps its place on screen.
 * Measured after the settle, the box has not moved, so it gets no motion.
 * Without the settle, the same change moves it, and the region animates it.
 */
import { Choreo, registerSettle } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let stage: Stage | undefined;
const seize = (s: Stage) => {
  stage = s;
};

class Stage extends Component<{ Args: { seize: (self: Stage) => void } }> {
  @tracked above = 0;
  // renders outside every participant: a pass that changes nothing else
  @tracked noise = 0;
  constructor(owner: unknown, args: { seize: (self: Stage) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
  <template>
    <div
      data-scroller
      style='height:120px;overflow-y:auto;overflow-anchor:none'
    >
      <Choreo class='stage' style='position:relative' as |c|>
        <div style={{this.aboveStyle}}></div>
        <div
          data-box
          style='height:40px;background:#0af'
          {{motion id='box'}}
        ></div>
        <div style='height:400px'>{{this.noise}}</div>
        <c.Move @of={{c.all}} @duration={{0.4}} @ease='linear' />
      </Choreo>
    </div>
  </template>
}

/** a move FLIPs: the box carries a transform while it travels */
function moving(): boolean {
  let transform = getComputedStyle(box()).transform;
  return transform !== 'none' && transform !== '';
}
function box(): HTMLElement {
  return document.querySelector('[data-box]') as HTMLElement;
}
function scroller(): HTMLElement {
  return document.querySelector('[data-scroller]') as HTMLElement;
}

module('Integration | choreo | settle', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  let unregister: (() => void) | undefined;
  hooks.afterEach(() => {
    unregister?.();
    unregister = undefined;
    stage = undefined;
  });

  test('a settle that holds the box in place leaves it nothing to animate', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    let before = box().getBoundingClientRect().top;
    let ran = 0;
    unregister = registerSettle(() => {
      ran++;
      // the scroll owner's job: pay for what grew above with a scroll
      scroller().scrollTop = stage!.above;
    });
    stage!.above = 100;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    assert.ok(ran > 0, 'the settle ran in the pass');
    assert.strictEqual(
      Math.round(box().getBoundingClientRect().top),
      Math.round(before),
      'the box holds its place on screen',
    );
    assert.false(
      moving(),
      'measured after the settle, it did not move, so nothing animates it',
    );
    await settled();
  });

  test('a scroll settled into a pass while a run flies is carried, not dropped', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    stage!.above = 100;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    assert.true(moving(), 'the box is in flight');
    let before = box().getBoundingClientRect().top;
    // a pass whose only change is the scroll a follow settles into it: the
    // participants' offsets in the region stay as they were
    unregister = registerSettle(() => {
      scroller().scrollTop = 40;
    });
    stage!.noise++;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let after = box().getBoundingClientRect().top;
    assert.true(
      Math.abs(after - before) < 15,
      `the box carries on from where it was painted (moved ${(after - before).toFixed(1)}px in a frame, the scroll was 40)`,
    );
    await settled();
  });

  test('without a settle, the same change moves the box and the region animates it', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    stage!.above = 100;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    assert.true(moving(), 'the region animates the box from where it was');
    await settled();
  });
});
