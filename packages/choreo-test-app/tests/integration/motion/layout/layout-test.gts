/**
 * Port of Motion's packages/framer-motion/cypress/integration/layout.ts (motion@bbabb00) with its fixtures from
 * dev/react/src/tests/*. Each fixture is a Glimmer component; `?param=` becomes a component arg.
 * cy.visit → render, .trigger("click")/.click() → click(), .wait → wait, .should → should (retrying).
 * <MotionConfig transition> (layout-crossfade) is not part of the binding: the transition is passed
 * to each motion element directly, which is what the context resolves to.
 */
import { on } from '@ember/modifier';
import { click, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import { motionValue } from 'motion-dom';
import { module, test } from 'qunit';

import {
  $,
  expectBbox,
  setupFixtureViewport,
  should,
  wait,
} from '../../../helpers/layout-fixture';

const keyOf = (it: { key: string }) => it.key;
const BOX = { position: 'absolute', top: 0, left: 0, background: 'red' };
const A = { ...BOX, width: 100, height: 200 };
const B = { ...BOX, top: 100, left: 200, width: 300, height: 300 };

/* ---------- layout.tsx ---------- */
class Layout extends Component<{ Args: { type?: string } }> {
  @tracked state = true;
  backgroundColor = motionValue('red');
  transition = { duration: 0.5, ease: () => 0.5 };
  get layout() {
    return (this.args.type ?? true) as true | 'position' | 'size' | 'x' | 'y';
  }
  get style() {
    return { ...(this.state ? A : B), backgroundColor: this.backgroundColor };
  }
  toggle = () => {
    this.state = !this.state;
  };
  onStart = () => this.backgroundColor.set('green');
  onComplete = () => this.backgroundColor.set('blue');
  <template>
    <div
      id="box"
      {{motion
        layout=this.layout
        style=this.style
        transition=this.transition
        onLayoutAnimationStart=this.onStart
        onLayoutAnimationComplete=this.onComplete
      }}
      {{on "click" this.toggle}}
    ></div>
  </template>
}

/* ---------- layout-block-interrupt.tsx ---------- */
class BlockInterrupt extends Component {
  @tracked count = 0;
  transition = { duration: 10, ease: () => 0.5 };
  get style() {
    return this.count === 0 ? A : B;
  }
  bump = () => {
    this.count++;
  };
  <template>
    <div
      id="box"
      {{motion layout=true style=this.style transition=this.transition}}
      {{on "click" this.bump}}
    ></div>
  </template>
}

/* ---------- layout-dependency.tsx ---------- */
class Dependency extends Component {
  @tracked state = true;
  backgroundColor = motionValue('red');
  transition = { duration: 0.15, ease: () => 0.5 };
  get style() {
    return { ...(this.state ? A : B), backgroundColor: this.backgroundColor };
  }
  toggle = () => {
    this.state = !this.state;
  };
  onComplete = () => this.backgroundColor.set('blue');
  <template>
    <div
      id="box"
      {{motion
        layout=true
        layoutDependency=0
        style=this.style
        transition=this.transition
        onLayoutAnimationComplete=this.onComplete
      }}
      {{on "click" this.toggle}}
    ></div>
  </template>
}

/* ---------- layout-dependency-child.tsx ---------- */
const COMMON = {
  position: 'absolute',
  boxSizing: 'border-box',
  left: 25,
  width: 100,
  height: 25,
  backgroundColor: 'blue',
} as const;
const CHILD_VARIANTS = {
  visible: { opacity: 1, ...COMMON },
  hidden: { opacity: 0, ...COMMON },
};
class DependencyChild extends Component {
  @tracked divState = false;
  @tracked animating = false;
  @tracked transitionId = 0;
  duration = 10;
  transition = { duration: 10, ease: () => 0.5 };
  childTransition = { duration: 10, ease: () => 0.5, repeatDelay: 0.001 };
  get dep() {
    return this.animating ? this.transitionId : -1;
  }
  get items() {
    return this.divState ? [] : [{ key: 'child' }];
  }
  onComplete = () => {
    this.animating = false;
  };
  animate = () => {
    this.divState = !this.divState;
    this.transitionId++;
    this.animating = true;
  };
  <template>
    <div
      class={{if this.divState "outerAnimate" "outer"}}
      {{motion
        layoutDependency=this.dep
        layout=true
        onAnimationComplete=this.onComplete
        transition=this.transition
      }}
    >
      <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
        <div
          id="child"
          {{motion
            presence=h
            layout=true
            layoutDependency=this.dep
            variants=CHILD_VARIANTS
            animate="visible"
            exit="hidden"
            initial="hidden"
            transition=this.childTransition
          }}
        ></div>
      </Presence>
    </div>
    <button
      type="button"
      style="position:absolute;right:10px;top:10px"
      {{on "click" this.animate}}
    >Animate</button>
    <style>
      .outer {
        width: 200px;
        height: 100px;
        top: 10px;
        left: 10px;
        position: absolute;
        background-color: red;
        overflow: visible;
      }
      .outerAnimate {
        width: 100px;
        height: 75px;
        top: 10px;
        left: 10px;
        position: absolute;
        background-color: red;
        overflow: visible;
      }
    </style>
  </template>
}

/* ---------- layout-shared-dependency.tsx ---------- */
class Items extends Component {
  @tracked selected = 0;
  backgroundColor = motionValue('#f00');
  transition = { duration: 0.5, ease: () => 0.5 };
  get style() {
    return {
      width: 100,
      height: 100,
      backgroundColor: this.backgroundColor,
      borderRadius: 10,
    };
  }
  pick0 = () => {
    this.selected = 0;
  };
  pick1 = () => {
    this.selected = 1;
  };
  onStart = () => this.backgroundColor.set('#0f0');
  onComplete = () => this.backgroundColor.set('#00f');
  <template>
    <article style="margin-bottom:20px">
      <button type="button" id="jump-0" {{on "click" this.pick0}}>Jump here</button>
      {{#if (eq this.selected 0)}}<div
          id="box"
          {{motion
            layoutId="box"
            layoutDependency=this.selected
            style=this.style
            transition=this.transition
            onLayoutAnimationStart=this.onStart
            onLayoutAnimationComplete=this.onComplete
          }}
        ></div>{{/if}}
    </article>
    <article>
      <button type="button" id="jump-1" {{on "click" this.pick1}}>Jump here</button>
      {{#if (eq this.selected 1)}}<div
          {{! template-lint-disable no-duplicate-id }}
          id="box"
          {{motion
            layoutId="box"
            layoutDependency=this.selected
            style=this.style
            transition=this.transition
            onLayoutAnimationStart=this.onStart
            onLayoutAnimationComplete=this.onComplete
          }}
        ></div>{{/if}}
    </article>
  </template>
}
class SharedDependency extends Component {
  @tracked section: 'a' | 'b' = 'a';
  toA = () => {
    this.section = 'a';
  };
  toB = () => {
    this.section = 'b';
  };
  <template>
    <div style="position:relative">
      <div style="margin-bottom:20px">
        <button type="button" id="section-a-btn" {{on "click" this.toA}}>Section
          A</button>
        <button
          type="button"
          id="section-b-btn"
          style="margin-left:10px"
          {{on "click" this.toB}}
        >Section B</button>
      </div>
      {{#if (eq this.section "a")}}<div id="section-a"><p>Section A Header</p><Items
          /></div>{{/if}}
      {{#if (eq this.section "b")}}<div id="section-b"><Items /></div>{{/if}}
    </div>
  </template>
}

/* ---------- layout-scaled-child-in-transformed-parent.tsx ---------- */
const SC_BOX = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  background: 'red',
};
class ScaledChild extends Component {
  @tracked hover = false;
  transition = { duration: 0.2, ease: () => 0.5 };
  get style() {
    return this.hover ? { ...SC_BOX, left: 50 } : SC_BOX;
  }
  toggle = () => {
    this.hover = !this.hover;
  };
  <template>
    <div style="width:400px;height:400px;position:relative" {{motion}}>
      <div
        id="parent"
        style="position:absolute;width:100px;height:100px;left:50%;top:50%;transform:translateY(-50%)"
        {{motion layout=true}}
      >
        <div
          id="mid"
          style="width:100%;height:100%;position:relative"
          {{motion layout=true}}
        >
          <div
            id="box"
            {{motion layout=true style=this.style transition=this.transition}}
            {{on "click" this.toggle}}
          ></div>
        </div>
      </div>
    </div>
  </template>
}

/* ---------- layout-repeat-new.tsx ---------- */
const REPEAT_STYLE = { background: 'red', width: '100%', height: '100px' };
const REPEAT_T = {
  duration: 0.25,
  delay: 0.3,
  ease: [0.2, 0.0, 0.83, 0.83] as [number, number, number, number],
  layout: {
    duration: 0.3,
    ease: [0.2, 0.0, 0.83, 0.83] as [number, number, number, number],
  },
};
class RepeatNew extends Component {
  @tracked count = 0;
  get items() {
    return Array.from({ length: this.count }, (_, i) => ({
      key: String(i),
      i,
    })).reverse();
  }
  add = () => {
    this.count++;
  };
  reset = () => {
    this.count = 0;
  };
  <template>
    <div style="height:50px">
      <button type="button" id="add" {{on "click" this.add}}>Add item</button>
      <button type="button" id="reset" {{on "click" this.reset}}>Reset</button>
    </div>
    <div
      style="display:grid;grid-template-columns:repeat(auto-fill, minmax(127px, 1fr));grid-gap:10px;min-height:100px;width:500px"
    >
      {{#each this.items key="key" as |it|}}<div
          id="box-{{it.i}}"
          {{motion layout=true style=REPEAT_STYLE transition=REPEAT_T}}
        >{{it.i}}</div>{{/each}}
    </div>
  </template>
}

/* ---------- layout-portal.tsx ---------- */
class Portal extends Component {
  @tracked count = 0;
  body = document.body;
  transition = { duration: 10, ease: () => 0.5 };
  get style() {
    const size = this.count === 0 ? 100 : 300;
    return { background: 'red', width: size, height: size };
  }
  bump = () => {
    this.count++;
  };
  <template>
    <div
      id="parent"
      {{motion layout=true style=this.style transition=this.transition}}
      {{on "click" this.bump}}
    >
      {{#in-element this.body insertBefore=null}}
        <div
          id="child"
          data-framer-portal-id="parent"
          style="width:100px;height:100px;background:blue"
          {{motion layout=true transition=this.transition}}
        ></div>
      {{/in-element}}
    </div>
  </template>
}

/* ---------- layout-rerender.tsx ---------- */
const RR_BOX = { position: 'absolute', top: 100, left: 100, background: 'red' };
const RR_A = { ...RR_BOX, width: 100, height: 200 };
const RR_B = { ...RR_BOX, top: 100, left: 200, width: 300, height: 300 };
class Rerender extends Component<{ Args: { parent?: boolean } }> {
  @tracked state = 0;
  @tracked renderCount = 0;
  backgroundColor = motionValue('red');
  transition = { duration: 1 };
  get outerStyle() {
    return { position: 'relative', width: 500, height: this.state ? 500 : 400 };
  }
  get style() {
    return {
      ...(this.state ? RR_A : RR_B),
      backgroundColor: this.backgroundColor,
    };
  }
  update = () => {
    this.state++;
    if (this.state === 1) {
      setTimeout(() => {
        this.state = 2;
      }, 50);
    }
  };
  onStart = () => {
    this.renderCount++;
  };
  <template>
    <button type="button" {{on "click" this.update}}>Update</button>
    <pre id="render-count">{{this.renderCount}}</pre>
    <div {{motion layout=(if @parent true false) style=this.outerStyle}}>
      <div
        id="box"
        {{motion
          layout=true
          style=this.style
          transition=this.transition
          onLayoutAnimationStart=this.onStart
        }}
      ></div>
    </div>
  </template>
}

/* ---------- layout-crossfade.tsx ---------- */
const CF_T = { duration: 10, ease: () => 0.25 };
class Crossfade extends Component {
  @tracked state = false;
  get items() {
    return this.state ? [{ key: 'box' }] : [];
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <div style="display:flex;gap:100px">
      <div
        style="width:100px;height:100px;background:red"
        {{motion layoutId="box" transition=CF_T}}
      ></div>
      <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
        <div
          id="box"
          style="width:100px;height:100px;background:blue"
          {{motion
            presence=h
            layoutId="box"
            layoutCrossfade=false
            transition=CF_T
          }}
        ></div>
      </Presence>
    </div>
    <button type="button" {{on "click" this.toggle}}>Toggle</button>
  </template>
}

function eq(a: unknown, b: unknown) {
  return a === b;
}

module('Integration | motion | cypress | Layout animation', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('Correctly fires layout={true} animations and fires onLayoutAnimationStart and onLayoutAnimationComplete', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Layout /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      a.strictEqual($('#box').style.backgroundColor, 'green')
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 50, left: 100, width: 200, height: 250 })
    );
    await wait(1000);
    await should(assert, (a) =>
      a.strictEqual($('#box').style.backgroundColor, 'blue')
    );
  });

  test('It correctly fires layout="position" animations', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Layout @type="position" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 50, left: 100, width: 300, height: 300 })
    );
  });

  test('It correctly fires layout="size" animations', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Layout @type="size" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(100);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 100, left: 200, width: 200, height: 250 })
    );
  });

  test("Doesn't initiate a new animation if the viewport box hasn't updated between renders", async function (assert) {
    await render(
      <template>
        <LayoutGroup><BlockInterrupt /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 50, left: 100, width: 200, height: 250 })
    );
    // The easing curve is set to always return t=0.5, so if this box moves it means a new animation has started
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 50, left: 100, width: 200, height: 250 })
    );
  });

  test("Doesn't initiate a new animation if layoutDependency hasn't changed", async function (assert) {
    await render(
      <template>
        <LayoutGroup><Dependency /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { height: 300, left: 200, top: 100, width: 300 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
  });

  test('Exiting children correctly animate when layoutDependency changes', async function (assert) {
    await render(
      <template>
        <LayoutGroup><DependencyChild /></LayoutGroup>
      </template>
    );
    await wait(50);
    const initial = $('#child').getBoundingClientRect();
    await click('button');
    await wait(100);
    // Cypress asserts exact equality; the exiting child's projection transform leaves ~1e-6px of float
    // noise in the rect here, so the port allows 0.01px
    await should(assert, (a) => {
      const after = $('#child').getBoundingClientRect();
      a.closeTo(after.top, initial.top, 0.01, 'top');
      a.closeTo(after.left, initial.left, 0.01, 'left');
      a.closeTo(after.width, initial.width, 0.01, 'width');
      a.closeTo(after.height, initial.height, 0.01, 'height');
    });
  });

  test("Doesn't animate shared layout components when layoutDependency hasn't changed (issue #1436)", async function (assert) {
    await render(
      <template>
        <LayoutGroup><SharedDependency /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      a.strictEqual(
        getComputedStyle($('#box')).backgroundColor,
        'rgb(255, 0, 0)'
      )
    );
    await click('#section-b-btn');
    await wait(50);
    await should(assert, (a) =>
      a.strictEqual(
        getComputedStyle($('#box')).backgroundColor,
        'rgb(255, 0, 0)'
      )
    );
    await click('#jump-1');
    await wait(50);
    await should(assert, (a) =>
      a.notStrictEqual(
        getComputedStyle($('#box')).backgroundColor,
        'rgb(255, 0, 0)'
      )
    );
  });

  test('Has a correct bounding box when a transform is applied', async function (assert) {
    await render(
      <template>
        <LayoutGroup><ScaledChild /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { height: 100, left: 200, top: 150, width: 100 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { height: 100, left: 225, top: 150, width: 75 })
    );
  });

  test('Newly-entering elements animate as expected', async function (assert) {
    await render(
      <template>
        <LayoutGroup><RepeatNew /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#add');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box-0'), { top: 50, left: 0, width: 160, height: 100 })
    );
    await click('#add');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box-1'), { top: 50, left: 0, width: 160, height: 100 })
    );
    await should(assert, (a) =>
      a.notStrictEqual($('#box-0').getBoundingClientRect().left, 170)
    );
    await click('#reset');
    await wait(50);
    await click('#add');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box-0'), { top: 50, left: 0, width: 160, height: 100 })
    );
    await click('#add');
    await wait(50);
    await should(assert, (a) =>
      a.notStrictEqual($('#box-0').getBoundingClientRect().left, 170)
    );
  });

  test("Elements within portal don't perform scale correction on parents", async function (assert) {
    await render(
      <template>
        <LayoutGroup><Portal /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#parent'), { top: 0, left: 0, width: 100, height: 100 })
    );
    // the portal lands at the end of <body>, below the fixture viewport; measure it relative to the parent's column
    const childTop = () =>
      $('#child').getBoundingClientRect().top -
      $('#parent').getBoundingClientRect().top -
      0;
    await should(assert, (a) => {
      const r = $('#child').getBoundingClientRect();
      a.strictEqual(r.width, 100);
      a.strictEqual(r.height, 100);
      a.strictEqual(r.left, 0);
    });
    const before = childTop();
    await click('#parent');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#parent'), { top: 0, left: 0, width: 200, height: 200 })
    );
    await wait(50);
    await should(assert, (a) => {
      const r = $('#child').getBoundingClientRect();
      a.strictEqual(r.width, 100);
      a.strictEqual(r.height, 100);
      a.strictEqual(r.left, 0);
      a.strictEqual(childTop(), before);
    });
  });

  test("A new layout animation isn't started if the target doesn't change", async function (assert) {
    await render(
      <template>
        <LayoutGroup><Rerender /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('button');
    await wait(200);
    await should(assert, (a) =>
      a.strictEqual($('#render-count').textContent, '1')
    );
  });

  test("A new layout animation isn't started if the target doesn't change, even if parent starts layout animation", async function (assert) {
    await render(
      <template>
        <LayoutGroup><Rerender @parent={{true}} /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('button');
    await wait(200);
    await should(assert, (a) =>
      a.strictEqual($('#render-count').textContent, '1')
    );
  });

  test('It correctly fires layout="x" animations, only animating the x axis', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Layout @type="x" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 100, left: 100, width: 200, height: 300 })
    );
  });

  test('It correctly fires layout="y" animations, only animating the y axis', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Layout @type="y" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), { top: 50, left: 200, width: 300, height: 250 })
    );
  });

  test('Disabling crossfade works as expected', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Crossfade /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('button');
    await wait(200);
    await should(assert, (a) => a.strictEqual($('#box').style.opacity, '1'));
    await click('button');
    await wait(200);
    await settled();
    await should(assert, (a) => a.strictEqual($('#box').style.opacity, '1'));
  });
});
