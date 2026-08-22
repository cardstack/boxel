/**
 * Port of framer-motion/cypress/integration/layout-shared-lightbox-crossfade.ts (motion@bbabb00):
 * children with layoutId animating back to their origin components. `?instant=true` becomes @instant;
 * useIsPresent() is the presence handle's isPresent. The upstream "switch" variant is commented out there.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, click } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import LayoutGroup from 'glimmer-motion/layout-group';
import type { PresenceHandle } from 'glimmer-motion/presence-types';
import type { Transition } from 'motion-dom';
import { setupFixtureViewport, should, expectBbox, wait, $ } from '../../../helpers/layout-fixture';

const keyOf = (it: { key: string }) => it.key;
const numColors = 3;
const colors = Array.from({ length: numColors }, (_, i) => `hsl(${Math.round((360 / numColors) * i)}, 100%, 50%)`);

const CONTAINER = 'background-color:#eeeeee;border-radius:25px;width:600px;height:600px;margin:0;padding:0 20px 20px 0;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:space-between;list-style:none';
const ITEM = { padding: '20px', cursor: 'pointer', margin: '20px 0 0 20px', flex: '1 1 90px', display: 'flex', justifyContent: 'center', alignItems: 'center' };
const CHILD = { width: 50, height: 50, borderRadius: 25, backgroundColor: 'white', opacity: 0.5 };
const CHILD_BLACK = { ...CHILD, backgroundColor: 'black' };
const OVERLAY = { background: 'rgba(0,0,0,0.6)', position: 'fixed', top: '0', left: '0', bottom: '0', right: '0' };
const SINGLE = { width: '500px', height: '300px', padding: 50, backgroundColor: '#fff', borderRadius: 50 };
const FADE_IN = { opacity: 0 }, FADE_ON = { opacity: 1 }, FADE_OUT = { opacity: 0 };

class SingleImage extends Component<{ Args: { color: string; presence: PresenceHandle; transition: Transition; setOpen: (c: false | string) => void } }> {
  get overlayStyle() { return { ...OVERLAY, pointerEvents: this.args.presence.isPresent ? 'auto' : 'none' }; }
  get childId() { return `child-${this.args.color}`; }
  close = () => this.args.setOpen(false);
  <template>
    <div id="overlay" {{motion presence=@presence initial=FADE_IN animate=FADE_ON exit=FADE_OUT style=this.overlayStyle transition=@transition}} {{on "click" this.close}}></div>
    <div style="position:absolute;top:0;left:0;bottom:0;right:0;display:flex;justify-content:center;align-items:center;pointer-events:none">
      <div id="parent" {{motion layoutId=@color style=SINGLE transition=@transition}}>
        <div id="child" {{motion layoutId=this.childId style=CHILD_BLACK transition=@transition}}></div>
      </div>
    </div>
  </template>
}

class Lightbox extends Component<{ Args: { instant?: boolean } }> {
  @tracked openColor: false | string = false;
  get transition(): Transition { return this.args.instant ? { type: false } : { duration: 0.01 }; }
  get items() { return colors.map((color, i) => ({ key: color, color, first: i === 0 })); }
  get open() { return this.openColor === false ? [] : [{ key: this.openColor, color: this.openColor }]; }
  setOpen = (c: false | string) => { this.openColor = c; };
  styleFor = (color: string) => ({ ...ITEM, backgroundColor: color, borderRadius: 0 });
  childId = (color: string) => `child-${color}`;
  <template>
    <div style="position:fixed;top:0;left:0;bottom:0;right:0;display:flex;justify-content:center;align-items:center;background:#ccc">
      <ul style={{CONTAINER}}>
        {{#each this.items key="key" as |it|}}
          <li id={{if it.first "item-parent" undefined}} {{motion layoutId=it.color style=(this.styleFor it.color) transition=this.transition}} {{on "click" (fn this.setOpen it.color)}}>
            <div id={{if it.first "item-child" undefined}} {{motion layoutId=(this.childId it.color) style=CHILD transition=this.transition}}></div>
          </li>
        {{/each}}
      </ul>
      <Presence @items={{this.open}} @key={{keyOf}} as |it h|>
        <SingleImage @color={{it.color}} @presence={{h}} @transition={{this.transition}} @setOpen={{this.setOpen}} />
      </Presence>
    </div>
  </template>
}

function fn<A extends unknown[]>(f: (...a: A) => void, ...bound: A) { return () => f(...bound); }

module('Integration | motion | cypress | Shared layout lightbox example, crossfade', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  async function runScriptCrossfade(assert: Assert, instant: boolean) {
    await render(<template><LayoutGroup><Lightbox @instant={{instant}} /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#item-parent'), { top: 40, left: 210, width: 180, height: 580 }));
    await should(assert, (a) => expectBbox(a, $('#item-child'), { top: 305, left: 275, width: 50, height: 50 }));
    // Open lightbox
    await click('#item-parent'); await wait(50);
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#item-parent')).borderRadius, '8.33333% / 12.5%');
      a.strictEqual(getComputedStyle($('#item-parent')).opacity, '0');
      expectBbox(a, $('#item-parent'), { top: 130, left: 200, width: 600, height: 400 });
    });
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#item-child')).borderRadius, '50%');
      a.strictEqual(getComputedStyle($('#item-child')).opacity, '0');
      expectBbox(a, $('#item-child'), { top: 180, left: 250, width: 50, height: 50 });
    });
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#parent')).borderRadius, '50px');
      a.strictEqual(getComputedStyle($('#parent')).opacity, '1');
      expectBbox(a, $('#parent'), { top: 130, left: 200, width: 600, height: 400 });
    });
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#child')).borderRadius, '25px');
      a.strictEqual(getComputedStyle($('#child')).opacity, '0.5');
      expectBbox(a, $('#child'), { top: 180, left: 250, width: 50, height: 50 });
    });
    // Close lightbox
    await click('#overlay'); await wait(50);
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#item-parent')).borderRadius, '0px');
      a.strictEqual(getComputedStyle($('#item-parent')).opacity, '1');
      expectBbox(a, $('#item-parent'), { top: 40, left: 210, width: 180, height: 580 });
    });
    await should(assert, (a) => {
      a.strictEqual(getComputedStyle($('#item-child')).borderRadius, '25px');
      a.strictEqual(getComputedStyle($('#item-child')).opacity, '0.5');
      expectBbox(a, $('#item-child'), { top: 305, left: 275, width: 50, height: 50 });
    });
  }

  test('Correctly animates between items and lightbox with instant transition', async function (assert) {
    await runScriptCrossfade(assert, true);
  });
  test('Correctly animates between items and lightbox with very fast transition', async function (assert) {
    await runScriptCrossfade(assert, false);
  });
});
