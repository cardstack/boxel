/**
 * @route and c.Crossing (docs/choreo-constructs.md §4.7): a subtree swap as
 * one pass — leaves fade first, the paired flight carries, arrivals land
 * near the settle, and live content never freezes, because nothing is
 * snapshotted.
 */
import { array } from '@ember/helper';
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

class ColorPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    colors = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:300px;height:220px;background:rgb(16,32,48)"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        <div
          id="tileC"
          style="position:absolute;left:10px;top:30px;width:60px;height:40px;background:rgba(40,80,160,0.5)"
          {{motion id="stage-e" role="stage"}}
        ></div>
      {{else}}
        <div
          id="heroC"
          style="position:absolute;left:190px;top:110px;width:90px;height:70px;background:rgba(200,60,40,0.5)"
          {{motion id="stage-e" role="stage"}}
        ></div>
      {{/if}}
      <c.Crossing
        @duration={{0.14}}
        @ease="easeInOut"
        @leave={{0.05}}
        @arrive={{0.05}}
      />
    </Choreo>
  </template>
}
let colors: ColorPages;

class ExitPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    exits = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:300px;height:220px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        <div
          id="menu4"
          style="position:absolute;left:10px;top:5px;width:80px;height:20px"
          {{motion role="chrome"}}
        >menu</div>
        <div
          id="tile4"
          style="position:absolute;left:10px;top:30px;width:60px;height:40px;background:#0af"
          {{motion id="stage-d" role="stage"}}
        ></div>
      {{else}}
        <div
          id="hero4"
          style="position:absolute;left:190px;top:110px;width:90px;height:70px;background:#0af"
          {{motion id="stage-d" role="stage"}}
        ></div>
      {{/if}}
      <c.Parallel>
        <c.Crossing
          @duration={{0.12}}
          @ease="easeInOut"
          @leave={{0.05}}
          @arrive={{0.05}}
        />
        {{! the special exit: the menu RISES out instead of dissolving —
            and because a specific step names it, the crossing's generic
            leave must yield it entirely }}
        <c.Tween
          @of={{c.role "chrome"}}
          @y={{array 0 -40}}
          @duration={{0.12}}
          @ease="easeInOut"
        />
      </c.Parallel>
    </Choreo>
  </template>
}
let exits: ExitPages;

class TallPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    tall = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:300px;height:5400px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        <div id="near" {{motion role="chrome"}}>near the top</div>
        <div
          id="far"
          style="position:absolute;top:5000px;left:10px;width:60px;height:40px"
          {{motion role="chrome"}}
        >far below the fold</div>
        <div
          id="tile3"
          style="position:absolute;left:10px;top:30px;width:60px;height:40px;background:#0af"
          {{motion id="stage-c" role="stage"}}
        ></div>
      {{else}}
        <div
          id="hero3"
          style="position:absolute;left:190px;top:110px;width:90px;height:70px;background:#0af"
          {{motion id="stage-c" role="stage"}}
        ></div>
        <div id="new-near" {{motion role="foot"}}>arrives in view</div>
        <div
          id="new-far"
          style="position:absolute;top:5000px;left:10px"
          {{motion role="foot"}}
        >arrives below the fold</div>
      {{/if}}
      <c.Crossing
        @duration={{0.12}}
        @ease="easeInOut"
        @leave={{0.1}}
        @arrive={{0.1}}
      />
    </Choreo>
  </template>
}
let tall: TallPages;

class NestedPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    nested = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:300px;height:220px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        {{! the card: a NAMED leaver that CONTAINS the paired stage — the
            View Transitions API forbids exactly this shape (naming a
            container of named things froze the page); the crossing must
            not inherit that rule }}
        <div
          id="wrap2"
          style="position:absolute;left:10px;top:30px;width:120px;height:90px;background:#333"
          {{motion role="card"}}
        >
          <div
            id="tile2"
            style="position:absolute;left:10px;top:10px;width:60px;height:40px;background:#0af"
            {{motion id="stage-b" role="stage"}}
          ></div>
        </div>
      {{else}}
        <div
          id="hero2"
          style="position:absolute;left:190px;top:110px;width:90px;height:70px;background:#0af"
          {{motion id="stage-b" role="stage"}}
        ></div>
      {{/if}}
      <c.Crossing
        @duration={{0.12}}
        @ease="easeInOut"
        @leave={{0.1}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let nested: NestedPages;

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

  test('the crossfade carries color, not transparency: the ground never leaks', async function (assert) {
    const channels = (css: string) => {
      const m =
        /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(css);
      return m
        ? {
            a: m[4] === undefined ? 1 : parseFloat(m[4]),
            b: parseFloat(m[3]!),
            g: parseFloat(m[2]!),
            r: parseFloat(m[1]!),
          }
        : null;
    };

    await render(<template><ColorPages /></template>);
    await animationsSettled();
    colors.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();
    await nextFrame();

    const hero = find('#heroC') as HTMLElement;
    const mid = channels(getComputedStyle(hero).backgroundColor);
    // the two skins' EFFECTIVE colors over the rgb(16,32,48) ground:
    // old ≈ (28,56,104), new ≈ (108,46,44). Mid-flight the receiver wears a
    // SOLID between them — opacity has been turned into an actual color
    assert.ok(
      mid,
      `the flying box has a background (${getComputedStyle(hero).backgroundColor})`
    );
    assert.strictEqual(
      mid!.a,
      1,
      'the flying box is never transparent: the ground cannot leak through'
    );
    assert.true(
      mid!.r > 27 && mid!.r < 109 && mid!.b < 105 && mid!.b > 43,
      `the solid tweens between the two effective colors (r ${mid!.r}, b ${mid!.b})`
    );
    assert.strictEqual(
      getComputedStyle(hero).opacity,
      '1',
      'the receiver holds full opacity: the dissolve rides above, on the old skin'
    );
    const skin = document.querySelector(
      '[data-choreo-orphans] #tileC'
    ) as HTMLElement;
    assert.ok(skin, 'the old skin rides the flight');
    assert.true(
      parseFloat(getComputedStyle(skin).opacity) < 1,
      'the old skin is the fading half'
    );

    await animationsSettled();
    // beat five: landed, the solid is handed back to the stylesheet's own
    // alpha — computed style, not the attribute
    assert.strictEqual(
      getComputedStyle(find('#heroC') as HTMLElement).backgroundColor,
      'rgba(200, 60, 40, 0.5)',
      'at rest the real alpha blend returns'
    );
    await sleep(20);
  });

  test('a specific exit owns its sprite: the generic dissolve yields', async function (assert) {
    await render(<template><ExitPages /></template>);
    await animationsSettled();
    exits.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();
    await nextFrame();

    const menu = document.querySelector('#menu4') as HTMLElement;
    assert.ok(menu, 'the leaver with its own exit is retained');
    const m = /translateY\((-?[\d.]+)px\)/.exec(menu.style.transform);
    assert.true(
      m !== null && parseFloat(m[1]!) < -2,
      `the menu RISES out, as its own step says (${menu.style.transform})`
    );
    assert.strictEqual(
      getComputedStyle(menu).opacity,
      '1',
      'the generic dissolve yielded: nothing double-animates the menu'
    );

    await animationsSettled();
    assert.notOk(document.querySelector('#menu4'), 'the exit still completes');
    const rest = bounds(find('#hero4') as HTMLElement);
    assert.true(
      Math.abs(rest.left - 190) < 1.5,
      `the flight closed on the real seat (${rest.left})`
    );
    await sleep(20);
  });

  test('only what the viewports can see animates: offstage leavers drop, offstage arrivals just stand', async function (assert) {
    await render(<template><TallPages /></template>);
    await animationsSettled();
    tall.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();

    const layer = find('[data-choreo-orphans]') as HTMLElement;
    assert.ok(
      layer.querySelector('#near'),
      'the visible leaver is retained, fading'
    );
    assert.notOk(
      document.querySelector('#far'),
      'a leaver below the fold is dropped without a frame — nobody was watching'
    );
    assert.true(
      parseFloat(getComputedStyle(find('#new-near') as HTMLElement).opacity) <
        0.5,
      'a visible arrival waits for its cue'
    );
    assert.strictEqual(
      getComputedStyle(find('#new-far') as HTMLElement).opacity,
      '1',
      'an arrival below the fold simply stands — no cue was compiled for it'
    );

    await animationsSettled();
    assert.strictEqual(layer.children.length, 0, 'the layer empties');
    await sleep(20);
  });

  test('a claimed skin is lifted out of its fading container: naming the card is legal', async function (assert) {
    await render(<template><NestedPages /></template>);
    await animationsSettled();
    nested.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();

    const layer = find('[data-choreo-orphans]') as HTMLElement;
    const wrap = layer.querySelector('#wrap2');
    const skin = layer.querySelector('#tile2') as HTMLElement | null;
    assert.ok(wrap, 'the card rides the orphan layer as a leaver');
    assert.ok(skin, 'the claimed skin is in the layer too');
    assert.notOk(
      wrap?.contains(skin),
      'the skin was LIFTED OUT — it crosses in the flight, not inside a fading card'
    );
    // the skin rides the flight: mid-way between its old seat (20) and the
    // receiver's landing (190), not parked at either end
    if (skin) {
      const s = bounds(skin);
      assert.true(
        s.left > 25 && s.left < 185,
        `the old skin travels with the flight (${s.left})`
      );
    }
    const wrapStyle = wrap ? getComputedStyle(wrap) : null;
    assert.true(
      wrapStyle !== null && parseFloat(wrapStyle.opacity) < 1,
      `the card itself is fading as a leave (${wrapStyle?.opacity})`
    );

    await animationsSettled();
    assert.strictEqual(
      layer.children.length,
      0,
      'the orphan layer is empty once the crossing lands'
    );
    const rest = bounds(find('#hero2') as HTMLElement);
    assert.true(
      Math.abs(rest.left - 190) < 1.5,
      `the flight closed on the real seat (${rest.left})`
    );
    await sleep(20);
  });
});
