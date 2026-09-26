import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { click, find, settled, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Choreo, motion } from 'glimmer-motion';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import StackMotion from '@cardstack/host/components/operator-mode/stack-motion';
import type HostMotionService from '@cardstack/host/services/host-motion';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class BudgetFixture extends Component {
  @service declare hostMotion: HostMotionService;
  @tracked open = false;
  @tracked text = 'Card';
  openCard = () => {
    this.hostMotion.begin('stack', 'selected');
    this.open = true;
  };
  update = () => (this.text = 'Updated');
  drag = () => this.hostMotion.beginDrag();
  <template>
    <StackMotion
      @budgeted={{true}}
      @duration={{0.8}}
      @instant={{this.hostMotion.bitmapActive}}
    >
      <button
        type='button'
        {{on 'click' this.openCard}}
        data-test-open
      >Open</button>
      <button
        type='button'
        {{on 'click' this.update}}
        data-test-update
      >Update</button>
      <button
        type='button'
        {{on 'click' this.drag}}
        data-test-drag
      >Drag</button>
      {{#if this.open}}
        <div
          {{motion id='selected' role='opening-card'}}
          data-test-card
        >{{this.text}}</div>
      {{/if}}
    </StackMotion>
  </template>
}

class GateState {
  @tracked armed = false;
  @tracked text = 'Card';
}
let gate = new GateState();
class GateFixture extends Component {
  state = gate;
  <template>
    <Choreo @armed={{this.state.armed}} as |c|>
      <div
        {{motion id='gated' role='stack-card'}}
        data-test-gated
      >{{this.state.text}}</div>
      {{#if this.state.armed}}
        <c.Tween @of={{c.kept 'stack-card'}} @opacity={{1}} @duration={{0}} />
      {{/if}}
    </Choreo>
  </template>
}

module('Integration | budget motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('bitmap capture omits the ordinary score instead of compiling zero-duration tracks', async function (assert) {
    await renderComponent(BudgetFixture);
    let budget = this.owner.lookup('service:host-motion') as HostMotionService;
    let token = budget.beginBitmap();
    await click('[data-test-open]');
    await animationsSettled();
    assert.false(budget.isArmed('stack'));
    assert
      .dom('[data-test-card]')
      .hasStyle({ opacity: '1', transform: 'none' });
    assert.strictEqual(
      document
        .getAnimations()
        .filter(
          (animation) =>
            (animation.effect as KeyframeEffect | null)?.target ===
            find('[data-test-card]'),
        ).length,
      0,
      'destination takes its CSS endpoint without secondary native tracks',
    );
    budget.endBitmap(token);
    await click('[data-test-update]');
    assert
      .dom('[data-test-card]')
      .hasStyle({ opacity: '1', transform: 'none' });
  });

  test('only the explicit action arms motion; completion removes its allocation', async function (assert) {
    await renderComponent(BudgetFixture);
    let budget = this.owner.lookup('service:host-motion') as HostMotionService;
    assert.false(budget.isArmed('stack'), 'idle host has no score');
    await click('[data-test-open]');
    await waitUntil(
      () => Number(getComputedStyle(find('[data-test-card]')!).opacity) < 1,
    );
    assert.true(
      budget.isArmed('stack'),
      'the selected navigation owns the score',
    );
    await animationsSettled();
    await waitUntil(() => !budget.isArmed('stack'));
    assert.strictEqual(budget.primaryId, undefined, 'primary match removed');
    await click('[data-test-update]');
    assert.false(
      budget.isArmed('stack'),
      'ordinary data update cannot replay navigation',
    );
    assert
      .dom('[data-test-card]')
      .hasStyle({ opacity: '1', transform: 'none' });
  });

  test('direct manipulation retires secondary playback at its exact endpoint', async function (assert) {
    await renderComponent(BudgetFixture);
    let budget = this.owner.lookup('service:host-motion') as HostMotionService;
    await click('[data-test-open]');
    await waitUntil(
      () => Number(getComputedStyle(find('[data-test-card]')!).opacity) < 1,
    );
    await click('[data-test-drag]');
    await animationsSettled();
    assert.false(budget.isArmed('stack'));
    assert
      .dom('[data-test-card]')
      .hasStyle({ opacity: '1', transform: 'none' });
    budget.begin('sheet');
    assert.false(
      budget.isArmed('sheet'),
      'drag does not admit a competing score',
    );
    budget.endDrag();
  });
  test('an idle region measures nothing when unrelated content re-renders', async function (assert) {
    gate = new GateState();
    await renderComponent(GateFixture);
    await animationsSettled();
    let reads = 0;
    let original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (
      this: Element,
      ...args: []
    ) {
      reads++;
      return original.apply(this, args);
    };
    try {
      gate.text = 'Updated while idle';
      await settled();
      assert.strictEqual(reads, 0, 'an unarmed render reads no layout');
      gate.armed = true;
      await settled();
      await animationsSettled();
      reads = 0;
      gate.text = 'Updated while armed';
      await settled();
      assert.true(reads > 0, 'an armed render still measures its pass');
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
    assert.dom('[data-test-gated]').hasText('Updated while armed');
  });
});
