/**
 * @route and c.Crossing (docs/choreo-constructs.md §4.7): a subtree swap as
 * one pass — leaves fade first, the paired flight carries, arrivals land
 * near the settle, and live content never freezes, because nothing is
 * snapshotted.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render, settled, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
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
      {{! roomier on purpose: the tests on this fixture read a mid-flight
          still, and a headless CI can hand out its first animation frame
          late enough that a 0.14s move is over before anyone looks }}
      <c.Crossing
        @duration={{0.4}}
        @ease="easeInOut"
        @leave={{0.34}}
        @arrive={{0.2}}
      />
    </Choreo>
  </template>
}
let colors: ColorPages;

class SubstancePages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    substance = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:400px;height:300px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        {{! the subject sits in the LEFT HALF of the small frame }}
        <div
          id="tileS"
          style="position:absolute;left:10px;top:20px;width:100px;height:80px;background:#0af"
          {{motion id="stage-s" role="stage"}}
        >
          <div
            id="tileSub"
            data-choreo-substance
            style="position:absolute;left:0;top:20px;width:40px;height:20px;background:#fff"
          ></div>
        </div>
      {{else}}
        {{! …and in the RIGHT HALF of the big one: matching frames would
            let the subject drift; the flight must match the SUBSTANCE }}
        <div
          id="heroS"
          style="position:absolute;left:140px;top:120px;width:240px;height:160px;background:#0af"
          {{motion id="stage-s" role="stage"}}
        >
          <div
            id="heroSub"
            data-choreo-substance
            style="position:absolute;left:120px;top:40px;width:120px;height:80px;background:#fff"
          ></div>
        </div>
      {{/if}}
      <c.Crossing
        @duration={{0.4}}
        @ease="easeInOut"
        @leave={{0.06}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let substance: SubstancePages;

class WidthPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    widths = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:400px;height:300px"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        {{! a SQUARE subject leaving… }}
        <div
          id="tileW"
          style="position:absolute;left:10px;top:20px;width:100px;height:80px;background:#0af"
          {{motion id="stage-w" role="stage"}}
        >
          <div
            id="tileWSub"
            data-choreo-substance
            style="position:absolute;left:10px;top:10px;width:40px;height:40px;background:#fff"
          ></div>
        </div>
      {{else}}
        {{! …into a WIDER-aspect subject: cover-matching would key on the
            height and splash the width; the rule keys on WIDTH, pins the
            TOPS, and crops the bottom }}
        <div
          id="heroW"
          style="position:absolute;left:140px;top:120px;width:240px;height:160px;background:#0af"
          {{motion id="stage-w" role="stage"}}
        >
          <div
            id="heroWSub"
            data-choreo-substance
            style="position:absolute;left:40px;top:30px;width:160px;height:52px;background:#fff"
          ></div>
        </div>
      {{/if}}
      <c.Crossing
        @duration={{0.4}}
        @ease="easeInOut"
        @leave={{0.06}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let widths: WidthPages;

class PackPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    packPages = this;
  }
  <template>
    <Choreo
      @route={{true}}
      class="stage"
      style="position:relative;width:400px;height:200px;font-family:sans-serif"
      as |c|
    >
      {{#if (eq this.page "grid")}}
        {{! a full-bleed title: the LAYOUT box is the stage, the word is not }}
        <b
          id="oldType"
          style="position:absolute;left:0;right:0;top:40px;width:auto;font-size:20px;text-align:center;white-space:nowrap"
          {{motion id="pack-title" role="type" pack="content"}}
        >Hi</b>
      {{else}}
        <b
          id="newType"
          style="position:absolute;left:24px;top:90px;width:max-content;font-size:48px;white-space:nowrap"
          {{motion id="pack-title" role="type" pack="content"}}
        >Hello</b>
      {{/if}}
      <c.Crossing
        @duration={{0.4}}
        @ease="easeInOut"
        @leave={{0.06}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let packPages: PackPages;

class QuietPages extends Component {
  @tracked page: 'detail' | 'grid' = 'grid';
  constructor(o: unknown, a: object) {
    super(o as never, a);
    quiet = this;
  }
  <template>
    <Choreo
      @route={{true}}
      @quiet={{true}}
      class="stage"
      style="position:relative;width:300px;height:220px"
      as |c|
    >
      {{! a bystander: not a participant, just a thing with its own
          animation running — the crossing must freeze it for the span }}
      <div id="bystander" style="width:20px;height:20px;background:#888"></div>
      {{#if (eq this.page "grid")}}
        <div
          id="tileQ"
          style="position:absolute;left:10px;top:30px;width:60px;height:40px;background:#0af"
          {{motion id="stage-q" role="stage"}}
        ></div>
      {{else}}
        <div
          id="heroQ"
          style="position:absolute;left:190px;top:110px;width:90px;height:70px;background:#0af"
          {{motion id="stage-q" role="stage"}}
        ></div>
      {{/if}}
      <c.Crossing
        @duration={{0.15}}
        @ease="easeInOut"
        @leave={{0.06}}
        @arrive={{0.06}}
      />
    </Choreo>
  </template>
}
let quiet: QuietPages;

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
      {{! roomier than the fixtures above on purpose: this test reads a
          mid-flight still, and a headless CI can hand out its first
          animation frame late enough that a 0.12s move is over — or has
          not started — by the time two frames have passed }}
      <c.Crossing
        @duration={{0.4}}
        @ease="easeInOut"
        @leave={{0.34}}
        @arrive={{0.2}}
      />
    </Choreo>
  </template>
}
let nested: NestedPages;

module('Integration | choreo | crossing', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

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
    // mid-flight is a STATE, not a frame count: wait for the skin to have
    // actually left its seat (left:10) — three frames buy no progress at
    // all if the first one arrives late, and the crossfade then reads at
    // exactly opacity 1
    await waitUntil(
      () => {
        const s = document.querySelector(
          '[data-choreo-orphans] #tileC'
        ) as HTMLElement | null;
        return s !== null && bounds(s).left > 20;
      },
      { timeout: 2000 }
    );

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

  test('the flight never distorts: uniform scale, the mismatch cropped', async function (assert) {
    // Pages' tile (60x40, 3:2) flies into a hero of a DIFFERENT aspect —
    // iOS's rule: match by cover, never stretch; the crop window carries
    // the difference
    await render(<template><ColorPages /></template>);
    await animationsSettled();
    colors.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();

    const hero = find('#heroC') as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(hero).transform);
    assert.true(
      Math.abs(m.a - m.d) < 0.02,
      `the receiver scales UNIFORMLY — no stretch (${m.a.toFixed(3)} vs ${m.d.toFixed(3)})`
    );
    assert.notStrictEqual(
      getComputedStyle(hero).clipPath,
      'none',
      'the aspect mismatch is carried by a crop window instead'
    );
    const skin = document.querySelector(
      '[data-choreo-orphans] #tileC'
    ) as HTMLElement;
    const sm = new DOMMatrix(getComputedStyle(skin).transform);
    assert.true(
      Math.abs(sm.a - sm.d) < 0.02,
      `the old skin scales uniformly too (${sm.a.toFixed(3)} vs ${sm.d.toFixed(3)})`
    );

    await animationsSettled();
    const clip = getComputedStyle(find('#heroC') as HTMLElement).clipPath;
    assert.true(
      clip === 'none' || /inset\(0px(?: 0px)*\)/.test(clip),
      `the landing wears no crop (${clip})`
    );
    await sleep(20);
  });

  test('the flight matches the SUBSTANCE, not the frame', async function (assert) {
    await render(<template><SubstancePages /></template>);
    await animationsSettled();
    const oldSub = bounds(find('#tileSub') as HTMLElement);

    substance.page = 'detail';
    await settled();
    await nextFrame();
    const nowSub = bounds(find('#heroSub') as HTMLElement);
    // the receiver's SUBJECT opens where the old subject stood — even
    // though the frames' fractions disagree, so frame-matching would put
    // it somewhere else entirely
    assert.true(
      Math.abs(nowSub.left - oldSub.left) < 14 &&
        Math.abs(nowSub.top - oldSub.top) < 14,
      `the subject opens on the old subject's seat ` +
        `(${nowSub.left.toFixed(0)},${nowSub.top.toFixed(0)} vs ${oldSub.left.toFixed(0)},${oldSub.top.toFixed(0)})`
    );
    assert.true(
      Math.abs(nowSub.width - oldSub.width) / oldSub.width < 0.3,
      `…at the old subject's extent (${nowSub.width.toFixed(0)} vs ${oldSub.width.toFixed(0)})`
    );

    await animationsSettled();
    const region = bounds(find('.stage') as HTMLElement);
    const rest = bounds(find('#heroS') as HTMLElement);
    assert.true(
      Math.abs(rest.left - (region.left + 140)) < 1.5 &&
        Math.abs(rest.top - (region.top + 120)) < 1.5,
      `the frame still lands exactly on its real seat (${rest.left.toFixed(0)},${rest.top.toFixed(0)})`
    );
    await sleep(20);
  });

  test('pack=content matches the shrink-wrap, not a stretched title frame', async function (assert) {
    await render(<template><PackPages /></template>);
    await animationsSettled();
    const leaving = find('#oldType') as HTMLElement;
    assert.true(
      leaving.getBoundingClientRect().width > 300,
      'the leaving title layout box is the stage'
    );

    packPages.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();
    const now = bounds(find('#newType') as HTMLElement);
    assert.true(
      now.width < 160,
      `the receiver opens at the WORD, not the 400px frame (${now.width.toFixed(0)})`
    );

    await animationsSettled();
    await sleep(20);
  });

  test('the superimposed subjects match by WIDTH, pin their TOPS, and crop the bottom', async function (assert) {
    // The matching-snapshot rule: at the start the entering subject is
    // scaled to the EXITING subject's width — never to cover — its top
    // on the exiting subject's top, and its bottom cropped where it runs
    // past the exiting subject's height. (Symmetric on the way out.)
    await render(<template><WidthPages /></template>);
    await animationsSettled();
    const oldSub = bounds(find('#tileWSub') as HTMLElement);

    widths.page = 'detail';
    await settled();
    await nextFrame();
    const sub = bounds(find('#heroWSub') as HTMLElement);
    assert.true(
      Math.abs(sub.width - oldSub.width) < 6,
      `the entering subject opens at the exiting subject's WIDTH ` +
        `(${sub.width.toFixed(0)} vs ${oldSub.width.toFixed(0)})`
    );
    assert.true(
      Math.abs(sub.top - oldSub.top) < 6,
      `with its TOP on the exiting subject's top ` +
        `(${sub.top.toFixed(0)} vs ${oldSub.top.toFixed(0)})`
    );
    const hero = find('#heroW') as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(hero).transform);
    assert.true(
      Math.abs(m.a - m.d) < 0.02,
      `uniform scale still — width-derived, not cover (${m.a.toFixed(3)} vs ${m.d.toFixed(3)})`
    );
    // the entering subject is TALLER than the exiting one at this width
    // (40/160 of 52px = 13px … the exiting is 40px — actually shorter);
    // the crop rule is asserted from the clip's SHAPE: bottom inset only
    const clip = getComputedStyle(hero).clipPath;
    if (clip !== 'none') {
      const nums = [...clip.matchAll(/([\d.]+)px/g)].map((x) => Number(x[1]));
      const [t = 0, r = 0, , l = 0] = nums;
      assert.true(
        t < 1 && r < 1 && l < 1,
        `only the bottom is ever cropped (${clip})`
      );
    }

    await animationsSettled();
    const region = bounds(find('.stage') as HTMLElement);
    const rest = bounds(find('#heroW') as HTMLElement);
    assert.true(
      Math.abs(rest.left - (region.left + 140)) < 1.5 &&
        Math.abs(rest.top - (region.top + 120)) < 1.5,
      `the frame still lands exactly on its real seat (${rest.left.toFixed(0)},${rest.top.toFixed(0)})`
    );
    await sleep(20);
  });

  test('@quiet: the rest of the page freezes for the crossing, and resumes after', async function (assert) {
    await render(<template><QuietPages /></template>);
    await animationsSettled();
    const bystander = find('#bystander') as HTMLElement;
    const loop = bystander.animate([{ opacity: 0.4 }, { opacity: 1 }], {
      direction: 'alternate',
      duration: 300,
      iterations: Infinity,
    });
    assert.strictEqual(loop.playState, 'running', 'the bystander loops');

    quiet.page = 'detail';
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(
      loop.playState,
      'paused',
      'the crossing quiets the rest of the page for its span'
    );
    // and the crossing itself still moves: quiet is for everyone else
    const mid = bounds(find('#heroQ') as HTMLElement);
    assert.true(
      mid.left < 189,
      `the flight is not frozen with them (${mid.left})`
    );

    await animationsSettled();
    assert.strictEqual(
      loop.playState,
      'running',
      'the landing hands the page back: the loop resumes where it was'
    );
    loop.cancel();
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
    // mid-flight is a STATE, not a frame count. Wait for the skin to have
    // actually left its seat rather than assuming two frames bought any
    // progress — on a busy CI machine the first frame can arrive late.
    await waitUntil(
      () => {
        const s = find('[data-choreo-orphans] #tile2') as HTMLElement | null;
        const w = find('[data-choreo-orphans] #wrap2') as HTMLElement | null;
        return (
          s !== null &&
          w !== null &&
          bounds(s).left > 25 &&
          parseFloat(getComputedStyle(w).opacity) < 1
        );
      },
      { timeout: 2000 }
    );

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
