import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { click, find, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { motion } from 'glimmer-motion';
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
});
