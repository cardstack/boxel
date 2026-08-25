/**
 * @route and c.Crossing (docs/choreo-constructs.md §4.7): a subtree swap as
 * one pass — leaves fade first, the paired flight carries, arrivals land
 * near the settle, and live content never freezes, because nothing is
 * snapshotted.
 */
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

class Pages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    app = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:300px;height:220px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        <div id="old-only" {{motion id="menu" role="chrome"}}>menu</div>
        <div
          id="tile"
          style="position:absolute;left:10px;top:30px;width:60px;height:40px;background:#0af"
          {{motion id="stage-a" role="stage"}}
        ></div>
      {{else}}
        <div
          id="hero"
          style="position:absolute;left:80px;top:60px;width:180px;height:120px;background:#0af"
          {{motion id="stage-a" role="stage"}}
        ></div>
        <div id="new-only" {{motion id="pager" role="foot"}}>pager</div>
      {{/if}}
      <c.Crossing
        @duration={{0.12}}
        @ease="easeInOut"
        @leave={{0.06}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let app: Pages;
const eq = (a: string, b: string) => a === b;

module('Integration | choreo | crossing', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('the crossing: leaves fade, the flight carries the identity, arrivals land late', async function (assert) {
    await render(<template><Pages /></template>);
    await animationsSettled();
    const before = bounds(find('#tile') as HTMLElement);
    app.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();
    const mid = bounds(find('#hero') as HTMLElement);
    assert.true(
      mid.left < 79 && mid.left >= before.left - 1,
      `the received stage is mid-flight from its old seat (${mid.left})`
    );
    const menu = find('#old-only') as HTMLElement;
    assert.ok(menu, 'the leave is still aloft, fading');
    const arriving = find('#new-only') as HTMLElement;
    assert.true(
      parseFloat(getComputedStyle(arriving).opacity) < 0.5,
      'what only the new scene has waits for the settle'
    );
    await animationsSettled();
    assert.notOk(find('#old-only'), 'leaves are dropped at the end');
    assert.strictEqual(
      parseFloat(getComputedStyle(find('#new-only') as HTMLElement).opacity),
      1,
      'arrivals landed'
    );
    const rest = bounds(find('#hero') as HTMLElement);
    assert.true(
      Math.abs(rest.left - 80) < 1.5,
      `the flight closed on the real seat (${rest.left})`
    );
    await sleep(20);
  });
});
