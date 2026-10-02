/**
 * Ports of Motion's packages/framer-motion/cypress/integration/drag-tabs.ts (fixture drag-tabs) and drag-to-reorder.ts
 * (fixture drag-to-reorder), motion@bbabb00, and reorder-release-before-frame.ts (fixture drag-to-reorder), motion@v13.4.6.
 * The fixtures' `body` styles apply to the fixture viewport (#ember-testing) here; MotionConfig's transition is passed
 * to the elements it reached.
 */
import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import type { PresenceHandle } from 'glimmer-motion/presence-types';
import ReorderGroup from 'glimmer-motion/reorder/group';
import ReorderItem from 'glimmer-motion/reorder/item';
import { setupMotion } from 'glimmer-motion/test-support';
import { animateMotionValue, type MotionValue, motionValue } from 'motion-dom';
import { module, test } from 'qunit';

import {
  $,
  cyClick,
  pointerAt,
  setupFixtureViewport,
  should,
  trigger,
  wait,
} from '../../../helpers/layout-fixture';
import { nextFrame } from '../../../helpers/motion';

/* ---------- drag-tabs.tsx ---------- */
interface Ingredient {
  icon: string;
  label: string;
}
const allIngredients: Ingredient[] = [
  { icon: '🍅', label: 'Tomato' },
  { icon: '🥬', label: 'Lettuce' },
  { icon: '🧀', label: 'Cheese' },
  { icon: '🥕', label: 'Carrot' },
  { icon: '🍌', label: 'Banana' },
  { icon: '🫐', label: 'Blueberries' },
  { icon: '🥂', label: 'Champers?' },
];
const initialTabs = allIngredients.slice(0, 3);
const CONFIG = { duration: 0.1 }; // MotionConfig transition
const TAB_INITIAL = { opacity: 0, y: 30, transition: { duration: 0.15 } };
const TAB_EXIT = { opacity: 0, y: 20, transition: { duration: 0.3 } };
const TAB_WHILE_DRAG = { backgroundColor: '#e3e3e3' };
const TAB_DRAG_TRANSITION = { bounceStiffness: 10000, bounceDamping: 10000 };
const CONTENT_ANIMATE = { opacity: 1, y: 0 },
  CONTENT_INITIAL = { opacity: 0, y: 20 },
  CONTENT_EXIT = { opacity: 0, y: -20 },
  CONTENT_TRANSITION = { duration: 0.15 };
const TAP = { scale: 0.9 };
const keyOfItem = (it: { key: string }) => it.key;

class Tab extends Component<{
  Args: {
    group: any;
    isSelected: boolean;
    item: Ingredient;
    onClick: () => void;
    onRemove: () => void;
    presence: PresenceHandle;
  };
}> {
  get animate() {
    return {
      backgroundColor: this.args.isSelected ? '#f3f3f3' : '#fff',
      opacity: 1,
      y: 0,
      transition: { duration: 0.15 },
    };
  }
  get removeAnimate() {
    return { backgroundColor: this.args.isSelected ? '#e3e3e3' : '#fff' };
  }
  get id() {
    return `${this.args.item.label}-tab`;
  }
  get labelId() {
    return `${this.args.item.label}-label`;
  }
  get removeId() {
    return `${this.args.item.label}-remove`;
  }
  get className() {
    return 'tab' + (this.args.isSelected ? ' selected' : '');
  }
  get text() {
    return `${this.args.item.icon} ${this.args.item.label}`;
  }
  remove = (event: Event) => {
    event.stopPropagation();
    this.args.onRemove();
  };
  <template>
    <ReorderItem
      @group={{@group}}
      @value={{@item}}
      @presence={{@presence}}
      id={{this.id}}
      class={{this.className}}
      @initial={{TAB_INITIAL}}
      @animate={{this.animate}}
      @exit={{TAB_EXIT}}
      @whileDrag={{TAB_WHILE_DRAG}}
      @dragTransition={{TAB_DRAG_TRANSITION}}
      @transition={{CONFIG}}
      {{on "pointerdown" @onClick}}
    >
      <span
        id={{this.labelId}}
        {{motion layout="position" transition=CONFIG}}
      >{{this.text}}</span>
      <div class="close" {{motion layout=true transition=CONFIG}}>
        <button
          type="button"
          id={{this.removeId}}
          {{motion initial=false animate=this.removeAnimate transition=CONFIG}}
          {{on "pointerdown" this.remove}}
        >
          <svg width="10" height="10" viewBox="0 0 20 20"><path
              d="M 3 3 L 17 17"
              fill="transparent"
              stroke-width="3"
              stroke-linecap="round"
            ></path><path
              d="M 17 3 L 3 17"
              fill="transparent"
              stroke-width="3"
              stroke-linecap="round"
            ></path></svg>
        </button>
      </div>
    </ReorderItem>
  </template>
}

class Tabs extends Component {
  @tracked tabs = initialTabs;
  @tracked selectedTab: Ingredient | undefined = initialTabs[0];
  timer = 0;
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    registerDestructor(this, () => clearTimeout(this.timer));
  }
  get tabItems() {
    return this.tabs.map((item) => ({ key: item.label, item }));
  }
  get content() {
    return [
      {
        key: this.selectedTab ? this.selectedTab.label : 'empty',
        tab: this.selectedTab,
      },
    ];
  }
  get full() {
    return this.tabs.length === allIngredients.length;
  }
  setTabs = (tabs: Ingredient[]) => {
    this.tabs = tabs;
    this.repopulateWhenEmpty();
  };
  select = (item: Ingredient) => () => {
    this.selectedTab = item;
  };
  removeFor = (item: Ingredient) => () => {
    if (item === this.selectedTab) {
      this.selectedTab = closestItem(this.tabs, item);
    }
    this.setTabs(removeItem(this.tabs, item));
  };
  add = () => {
    const existing = new Set(this.tabs);
    const next = allIngredients.find((i) => !existing.has(i));
    if (next) {
      this.setTabs([...this.tabs, next]);
      this.selectedTab = next;
    }
  };
  /** Automatically repopulate tabs when they all close */
  repopulateWhenEmpty() {
    clearTimeout(this.timer);
    if (!this.tabs.length) {
      this.timer = window.setTimeout(() => {
        this.tabs = initialTabs;
        this.selectedTab = initialTabs[0];
      }, 2000);
    }
  }
  contentId = (tab: Ingredient | undefined) =>
    `${tab ? tab.label : 'empty'}-content`;
  <template>
    <div class="window">
      <nav>
        <LayoutGroup>
          <ReorderGroup
            @axis="x"
            @onReorder={{this.setTabs}}
            @values={{this.tabs}}
            class="tabs"
            @transition={{CONFIG}}
            as |group|
          >
            <Presence
              @items={{this.tabItems}}
              @key={{keyOfItem}}
              @initial={{false}}
              as |it h|
            >
              <Tab
                @item={{it.item}}
                @group={{group}}
                @presence={{h}}
                @isSelected={{eq this.selectedTab it.item}}
                @onClick={{this.select it.item}}
                @onRemove={{this.removeFor it.item}}
              />
            </Presence>
          </ReorderGroup>
          <button
            type="button"
            class="add-item"
            disabled={{this.full}}
            {{motion whileTap=TAP transition=CONFIG}}
            {{on "click" this.add}}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 20 20"
              style="transform:rotate(45deg);stroke:black"
            ><path
                d="M 3 3 L 17 17"
                fill="transparent"
                stroke-width="3"
                stroke-linecap="round"
              ></path><path
                d="M 17 3 L 3 17"
                fill="transparent"
                stroke-width="3"
                stroke-linecap="round"
              ></path></svg>
          </button>
        </LayoutGroup>
      </nav>
      <main>
        <Presence
          @items={{this.content}}
          @key={{keyOfItem}}
          @mode="wait"
          @initial={{false}}
          as |it h|
        >
          <div
            id={{this.contentId it.tab}}
            {{motion
              presence=h
              animate=CONTENT_ANIMATE
              initial=CONTENT_INITIAL
              exit=CONTENT_EXIT
              transition=CONTENT_TRANSITION
            }}
          >{{if it.tab it.tab.icon "😋"}}</div>
        </Presence>
      </main>
    </div>
    <style>
      {{TABS_STYLES}}
    </style>
  </template>
}
const eq = (a: unknown, b: unknown) => a === b;
function removeItem<T>(arr: T[], item: T) {
  const copy = [...arr];
  const i = copy.indexOf(item);
  if (i > -1) {
    copy.splice(i, 1);
  }
  return copy;
}
function closestItem<T>(arr: T[], item: T) {
  const i = arr.indexOf(item);
  return i === -1
    ? arr[0]
    : i === arr.length - 1
      ? arr[arr.length - 2]
      : arr[i + 1];
}

const TABS_STYLES = scoped(`
#ember-testing { width: 100%; height: 100%; background: #ff0055; overflow: hidden; padding: 0; margin: 0; display: flex; justify-content: center; align-items: center; }
.window { width: 480px; height: 360px; border-radius: 10px; background: white; overflow: hidden; display: flex; flex-direction: column; }
nav { background: #fdfdfd; padding: 5px 5px 0; border-radius: 10px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: 1px solid #eeeeee; height: 44px; display: grid; grid-template-columns: 1fr 35px; max-width: 480px; overflow: hidden; }
.tabs { flex-grow: 1; display: flex; justify-content: flex-start; align-items: flex-end; flex-wrap: nowrap; width: 420px; padding-right: 10px; }
main { display: flex; justify-content: center; align-items: center; font-size: 128px; flex-grow: 1; user-select: none; }
ul, li { list-style: none; padding: 0; margin: 0; font-family: "Poppins", sans-serif; font-weight: 500; font-size: 14px; }
li { border-radius: 5px; border-bottom-left-radius: 0; border-bottom-right-radius: 0; width: 100%; padding: 10px 15px; position: relative; background: white; cursor: pointer; height: 24px; display: flex; justify-content: space-between; align-items: center; flex: 1; min-width: 0; overflow: hidden; user-select: none; }
li span { color: black; flex-shrink: 1; flex-grow: 1; white-space: nowrap; display: block; min-width: 0; padding-right: 30px; mask-image: linear-gradient(to left, transparent 10px, #fff 30px); -webkit-mask-image: linear-gradient(to left, transparent 10px, #fff 30px); }
li .close { position: absolute; top: 0; bottom: 0; right: 10px; display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; }
li button { width: 20px; height: 20px; border: 0; background: #fff; border-radius: 3px; display: flex; justify-content: center; align-items: center; stroke: #000; margin-left: 10px; cursor: pointer; flex-shrink: 0; padding: 0; font: inherit; }
.add-item { width: 30px; height: 30px; background: #eee; border-radius: 50%; border: 0; cursor: pointer; align-self: center; padding: 0; }
.add-item:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
`);

/** the fixture's stylesheet, scoped to the fixture viewport: the app's own CSS is loaded in tests too,
 *  and a Cypress page only has the fixture's rules */
function scoped(css: string) {
  return css.replace(
    /([^{}]+)\{/g,
    (_m, sel: string) =>
      sel
        .split(',')
        .map((s) => {
          s = s.trim();
          return s.startsWith('#ember-testing') ? s : `#ember-testing ${s}`;
        })
        .join(', ') + ' {'
  );
}

module('Integration | motion | cypress | Tabs demo', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);
  const opacity = (sel: string) => getComputedStyle($(sel)).opacity;

  test("Layout animations don't interfere with opacity", async function (assert) {
    await render(<template><Tabs /></template>);
    await wait(50);
    await cyClick('button.add-item');
    await wait(100);
    await should(assert, (a) => a.strictEqual(opacity('#Carrot-tab'), '1'));
  });

  test("First tab doesn't distort when multiple layout animations started", async function (assert) {
    await render(<template><Tabs /></template>);
    await wait(50);
    await should(assert, (a) => {
      const { left, right } = $('#Tomato-label').getBoundingClientRect();
      a.strictEqual(left, 280);
      a.strictEqual(right, 390);
    });
    await cyClick('button.add-item');
    await wait(20);
    await cyClick('button.add-item');
    await wait(100);
    await should(assert, (a) => {
      const { left, right } = $('#Tomato-label').getBoundingClientRect();
      a.strictEqual(left, 280);
      a.strictEqual(right, 334);
    });
  });

  test('Opacity finishes animating on reorder', async function (assert) {
    await render(<template><Tabs /></template>);
    await wait(50);
    await cyClick('#Lettuce-tab');
    trigger('#Lettuce-tab', 'pointerdown', 40, 10);
    await wait(300);
    trigger('#Lettuce-tab', 'pointermove', -40, 10);
    trigger('#Lettuce-tab', 'pointermove', -100, 300);
    await wait(50);
    trigger('#Lettuce-tab', 'pointerup');
    await wait(200);
    await should(assert, (a) =>
      a.strictEqual(opacity('#Lettuce-content'), '1')
    );
    await wait(200);
    trigger('#Tomato-tab', 'pointerdown', 40, 10);
    trigger('#Tomato-tab', 'pointermove', -40, 10);
    await wait(20);
    trigger('#Tomato-tab', 'pointermove', -100, 300);
    await wait(100);
    trigger('#Tomato-tab', 'pointerup');
    await wait(350);
    await should(assert, (a) =>
      a.strictEqual($('#Tomato-tab').getBoundingClientRect().left, 265)
    );
    await should(assert, (a) =>
      a.strictEqual($('#Tomato-label').getBoundingClientRect().left, 280)
    );
  });

  test("Double removing item doesn't break exit animation", async function (assert) {
    await render(<template><Tabs /></template>);
    await wait(50);
    await cyClick('#Lettuce-remove');
    await wait(20);
    await cyClick('#Lettuce-remove');
    await wait(400);
    await should(assert, (a) =>
      a.strictEqual($('nav').querySelectorAll('#Lettuce-tab').length, 0)
    );
  });

  test("Removed tabs don't reappear on reorder", async function (assert) {
    await render(<template><Tabs /></template>);
    await cyClick('#Tomato-remove');
    await wait(400);
    trigger('#Lettuce-tab', 'pointerdown', 40, 10);
    await wait(30);
    trigger('#Lettuce-tab', 'pointermove', 50, 10);
    await wait(40);
    trigger('#Lettuce-tab', 'pointermove', 200, 10);
    await wait(100);
    trigger('#Lettuce-tab', 'pointerup');
    await wait(200);
    await should(assert, (a) => {
      const { left, right } = $('#Lettuce-tab').getBoundingClientRect();
      a.strictEqual(left, 475);
      a.strictEqual(right, 685);
    });
    await should(assert, (a) =>
      a.strictEqual($('nav').querySelectorAll('.tab').length, 2)
    );
  });

  test('New items correctly reorderable', async function (assert) {
    await render(<template><Tabs /></template>);
    await wait(50);
    await cyClick('button.add-item');
    await wait(150);
    await wait(50);
    trigger('#Carrot-tab', 'pointerdown', 40, 10);
    await wait(30);
    trigger('#Carrot-tab', 'pointermove', -40, 10);
    await wait(100);
    trigger('#Carrot-tab', 'pointermove', -10, 10);
    await wait(100);
    trigger('#Carrot-tab', 'pointerup');
    await wait(200);
    await should(assert, (a) =>
      a.strictEqual($('#Carrot-tab').getBoundingClientRect().left, 475)
    );
  });
});

/* ---------- drag-to-reorder.tsx ---------- */
const inactiveShadow = '0px 0px 0px rgba(0,0,0,0.8)';
const ITEM_TRANSITION = { duration: 0.1 };
const ITEM_DRAG_TRANSITION = { bounceStiffness: 2000, bounceDamping: 10000 };
class ListItem extends Component<{
  Args: { axis: 'x' | 'y'; group: any; item: string };
}> {
  x = motionValue(0);
  y = motionValue(0);
  boxShadow = motionValue(inactiveShadow);
  style = { boxShadow: this.boxShadow, y: this.y };
  constructor(
    owner: unknown,
    args: { axis: 'x' | 'y'; group: unknown; item: string }
  ) {
    super(owner as never, args);
    const axisValue = args.axis === 'y' ? this.y : this.x;
    let isActive = false;
    axisValue.on('change', (latest: number) => {
      const wasActive = isActive;
      if (latest !== 0) {
        isActive = true;
        if (isActive !== wasActive) {
          animateShadow(this.boxShadow, '5px 5px 10px rgba(0,0,0,0.3)');
        }
      } else {
        isActive = false;
        if (isActive !== wasActive) {
          animateShadow(this.boxShadow, inactiveShadow);
        }
      }
    });
  }
  <template>
    <ReorderItem
      @group={{@group}}
      @value={{@item}}
      id={{@item}}
      @style={{this.style}}
      @dragTransition={{ITEM_DRAG_TRANSITION}}
      @transition={{ITEM_TRANSITION}}
    >
      <span>{{@item}}</span>
      <svg viewBox="0 0 39 39" width="39" height="39">
        <path
          d="M 5 0 C 7.761 0 10 2.239 10 5 C 10 7.761 7.761 10 5 10 C 2.239 10 0 7.761 0 5 C 0 2.239 2.239 0 5 0 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 19 0 C 21.761 0 24 2.239 24 5 C 24 7.761 21.761 10 19 10 C 16.239 10 14 7.761 14 5 C 14 2.239 16.239 0 19 0 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 33 0 C 35.761 0 38 2.239 38 5 C 38 7.761 35.761 10 33 10 C 30.239 10 28 7.761 28 5 C 28 2.239 30.239 0 33 0 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 33 14 C 35.761 14 38 16.239 38 19 C 38 21.761 35.761 24 33 24 C 30.239 24 28 21.761 28 19 C 28 16.239 30.239 14 33 14 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 19 14 C 21.761 14 24 16.239 24 19 C 24 21.761 21.761 24 19 24 C 16.239 24 14 21.761 14 19 C 14 16.239 16.239 14 19 14 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 5 14 C 7.761 14 10 16.239 10 19 C 10 21.761 7.761 24 5 24 C 2.239 24 0 21.761 0 19 C 0 16.239 2.239 14 5 14 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 5 28 C 7.761 28 10 30.239 10 33 C 10 35.761 7.761 38 5 38 C 2.239 38 0 35.761 0 33 C 0 30.239 2.239 28 5 28 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 19 28 C 21.761 28 24 30.239 24 33 C 24 35.761 21.761 38 19 38 C 16.239 38 14 35.761 14 33 C 14 30.239 16.239 28 19 28 Z"
          fill="#CCC"
        ></path>
        <path
          d="M 33 28 C 35.761 28 38 30.239 38 33 C 38 35.761 35.761 38 33 38 C 30.239 38 28 35.761 28 33 C 28 30.239 30.239 28 33 28 Z"
          fill="#CCC"
        ></path>
      </svg>
    </ReorderItem>
  </template>
}
/** Motion's animate(motionValue, target) */
function animateShadow(value: MotionValue<string>, target: string) {
  value.start(animateMotionValue('boxShadow', value, target, {}));
}

const HORIZONTAL = { display: 'flex' },
  VERTICAL = {};
class ReorderList extends Component<{ Args: { axis?: 'x' | 'y' } }> {
  @tracked items = ['Tomato', 'Cucumber', 'Mustard', 'Chicken'];
  get axis(): 'x' | 'y' {
    return this.args.axis || 'y';
  }
  get style() {
    return this.axis === 'y' ? VERTICAL : HORIZONTAL;
  }
  setItems = (items: string[]) => {
    this.items = items;
  };
  <template>
    <ReorderGroup
      @axis={{this.axis}}
      @onReorder={{this.setItems}}
      @style={{this.style}}
      @values={{this.items}}
      as |group|
    >
      {{#each this.items as |item|}}
        <ListItem @axis={{this.axis}} @item={{item}} @group={{group}} />
      {{/each}}
      <style>
        {{LIST_STYLES}}
      </style>
    </ReorderGroup>
  </template>
}
const LIST_STYLES = scoped(`
#ember-testing { width: 100%; height: 100%; background: #ffaa00; overflow: hidden; padding: 0; margin: 0; display: flex; justify-content: center; align-items: center; }
ul, li { list-style: none; padding: 0; margin: 0; font-family: GT Walsheim, sans serif; font-weight: 700; font-size: 24px; }
ul { position: relative; width: 300px; }
li { border-radius: 10px; margin-bottom: 10px; width: 100%; padding: 20px; position: relative; background: white; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
li svg { width: 18px; height: 18px; cursor: grab; }
`);

type Box = { height: number; left: number; top: number; width: number };
const within = (assert: Assert, sel: string, e: Box) =>
  should(assert, (a) => {
    const r = $(sel).getBoundingClientRect();
    for (const k of ['left', 'top', 'width', 'height'] as const) {
      a.true(Math.abs(r[k] - e[k]) <= 2, `${k} ${r[k]} within 2 of ${e[k]}`);
    }
  });

module('Integration | motion | cypress | Drag to reorder', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('Y axis', async function (assert) {
    await render(<template><ReorderList /></template>);
    await wait(50);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 174,
      width: 340,
    });
    await within(assert, '#Cucumber', {
      height: 68,
      left: 350,
      top: 253,
      width: 340,
    });
    trigger('#Tomato', 'pointerdown', 360, 175);
    await wait(50);
    trigger('#Tomato', 'pointermove', 360, 180);
    await wait(50);
    trigger('#Tomato', 'pointermove', 360, 200);
    await wait(50);
    trigger('#Tomato', 'pointermove', 360, 220);
    await wait(100);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 249,
      width: 340,
    });
    await within(assert, '#Cucumber', {
      height: 68,
      left: 350,
      top: 174,
      width: 340,
    });
    trigger('#Tomato', 'pointerup', 360, 220);
    await wait(100);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 252,
      width: 340,
    });
    trigger('#Cucumber', 'pointerdown', 360, 175);
    await wait(50);
    trigger('#Cucumber', 'pointermove', 360, 180);
    await wait(50);
    trigger('#Cucumber', 'pointermove', 360, 200);
    await wait(50);
    trigger('#Cucumber', 'pointermove', 360, 220);
    await wait(100);
    await within(assert, '#Cucumber', {
      height: 68,
      left: 350,
      top: 249,
      width: 340,
    });
    trigger('#Cucumber', 'pointerup', 360, 220);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 175,
      width: 340,
    });
    trigger('#Tomato', 'pointerdown', 360, 0);
    await wait(100);
    trigger('#Tomato', 'pointermove', 360, -100);
    await wait(100);
    trigger('#Tomato', 'pointerup', 360, -100);
    await wait(20);
    trigger('#Tomato', 'pointerdown', 360, -100);
    await wait(50);
    trigger('#Tomato', 'pointerup', 360, -100);
    await wait(100);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 176,
      width: 340,
    });
  });

  test('X axis', async function (assert) {
    await render(<template><ReorderList @axis="x" /></template>);
    await wait(50);
    await within(assert, '#Tomato', {
      height: 68,
      left: 350,
      top: 291,
      width: 340,
    });
    await within(assert, '#Cucumber', {
      height: 68,
      left: 690,
      top: 291,
      width: 340,
    });
    trigger('#Tomato', 'pointerdown', 360, 175);
    await wait(50);
    trigger('#Tomato', 'pointermove', 365, 175);
    await wait(50);
    trigger('#Tomato', 'pointermove', 425, 175);
    await wait(50);
    trigger('#Tomato', 'pointermove', 475, 175);
    await wait(100);
    await within(assert, '#Tomato', {
      height: 68,
      left: 535,
      top: 291,
      width: 340,
    });
    await within(assert, '#Cucumber', {
      height: 68,
      left: 350,
      top: 291,
      width: 340,
    });
    trigger('#Tomato', 'pointerup');
  });

  test('Move around', async function (assert) {
    await render(<template><ReorderList /></template>);
    await wait(50);
    const box = () =>
      within(assert, '#Tomato', {
        height: 68,
        left: 350,
        top: 174,
        width: 340,
      });
    await box();
    const baseY = 175,
      delta = 20;
    trigger('#Tomato', 'pointerdown', 360, baseY);
    await wait(150);
    for (const step of [-4, 14, -8, 4, -5, 2, -6]) {
      for (let i = 0; i < Math.abs(step); i++) {
        trigger(
          '#Tomato',
          'pointermove',
          360,
          baseY + (step > 0 ? delta : -delta)
        );
        await wait(150);
      }
    }
    trigger('#Tomato', 'pointerup', 360, baseY);
    await wait(150);
    await box();
  });
});

module(
  'Integration | motion | cypress | Reorder release before the next frame',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('Reorders when the final move arrives in the same frame as pointerup', async function (assert) {
      await render(<template><ReorderList /></template>);
      const cucumber = $('#Cucumber').getBoundingClientRect();
      await nextFrame();
      await nextFrame();
      const tomato = $('#Tomato').getBoundingClientRect();
      const x = tomato.left + 10;
      pointerAt($('#Tomato'), 'pointerdown', x, tomato.top + 10);
      pointerAt($('#Tomato'), 'pointermove', x, tomato.top + 15);
      await nextFrame();
      pointerAt($('#Tomato'), 'pointermove', x, tomato.top + 35);
      await nextFrame();
      // 55px down: past Cucumber's centre, released within the frame
      const y = tomato.top + 65;
      pointerAt($('#Tomato'), 'pointermove', x, y);
      pointerAt($('#Tomato'), 'pointerup', x, y);

      await should(assert, (a) => {
        const el = $('#Tomato');
        const ids = [...el.parentElement!.children]
          .map((child) => child.id)
          .filter(Boolean);
        a.strictEqual(ids.slice(0, 2).join(), 'Cucumber,Tomato', 'order');
        a.closeTo(el.getBoundingClientRect().top, cucumber.top, 2, 'Tomato');
      });
      await should(assert, (a) =>
        a.closeTo(
          $('#Cucumber').getBoundingClientRect().top,
          tomato.top,
          2,
          'Cucumber'
        )
      );
    });
  }
);
