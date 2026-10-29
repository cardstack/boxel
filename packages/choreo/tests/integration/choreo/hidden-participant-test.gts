/**
 * A participant under `display: none` (the `hidden` attribute, a folded
 * section) has no layout box: it measures as an empty rect at the page
 * origin. Shown again, it arrives where it lives, and is not moved there
 * from that corner.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let stage: Stage | undefined;

class Stage extends Component {
  @tracked hidden = true;
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    stage = this;
  }
  <template>
    <Choreo class='stage' style='position:relative;padding:80px' as |c|>
      <div
        data-row
        hidden={{this.hidden}}
        style='height:40px;background:#0af'
        {{motion id='row' role='row'}}
      ></div>
      <c.Move @of={{c.moved 'row'}} @duration={{1}} @ease='linear' />
      <c.Tween
        @of={{c.inserted 'row'}}
        @opacity={{array 0 1}}
        @duration={{1}}
        @ease='linear'
      />
    </Choreo>
  </template>
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

module('Integration | choreo | hidden participant', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
  });

  test('a participant shown again arrives in place instead of moving from the origin', async function (assert) {
    await render(<template><Stage /></template>);
    stage!.hidden = false;
    await nextFrame();
    await nextFrame();
    let row = document.querySelector('[data-row]') as HTMLElement;
    let transform = getComputedStyle(row).transform;
    assert.true(
      transform === 'none' || transform === '',
      'the row carries no move transform',
    );
    assert.true(
      Number(getComputedStyle(row).opacity) < 1,
      'the row fades in as an arrival',
    );
    await settled();
  });
});
