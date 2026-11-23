/**
 * The first region a render reaches takes the "before" of every mounted
 * region, ahead of what the render patches on its way to them. A region
 * nested under another still moves what moved, wakes and mounts as it
 * would on its own, and one revealed in the render takes nothing it holds
 * as moved. Reaching a region ahead of the render evaluates its arguments
 * early, so a region the render tears down must not break the render.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

let nest: Nest | undefined;

/** an inner region inside an outer one, as a card's region inside the stack's */
class Nest extends Component<{ Args: { unmounted?: boolean } }> {
  @tracked hidden = false;
  @tracked idle = false;
  @tracked shown = !this.args.unmounted;
  @tracked shifted = false;
  get left() {
    return this.shifted ? 200 : 0;
  }
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    nest = this;
  }
  <template>
    <Choreo style='position:relative'>
      <div hidden={{this.hidden}}>
        {{#if this.shown}}
          <Choreo @idle={{this.idle}} style='position:relative' as |c|>
            <div
              data-mover
              style='margin-left:{{this.left}}px;width:40px;height:20px'
              {{motion id='mover' role='mover'}}
            ></div>
            <c.Move @of={{c.moved 'mover'}} @duration={{1}} @ease='linear' />
          </Choreo>
        {{/if}}
      </div>
    </Choreo>
  </template>
}

let doomed: Doomed | undefined;

/** an inner region whose argument stops evaluating once its block is gone */
class Doomed extends Component {
  @tracked card: { paused: boolean } | null = { paused: false };
  get paused() {
    return this.card!.paused;
  }
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    doomed = this;
  }
  <template>
    <Choreo>
      {{#if this.card}}
        <Choreo @idle={{this.paused}} as |c|>
          <div data-doomed {{motion id='doomed' role='doomed'}}></div>
          <c.Move @of={{c.moved 'doomed'}} @duration={{1}} />
        </Choreo>
      {{/if}}
    </Choreo>
  </template>
}

const mover = () => document.querySelector('[data-mover]') as HTMLElement;
const unmoved = (el: HTMLElement) => {
  const transform = getComputedStyle(el).transform;
  return transform === 'none' || transform === '';
};
/** where the mover is painted, from its region's left edge */
const painted = () =>
  mover().getBoundingClientRect().left -
  mover().parentElement!.getBoundingClientRect().left;

module('Integration | choreo | region snapshot ahead', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    nest = undefined;
    doomed = undefined;
  });

  test('a region under another moves what moved', async function (assert) {
    await render(<template><Nest /></template>);
    await animationsSettled();
    nest!.shifted = true;
    await nextFrame();
    await nextFrame();
    assert.false(unmoved(mover()), 'the participant carries a move');
    assert.true(painted() < 200, `it is on its way: ${painted()}`);
    await settled();
  });

  test('a region mounted under another moves what moves in a later render', async function (assert) {
    await render(<template><Nest @unmounted={{true}} /></template>);
    await animationsSettled();
    nest!.shown = true;
    await settled();
    await animationsSettled();
    assert.true(unmoved(mover()), 'it arrives without a move');

    nest!.shifted = true;
    await nextFrame();
    await nextFrame();
    assert.false(unmoved(mover()), 'a later change moves it');
    await settled();
  });

  test('a region that wakes under another moves what the waking render changes', async function (assert) {
    await render(<template><Nest /></template>);
    await animationsSettled();
    nest!.idle = true;
    await settled();
    await animationsSettled();

    nest!.idle = false;
    nest!.shifted = true;
    await nextFrame();
    await nextFrame();
    assert.false(unmoved(mover()), 'the participant carries a move');
    await settled();
  });

  test('a region revealed in a render takes nothing it holds as moved, even what that render moves', async function (assert) {
    await render(<template><Nest /></template>);
    await animationsSettled();
    nest!.hidden = true;
    await settled();
    await nextFrame();

    nest!.hidden = false;
    nest!.shifted = true;
    await nextFrame();
    await nextFrame();
    assert.true(unmoved(mover()), 'the participant carries no move');
    assert.strictEqual(painted(), 200, 'it stands where it now lives');
    await settled();
  });

  test('a region torn down in a render whose arguments no longer evaluate does not break the render', async function (assert) {
    await render(<template><Doomed /></template>);
    await animationsSettled();
    doomed!.card = null;
    await settled();
    assert.dom('[data-doomed]').doesNotExist('the inner region is gone');
  });
});
