/**
 * `live()` / `liveAll()` — the selectors a test needs during a crossing.
 *
 * A leaver is kept alive in the region's orphan layer, and that layer is the
 * region's FIRST child: it renders before the live tree. So mid-flight a bare
 * `querySelector('.card')` answers with the ghost — a detached-from-its-owner
 * copy whose listeners were torn down with the component that wrote them — and
 * every click, every assertion and every `bounds()` taken through it is about
 * the wrong element. The failure reads as "the button stopped working", which
 * is the most expensive way to learn where the orphan layer sits.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import {
  live,
  liveAll,
  orphanCount,
  setupChoreo,
} from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

let ctx: ChoreoContext;
const grabCtx = (c: ChoreoContext) => {
  ctx = c;
  return '';
};
const eq = (a: string, b: string) => a === b;

module('Integration | choreo | live selectors', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  class Pages extends Component {
    @tracked page: 'a' | 'b' = 'a';
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
        {{grabCtx c}}
        {{#if (eq this.page "a")}}
          <div
            class="pane"
            data-side="a"
            style="position:absolute;left:10px;top:20px;width:60px;height:40px;background:#0af"
            {{motion id="pane" role="pane"}}
          >A</div>
        {{else}}
          <div
            class="pane"
            data-side="b"
            style="position:absolute;left:150px;top:120px;width:120px;height:80px;background:#0af"
            {{motion id="pane" role="pane"}}
          >B</div>
        {{/if}}
        <c.Crossing @duration={{0.6}} />
      </Choreo>
    </template>
  }
  let app: Pages | undefined;

  test('live() skips the orphan copy a crossing left in the layer', async function (assert) {
    await render(<template><Pages /></template>);
    await animationsSettled();

    app!.page = 'b';
    await settled();
    await nextFrame();
    // hold the flight where both halves exist at once
    ctx.run!.pause();
    await nextFrame();

    assert.strictEqual(orphanCount(), 1, 'the leaver is parked in the layer');
    assert.strictEqual(
      document.querySelectorAll('.pane').length,
      2,
      'two elements answer the selector mid-flight'
    );
    const bare = document.querySelector('.pane') as HTMLElement;
    assert.ok(
      bare.closest('[data-choreo-orphans]'),
      'and a bare querySelector answers with the GHOST — the layer is first'
    );

    const el = live('.pane');
    assert.ok(el, 'live() found something');
    assert.notStrictEqual(el, bare, 'and it is not the ghost');
    assert.notOk(el!.closest('[data-choreo-orphans]'), 'not in the layer');
    assert.strictEqual(el!.getAttribute('data-side'), 'b', 'the arriving pane');
    assert.strictEqual(liveAll('.pane').length, 1, 'liveAll counts one');

    ctx.run!.play();
    await animationsSettled();
    assert.strictEqual(orphanCount(), 0, 'the leaver was dropped');
    assert.strictEqual(live('.pane'), document.querySelector('.pane'));
  });

  test('liveAll() returns every live match, in document order', async function (assert) {
    await render(
      <template>
        <div>
          <span class="tag" data-n="1"></span>
          <span class="tag" data-n="2"></span>
        </div>
      </template>
    );
    assert.deepEqual(
      liveAll('.tag').map((el) => el.getAttribute('data-n')),
      ['1', '2'],
      'plain DOM is untouched by the orphan rule'
    );
    assert.strictEqual(live('.nothing-here'), null, 'and a miss is null');
  });
});
