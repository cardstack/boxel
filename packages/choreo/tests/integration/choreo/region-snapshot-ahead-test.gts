/**
 * The first region a render reaches takes the "before" of every mounted
 * region, ahead of what the render patches on its way to them. A region
 * nested under another still moves what moved, wakes and mounts as it
 * would on its own, and one revealed in the render takes nothing it holds
 * as moved. A region reached ahead of the render does not evaluate its
 * arguments there, so an argument derived from an `{{#each}}` index can change
 * in the render that reads it, and a region the render tears down does not
 * break the render.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { htmlSafe } from '@ember/template';
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
  @tracked pad = 0;
  @tracked idle = false;
  @tracked shown = !this.args.unmounted;
  @tracked shifted = false;
  get left() {
    return this.shifted ? 200 : 0;
  }
  get padStyle() {
    return htmlSafe(`padding-left:${this.pad}px`);
  }
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    nest = this;
  }
  <template>
    <Choreo style='position:relative'>
      <div hidden={{this.hidden}} style={{this.padStyle}}>
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

let listed: Listed | undefined;

/**
 * a region per row, idle unless its row is in the latest turn: the shape of
 * the AI assistant's transcript, where a message's motion wakes by its index.
 * `seen` records every row and index its `@idle` was evaluated with.
 */
class Listed extends Component {
  @tracked rows = ['b'];
  @tracked latestFrom = 0;
  seen: string[] = [];
  isIdle = (row: string, index: number) => {
    this.seen.push(`${row}@${index}`);
    return index < this.latestFrom;
  };
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    listed = this;
  }
  <template>
    <Choreo>
      {{#each this.rows key='@identity' as |row index|}}
        <Choreo @idle={{this.isIdle row index}}>
          <div data-row={{row}} {{motion id=row role='row'}}>{{row}}</div>
        </Choreo>
      {{/each}}
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
    listed = undefined;
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

  test('a region that wakes in a render takes its before at its own hook, after what the render patched above it', async function (assert) {
    await render(<template><Nest /></template>);
    await animationsSettled();
    nest!.idle = true;
    await settled();
    await animationsSettled();

    // a region idle at its last render is not snapshotted ahead: reading
    // whether it wakes would evaluate its arguments ahead of the render. So
    // the ancestor's new padding lands before this region's "before"
    nest!.idle = false;
    nest!.pad = 200;
    await nextFrame();
    await nextFrame();
    assert.true(unmoved(mover()), 'the participant carries no move');
    await settled();
  });

  test('a region awake under another moves what its ancestor patches', async function (assert) {
    await render(<template><Nest /></template>);
    await animationsSettled();
    nest!.pad = 200;
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

  test('a region reached ahead of the render does not evaluate an argument its row index has not caught up with', async function (assert) {
    await render(<template><Listed /></template>);
    await animationsSettled();
    listed!.seen = [];
    // the row already rendered moves from index 0 to 1 in the same render
    // that changes what its index means. Evaluated before the list syncs,
    // its `@idle` would read index 0: in a development build Glimmer
    // rejects the index update that follows that read.
    listed!.rows = ['a', 'b'];
    listed!.latestFrom = 1;
    await settled();
    assert.notOk(
      listed!.seen.includes('b@0'),
      `no argument read the stale index: ${listed!.seen.join(', ')}`,
    );
    assert.ok(
      listed!.seen.includes('b@1'),
      'the moved row reads its new index',
    );
    assert
      .dom('[data-row]')
      .exists({ count: 2 }, 'both rows render after the insertion');
  });
});
