/**
 * Ports of the remaining Motion drag Cypress specs (motion@bbabb00 unless noted):
 * drag-input-propagation, drag-momentum, drag-framer-page, drag-rotated-parent, drag-scaled-parent,
 * drag-scroll-while-drag, drag-ref-constraints-{absolute-scrolled,element-resize,resize-handle},
 * drag-snap-animate-presence-exit, drag-snap-layout-id-swap, drag-layout-reorder-strict,
 * drag-snap-to-cursor-initial and drag-release-before-frame (motion@v13.4.6).
 * React refs → {current} refs filled by {{captureEl}}; MotionConfig transformPagePoint → the arg on the
 * draggable; window.expandFolder/hoverFolder → a module-level handle the fixture component fills.
 */
import type { TOC } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { createDragControls } from 'glimmer-motion/gestures/drag-controls';
import { correctParentTransform } from 'glimmer-motion/gestures/transform-page-point';
import { layoutChange } from 'glimmer-motion/layout';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import { setupMotion } from 'glimmer-motion/test-support';
import { motionValue, type PanInfo, transformValue } from 'motion-dom';
import { module, test } from 'qunit';

import {
  captureEl,
  createRef,
  scrollWindowTo,
} from '../../../helpers/capture-el';
import {
  $,
  expectBbox,
  pointerAt,
  setupFixtureViewport,
  should,
  trigger,
  wait,
} from '../../../helpers/layout-fixture';
import { nextFrame } from '../../../helpers/motion';

const D = "[data-testid='draggable']";
const rect = (sel = D) => $(sel).getBoundingClientRect();

/* ---------- drag-input-propagation.tsx ---------- */
const PROP_BOX = {
  width: 400,
  height: 200,
  background: 'red',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 10,
};
const InputPropagation = <template>
  <div style="padding:100px">
    <div
      id="draggable"
      data-testid="draggable"
      {{motion drag=true dragElastic=0 dragMomentum=false style=PROP_BOX}}
    >
      <input
        type="text"
        aria-label="input"
        data-testid="input"
        value="Select me"
        style="width:80px;height:30px;padding:5px"
      />
      <textarea
        aria-label="textarea"
        data-testid="textarea"
        style="width:60px;height:30px;padding:5px"
      >Text</textarea>
      <button
        type="button"
        data-testid="button"
        style="width:60px;height:30px;padding:5px"
      >Click</button>
      <a
        href="#test"
        data-testid="link"
        style="display:inline-block;width:60px;height:30px;padding:5px;background:white"
      >Link</a>
      <select
        aria-label="select"
        data-testid="select"
        style="width:80px;height:30px"
      ><option value="1">Option 1</option><option value="2">Option 2</option><option
          value="3"
        >Option 3</option></select>
      <label
        data-testid="label"
        style="display:flex;align-items:center;gap:5px;background:white;padding:5px"
      ><input type="checkbox" data-testid="checkbox" /> Check</label>
      <div
        contenteditable="true"
        data-testid="contenteditable"
        style="width:80px;height:30px;padding:5px;background:white"
      >Edit me</div>
    </div>
  </div>
</template>;

module(
  'Integration | motion | cypress | Drag Input Propagation',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    const atStart = (assert: Assert) =>
      should(assert, (a) => {
        const r = rect();
        a.strictEqual(r.left, 100);
        a.strictEqual(r.top, 100);
      });
    const moved = (assert: Assert) =>
      should(assert, (a) => {
        const r = rect();
        a.true(r.left > 200, `left ${r.left}`);
        a.true(r.top > 200, `top ${r.top}`);
      });
    async function dragOn(sel: string, x = 5, y = 5, nx = 10, ny = 10) {
      trigger(sel, 'pointerdown', x, y);
      trigger(sel, 'pointermove', nx, ny);
      await wait(50);
      trigger(sel, 'pointermove', 200, 200);
      await wait(50);
      trigger(sel, 'pointerup');
    }

    for (const [name, sel, expectMove] of [
      ['an input', "[data-testid='input']", false],
      ['a textarea', "[data-testid='textarea']", false],
      ['a button', "[data-testid='button']", true],
      ['a link', "[data-testid='link']", true],
      ['a select', "[data-testid='select']", false],
      ['a checkbox inside a label', "[data-testid='checkbox']", false],
      ['a contenteditable element', "[data-testid='contenteditable']", false],
    ] as [string, string, boolean][]) {
      test(`Should ${expectMove ? '' : 'not '}drag when clicking and dragging on ${name} inside draggable`, async function (assert) {
        await render(
          <template>
            <LayoutGroup><InputPropagation /></LayoutGroup>
          </template>
        );
        await wait(200);
        await atStart(assert);
        if (sel.includes('checkbox')) {
          await dragOn(sel, 2, 2, 5, 5);
        } else {
          await dragOn(sel);
        }
        if (expectMove) {
          await moved(assert);
        } else {
          await atStart(assert);
        }
      });
    }

    test('Should still drag when clicking on the draggable area outside interactive elements', async function (assert) {
      await render(
        <template>
          <LayoutGroup><InputPropagation /></LayoutGroup>
        </template>
      );
      await wait(200);
      await atStart(assert);
      await dragOn(D);
      await moved(assert);
    });
  }
);

/* ---------- drag-momentum.tsx ---------- */
const MOMENTUM_INITIAL = {
  width: 50,
  height: 1000,
  background: 'red',
  x: 0,
  y: 0,
};
const Momentum = <template>
  <div style="height:2000px;padding-top:100px">
    <div
      id="box"
      data-testid="draggable"
      {{motion drag=true dragMomentum=true initial=MOMENTUM_INITIAL}}
    ></div>
  </div>
</template>;

module('Integration | motion | cypress | Drag Momentum', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks, { scroll: true });

  test('Fast flick after hold produces momentum', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Momentum /></LayoutGroup>
      </template>
    );
    await wait(400);
    trigger(D, 'pointerdown', 25, 900);
    await wait(300); // Simulate holding before flick
    trigger(D, 'pointermove', 25, 895);
    await wait(50);
    trigger(D, 'pointermove', 25, 800);
    await wait(50);
    trigger(D, 'pointerup');
    await wait(500);
    await should(assert, (a) => {
      const { top } = rect();
      a.true(top < -200, `top ${top}`);
    });
  });

  test('Catch-and-release stops momentum', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Momentum /></LayoutGroup>
      </template>
    );
    await wait(400);
    trigger(D, 'pointerdown', 25, 900);
    trigger(D, 'pointermove', 25, 895);
    await wait(50);
    trigger(D, 'pointermove', 25, 700);
    await wait(50);
    trigger(D, 'pointerup');
    await wait(100);
    const caughtTop = Math.round(rect().top);
    trigger(D, 'pointerdown', 25, 500);
    await wait(50);
    trigger(D, 'pointerup');
    await wait(500);
    await should(assert, (a) => {
      const { top } = rect();
      a.true(
        Math.abs(top - caughtTop) < 50,
        `top ${top} vs caught ${caughtTop}`
      );
    });
  });
});

/* ---------- drag-framer-page.tsx ---------- */
const SCROLL_CONTAINER = {
  position: 'absolute',
  top: 100,
  left: 100,
  width: 200,
  height: 500,
  overflow: 'hidden',
};
const PARENT_B = {
  background: '#ff0055',
  top: 100,
  left: 100,
  width: '100%',
  height: 500,
  borderRadius: 10,
};
const PAGE_ITEM = {
  width: 180,
  height: 180,
  background: '#ffcc00',
  borderRadius: 10,
  flex: '0 0 180px',
};
const PAGE_C = {
  position: 'relative',
  top: 50,
  left: 50,
  width: 100,
  height: 100,
  background: '#ffaa00',
  borderRadius: 10,
};
class FramerPage extends Component {
  x = motionValue(0);
  y = motionValue(0);
  dummyX = motionValue(0);
  dummyY = motionValue(0);
  pageStyle = {
    display: 'flex',
    flexDirection: 'row',
    width: 180,
    height: 180,
    position: 'relative',
    top: 300,
    left: 10,
    x: this.x,
    y: this.y,
  };
  ids = ['a', 'b', undefined, undefined];
  <template>
    <div {{motion style=SCROLL_CONTAINER layout=true}}>
      <div
        id="parent"
        {{motion style=PARENT_B drag="y" _dragX=this.dummyX _dragY=this.dummyY}}
      >
        <div id="Page" {{motion style=this.pageStyle layout=true}}>
          {{#each this.ids as |id|}}
            <div
              id={{id}}
              {{motion
                layout=true
                _dragX=this.x
                _dragY=this.y
                drag="x"
                style=PAGE_ITEM
              }}
            >
              <div {{motion layout=true style=PAGE_C}}></div>
            </div>
          {{/each}}
        </div>
      </div>
    </div>
  </template>
}

module('Integration | motion | cypress | Nested Scroll/Page', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('correctly positions children after dragging', async function (assert) {
    await render(
      <template>
        <LayoutGroup><FramerPage /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 400, left: 110 })
    );
    trigger('#a', 'pointerdown', 60, 60);
    trigger('#a', 'pointermove', 50, 50);
    await wait(50);
    trigger('#a', 'pointermove', 10, 10);
    await wait(200);
    trigger('#a', 'pointerup');
    await wait(70);
    await should(assert, (a) => expectBbox(a, $('#a'), { top: 400, left: 50 }));
    trigger('#b', 'pointerdown', 60, 60);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#a'), { top: 400, left: 50 }));
    trigger('#b', 'pointerup');
  });
});

/* ---------- drag-rotated-parent.tsx / drag-scaled-parent.tsx ---------- */
const ROTATED = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 400,
  height: 400,
  rotate: 180,
};
const SMALL_RED = { width: 100, height: 100, background: 'red' };
class RotatedParent extends Component {
  ref = createRef<HTMLDivElement>();
  transformPagePoint = correctParentTransform(this.ref);
  <template>
    <div {{motion style=ROTATED}} {{captureEl this.ref}}>
      <div
        data-testid="draggable"
        {{motion
          drag=true
          dragElastic=0
          dragMomentum=false
          style=SMALL_RED
          transformPagePoint=this.transformPagePoint
        }}
      ></div>
    </div>
  </template>
}
class ScaledParent extends Component<{ Args: { scale?: number } }> {
  ref = createRef<HTMLDivElement>();
  transformPagePoint = correctParentTransform(this.ref);
  get style() {
    return `width:800px;height:800px;background:blue;transform:scale(${this.args.scale ?? 0.5});transform-origin:top left`;
  }
  <template>
    <div id="container" style={{this.style}} {{captureEl this.ref}}>
      <div
        data-testid="draggable"
        {{motion
          drag=true
          dragElastic=0
          dragMomentum=false
          style=SMALL_RED
          transformPagePoint=this.transformPagePoint
        }}
      ></div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | Drag with rotated parent',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('Element follows cursor when parent is rotated 180deg', async function (assert) {
      await render(
        <template>
          <LayoutGroup><RotatedParent /></LayoutGroup>
        </template>
      );
      await wait(300);
      trigger(D, 'pointerdown', 50, 50);
      trigger(D, 'pointermove', 55, 55);
      await wait(50);
      trigger(D, 'pointermove', 150, 50);
      await wait(50);
      trigger(D, 'pointerup');
      // starts at left=300; cursor moved right, so the element moves right too (the bug would give ≈205)
      await should(assert, (a) => {
        const { left } = rect();
        a.true(left > 350, `left ${left}`);
      });
    });
  }
);

module(
  'Integration | motion | cypress | Drag with scaled parent',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    for (const scale of [0.5, 2]) {
      test(`Element follows cursor when parent has scale(${scale})`, async function (assert) {
        await render(
          <template>
            <LayoutGroup><ScaledParent @scale={{scale}} /></LayoutGroup>
          </template>
        );
        await wait(300);
        trigger(D, 'pointerdown', 10, 10);
        trigger(D, 'pointermove', 15, 15);
        await wait(50);
        trigger(D, 'pointermove', 110, 110);
        await wait(50);
        trigger(D, 'pointerup');
        await should(assert, (a) => {
          const { left, top } = rect();
          a.true(left > 80 && left < 120, `left ${left}`);
          a.true(top > 80 && top < 120, `top ${top}`);
        });
      });
    }
  }
);

/* ---------- drag-scroll-while-drag.tsx ---------- */
const BOX_STYLE = {
  width: 100,
  height: 100,
  background: '#ff0066',
  borderRadius: 10,
};
const ScrollWhileDrag: TOC<{ Args: { window?: boolean } }> = <template>
  {{#if @window}}
    <div
      style="height:2000px;width:100%;padding-top:50px;padding-left:50px;background:#f0f0f0"
    >
      <div
        id="draggable"
        data-testid="draggable"
        {{motion drag=true dragElastic=0 dragMomentum=false style=BOX_STYLE}}
      ></div>
    </div>
  {{else}}
    <div
      id="scrollable"
      data-testid="scrollable"
      style="position:fixed;top:0;left:0;width:500px;height:400px;overflow:auto;background:#f0f0f0"
    >
      <div style="height:1500px;width:800px;padding-top:50px;padding-left:50px">
        <div
          id="draggable"
          data-testid="draggable"
          {{motion drag=true dragElastic=0 dragMomentum=false style=BOX_STYLE}}
        ></div>
      </div>
    </div>
  {{/if}}
</template>;

for (const win of [false, true]) {
  module(
    `Integration | motion | cypress | Drag with ${win ? 'window' : 'element'} scroll during drag`,
    function (hooks) {
      setupRenderingTest(hooks);
      setupMotion(hooks);
      setupFixtureViewport(hooks, { scroll: true });
      const scrollBy = (amount: number) => {
        if (win) {
          window.scrollTo(0, amount);
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        } else {
          $("[data-testid='scrollable']").scrollTop = amount;
        }
      };
      async function startDrag() {
        trigger(D, 'pointerdown', 50, 50);
        trigger(D, 'pointermove', 55, 55);
        await wait(50);
        trigger(D, 'pointermove', 100, 100);
        await wait(50);
      }

      test(`Element stays at same viewport position during ${win ? 'window ' : ''}scroll (no pointer move)`, async function (assert) {
        await render(
          <template>
            <LayoutGroup><ScrollWhileDrag @window={{win}} /></LayoutGroup>
          </template>
        );
        await wait(200);
        await startDrag();
        const before = rect();
        scrollBy(100);
        await wait(100);
        const after = rect();
        if (win) {
          assert.true(after.top > -50 && after.top < 200, `top ${after.top}`);
        } else {
          assert.true(
            Math.abs(after.top - before.top) <= 15,
            `top ${before.top} → ${after.top}`
          );
          assert.true(
            Math.abs(after.left - before.left) <= 15,
            `left ${before.left} → ${after.left}`
          );
        }
        trigger(D, 'pointerup');
      });

      test(`${win ? 'Window' : 'Element'} scroll compensation prevents large position jumps`, async function (assert) {
        await render(
          <template>
            <LayoutGroup><ScrollWhileDrag @window={{win}} /></LayoutGroup>
          </template>
        );
        await wait(200);
        await startDrag();
        scrollBy(200);
        await wait(100);
        trigger(D, 'pointermove', 100, 100);
        await wait(50);
        trigger(D, 'pointerup');
        await should(assert, (a) => {
          const { top } = rect();
          if (win) {
            a.true(top > -100 && top < 500, `top ${top}`);
          } else {
            a.true(top > 0 && top < 200, `top ${top}`);
          }
        });
      });

      test(`Element moves correctly without ${win ? 'window ' : ''}scroll`, async function (assert) {
        await render(
          <template>
            <LayoutGroup><ScrollWhileDrag @window={{win}} /></LayoutGroup>
          </template>
        );
        await wait(200);
        await startDrag();
        trigger(D, 'pointerup');
        await should(assert, (a) => {
          const { left, top } = rect();
          a.true(left > 50 && left < 200, `left ${left}`);
          a.true(top > 50 && top < 200, `top ${top}`);
        });
      });
    }
  );
}

/* ---------- drag-ref-constraints-absolute-scrolled.tsx ---------- */
const ABS_BOX = {
  width: 50,
  height: 50,
  background: 'red',
  position: 'absolute',
  top: 0,
  left: 0,
};
class AbsoluteScrolled extends Component<{ Args: { scroll?: number } }> {
  constraints = createRef<HTMLDivElement>();
  get scroll() {
    return this.args.scroll ?? 300;
  }
  <template>
    <div
      style="height:3000px;margin:0;padding:0"
      {{scrollWindowTo this.scroll}}
    >
      <div
        id="constraints"
        style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,255,0.1)"
        {{captureEl this.constraints}}
      >
        <div
          id="box"
          data-testid="draggable"
          {{motion
            drag=true
            dragConstraints=this.constraints
            dragElastic=0
            dragMomentum=false
            style=ABS_BOX
          }}
        ></div>
      </div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | Drag with ref constraints on absolute element after scroll',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks, { width: 1000, height: 800, scroll: true });

    test('Allows dragging to the visible bottom of the viewport after scroll', async function (assert) {
      await render(
        <template>
          <LayoutGroup><AbsoluteScrolled @scroll={{300}} /></LayoutGroup>
        </template>
      );
      await wait(300);
      assert.true(window.scrollY > 0, `scrollY ${window.scrollY}`);
      trigger(D, 'pointerdown', 5, 5);
      trigger(D, 'pointermove', 10, 10);
      await wait(50);
      trigger(D, 'pointermove', 900, 1500);
      await wait(50);
      trigger(D, 'pointerup');
      await wait(100);
      // viewport 1000x800, scroll 300: the constraint's visible bottom is at viewport y 500
      await should(assert, (a) => a.closeTo(rect().bottom, 500, 5, 'bottom'));
    });
  }
);

/* ---------- drag-ref-constraints-element-resize.tsx / -resize-handle.tsx ---------- */
class ElementResize extends Component {
  constraints = createRef<HTMLDivElement>();
  widthMV = motionValue(100);
  heightMV = motionValue(100);
  style = {
    width: transformValue(() => `${this.widthMV.get()}px`),
    height: transformValue(() => `${this.heightMV.get()}px`),
    background: 'red',
  };
  resize = () => {
    this.widthMV.set(300);
    this.heightMV.set(300);
  };
  <template>
    <div style="padding:0;margin:0">
      <button
        type="button"
        id="resize-trigger"
        style="position:fixed;top:10px;right:10px;z-index:10"
        {{on "click" this.resize}}
      >Resize to 300x300</button>
      <div
        id="constraints"
        style="width:500px;height:500px;background:rgba(0,0,255,0.1);position:relative"
        {{motion}}
        {{captureEl this.constraints}}
      >
        <div
          id="box"
          data-testid="draggable"
          {{motion
            drag=true
            dragConstraints=this.constraints
            dragElastic=0
            dragMomentum=false
            style=this.style
          }}
        ></div>
      </div>
    </div>
  </template>
}
const HANDLE_BOX = { width: 100, height: 100, background: 'red' };
class ResizeHandle extends Component {
  constraints = createRef<HTMLDivElement>();
  box = createRef<HTMLDivElement>();
  resize = () => {
    const el = this.box.current;
    if (el) {
      el.style.width = '300px';
      el.style.height = '300px';
    }
  };
  <template>
    <div style="padding:0;margin:0">
      <button
        type="button"
        id="resize-trigger"
        style="position:fixed;top:10px;right:10px;z-index:10"
        {{on "click" this.resize}}
      >Resize to 300x300</button>
      <div
        id="constraints"
        style="width:500px;height:500px;background:rgba(0,0,255,0.1);position:relative"
        {{motion}}
        {{captureEl this.constraints}}
      >
        <div
          id="box"
          data-testid="draggable"
          {{motion
            drag=true
            dragConstraints=this.constraints
            dragElastic=0
            dragMomentum=false
            style=HANDLE_BOX
          }}
          {{captureEl this.box}}
        ></div>
      </div>
    </div>
  </template>
}

async function dragFar(to = 600) {
  trigger('#box', 'pointerdown', 5, 5);
  trigger('#box', 'pointermove', 10, 10);
  await wait(50);
  trigger('#box', 'pointermove', to, to);
  await wait(50);
  trigger('#box', 'pointerup');
  await wait(50);
}
const inside = (assert: Assert) =>
  should(assert, (a) => {
    const { right, bottom } = rect('#box');
    a.true(right <= 502, `right ${right}`);
    a.true(bottom <= 502, `bottom ${bottom}`);
  });
const is300 = (assert: Assert) =>
  should(assert, (a) => {
    const { width, height } = rect('#box');
    a.strictEqual(width, 300);
    a.strictEqual(height, 300);
  });

module(
  'Integration | motion | cypress | Drag Constraints Update on Element Resize',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('Constrains drag correctly before resize', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ElementResize /></LayoutGroup>
        </template>
      );
      await wait(200);
      await dragFar();
      await inside(assert);
    });

    test('Updates drag constraints after draggable element is resized', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ElementResize /></LayoutGroup>
        </template>
      );
      await wait(200);
      await click('#resize-trigger');
      await wait(200);
      await is300(assert);
      await dragFar();
      await inside(assert);
    });

    test('Updates drag constraints after draggable element is resized, with existing drag offset', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ElementResize /></LayoutGroup>
        </template>
      );
      await wait(200);
      await dragFar(100);
      await click('#resize-trigger');
      await wait(200);
      await dragFar();
      await inside(assert);
    });
  }
);

module(
  'Integration | motion | cypress | Drag Constraints Update on Imperative Resize',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('Updates drag constraints when element grows via direct DOM mutation', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ResizeHandle /></LayoutGroup>
        </template>
      );
      await wait(200);
      await click('#resize-trigger');
      await wait(200);
      await is300(assert);
      await dragFar();
      await inside(assert);
    });
  }
);

/* ---------- drag-snap-animate-presence-exit.tsx ---------- */
const TILE = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 80,
  height: 80,
  background: '#08f',
};
const FADE_IN = { opacity: 0 },
  FADE_ON = { opacity: 1 },
  FADE_OUT = { opacity: 0 },
  FAST = { duration: 0.2 };
const keyOf = (it: { key: string }) => it.key;
class SnapPresenceExit extends Component {
  @tracked show = true;
  get items() {
    return this.show ? [{ key: 'tile' }] : [];
  }
  toggle = () => {
    this.show = !this.show;
  };
  <template>
    <div style="padding:60px">
      <button
        type="button"
        data-testid="toggle"
        style="margin-bottom:20px"
        {{on "click" this.toggle}}
      >toggle</button>
      <div
        id="container"
        data-show={{if this.show "1" "0"}}
        style="position:relative;width:300px;height:300px"
      >
        <Presence @items={{this.items}} @key={{keyOf}} as |_it h|>
          <div
            data-testid="tile"
            {{motion
              presence=h
              drag=true
              dragSnapToOrigin=true
              initial=FADE_IN
              animate=FADE_ON
              exit=FADE_OUT
              transition=FAST
              style=TILE
            }}
          ></div>
        </Presence>
      </div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | drag + dragSnapToOrigin + AnimatePresence exit',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('exits cleanly after a drag and re-enters without a stranded transform', async function (assert) {
      await render(
        <template>
          <LayoutGroup><SnapPresenceExit /></LayoutGroup>
        </template>
      );
      await wait(200);
      const T = "[data-testid='tile']";
      const initial = rect(T);
      trigger(T, 'pointerdown', 10, 10);
      trigger(T, 'pointermove', 20, 10);
      await wait(50);
      trigger(T, 'pointermove', 60, 10);
      await wait(50);
      trigger(T, 'pointerup', 60, 10);
      // Toggle off mid-snap: the exit runs while the drag motion-value animation is still in flight
      await click("[data-testid='toggle']");
      await wait(800);
      assert.notOk(document.querySelector(T), 'tile torn down');
      await click("[data-testid='toggle']");
      await wait(500);
      await should(assert, (a) => {
        const r = rect(T);
        a.closeTo(r.left, initial.left, 2, 'left');
        a.closeTo(r.top, initial.top, 2, 'top');
      });
    });
  }
);

/* ---------- drag-snap-layout-id-swap.tsx ---------- */
const TILES_PER_ROW = 3,
  TILE_SIZE = 60;
type Pos = { x: number; y: number };
class SwapTile extends Component<{
  Args: {
    id: number;
    onDragEnd: (pos: Pos, info: { offset: Pos }) => void;
    position: Pos;
  };
}> {
  @tracked isDragging = false;
  get style() {
    return {
      position: 'absolute',
      border: 'solid 1px black',
      width: TILE_SIZE,
      height: TILE_SIZE,
      top: this.args.position.y * TILE_SIZE,
      left: this.args.position.x * TILE_SIZE,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#fff',
      zIndex: this.isDragging ? 1 : 0,
    };
  }
  get layoutId() {
    return String(this.args.id);
  }
  get testId() {
    return `tile-${this.args.id}`;
  }
  onAnimationComplete = () => {
    this.isDragging = false;
  };
  onAnimationStart = () => {
    this.isDragging = true;
  };
  onDragEnd = (_e: unknown, info: { offset: Pos }) =>
    this.args.onDragEnd(this.args.position, info);
  <template>
    <div
      data-testid={{this.testId}}
      {{motion
        style=this.style
        layoutId=this.layoutId
        onAnimationComplete=this.onAnimationComplete
        onAnimationStart=this.onAnimationStart
        drag=true
        dragSnapToOrigin=true
        onDragEnd=this.onDragEnd
        whileDrag=WHILE_DRAG
      }}
    >{{@id}}</div>
  </template>
}
const WHILE_DRAG = { zIndex: 1 };
class LayoutIdSwap extends Component {
  @tracked tiles: { id: number }[][] = Array.from(
    { length: TILES_PER_ROW },
    (_, i) =>
      Array.from({ length: TILES_PER_ROW }, (_, j) => ({
        id: i * TILES_PER_ROW + j,
      }))
  );
  get state() {
    return this.tiles.map((row) => row.map((t) => t.id).join(',')).join('|');
  }
  get cells() {
    return this.tiles.flatMap((row, y) =>
      row.map((tile, x) => ({ tile, position: { x, y } }))
    );
  }
  handleDragEnd = (dragged: Pos, info: { offset: Pos }) => {
    const dropX = dragged.x + Math.round(info.offset.x / TILE_SIZE),
      dropY = dragged.y + Math.round(info.offset.y / TILE_SIZE);
    if (
      dropX < 0 ||
      dropX >= TILES_PER_ROW ||
      dropY < 0 ||
      dropY >= TILES_PER_ROW ||
      (dragged.x === dropX && dragged.y === dropY)
    ) {
      return;
    }
    const next = this.tiles.map((row) => [...row]);
    next[dropY]![dropX] = this.tiles[dragged.y]![dragged.x]!;
    next[dragged.y]![dragged.x] = this.tiles[dropY]![dropX]!;
    this.tiles = next;
  };
  <template>
    <div style="padding:50px">
      <div
        id="grid"
        data-tile-state={{this.state}}
        style="border:solid 1px black;width:180px;height:180px;position:relative"
      >
        {{#each this.cells key="tile.id" as |cell|}}
          <SwapTile
            @id={{cell.tile.id}}
            @position={{cell.position}}
            @onDragEnd={{this.handleDragEnd}}
          />
        {{/each}}
      </div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | drag + dragSnapToOrigin + layoutId horizontal swap',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('does not strand the drag transform after a same-row swap', async function (assert) {
      await render(
        <template>
          <LayoutGroup><LayoutIdSwap /></LayoutGroup>
        </template>
      );
      await wait(200);
      const T0 = "[data-testid='tile-0']",
        T1 = "[data-testid='tile-1']";
      await should(assert, (a) => {
        const r = rect(T0);
        a.closeTo(r.left, 50, 2, 'left');
        a.closeTo(r.top, 50, 2, 'top');
      });
      trigger(T0, 'pointerdown', 5, 5);
      trigger(T0, 'pointermove', 10, 5);
      await wait(50);
      trigger(T0, 'pointermove', 35, 5);
      await wait(50);
      trigger(T0, 'pointerup', 35, 5);
      await wait(2000);
      assert.true(
        /^1,0,/.test($('#grid').getAttribute('data-tile-state') ?? ''),
        `state ${$('#grid').getAttribute('data-tile-state')}`
      );
      await should(assert, (a) => {
        const r = rect(T0);
        a.closeTo(r.left, 110, 2, 'left');
        a.closeTo(r.top, 50, 2, 'top');
      });
      await should(assert, (a) => {
        const r = rect(T1);
        a.closeTo(r.left, 50, 2, 'left');
        a.closeTo(r.top, 50, 2, 'top');
      });
    });
  }
);

/* ---------- drag-layout-reorder-strict.tsx ---------- */
let tree:
  | { expand: (name: string) => void; hover: (name: string | null) => void }
  | undefined;
class FolderTitle extends Component<{
  Args: { isExpanded: boolean; isHovered: boolean; name: string };
}> {
  get style() {
    return {
      padding: '8px 10px',
      background: this.args.isHovered ? '#555' : '#333',
      color: 'white',
    };
  }
  get testId() {
    return `folder-title-${this.args.name}`;
  }
  <template>
    <div
      data-testid={{this.testId}}
      {{motion layout=true style=this.style}}
    >{{if @isExpanded "▼" "▶"}} {{@name}}</div>
  </template>
}
/** React.memo'd upstream: a Glimmer component never re-renders on parent state anyway */
class FileItem extends Component<{ Args: { name: string } }> {
  style = {
    y: motionValue(0),
    height: 35,
    background: '#0099ff',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    padding: '0 20px',
    marginBottom: 2,
  };
  get testId() {
    return `file-${this.args.name}`;
  }
  <template>
    <div
      data-testid={{this.testId}}
      {{motion
        drag="y"
        layout=true
        dragMomentum=false
        dragSnapToOrigin=true
        whileTap=TAP
        style=this.style
      }}
    >{{@name}}</div>
  </template>
}
const TAP = { scale: 1.05 };
const PLACEHOLDER = {
  height: 35,
  background: '#666',
  color: 'white',
  display: 'flex',
  alignItems: 'center',
  padding: '0 20px',
  marginBottom: 2,
};
class PlaceholderFile extends Component<{ Args: { name: string } }> {
  get testId() {
    return `placeholder-${this.args.name}`;
  }
  <template>
    <div
      data-testid={{this.testId}}
      {{motion layout=true style=PLACEHOLDER}}
    >{{@name}}</div>
  </template>
}
class ReorderStrict extends Component {
  @tracked hovered: string | null = null;
  @tracked expanded = new Set(['Folder2']);
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    tree = {
      expand: (name) => {
        this.expanded = new Set([...this.expanded, name]);
      },
      hover: (name) => {
        this.hovered = name;
      },
    };
  }
  has = (name: string) => this.expanded.has(name);
  is = (name: string) => this.hovered === name;
  get expandedList() {
    return [...this.expanded].join(',');
  }
  <template>
    <div style="padding:50px;width:300px">
      <div style="margin-bottom:2px">
        <FolderTitle
          @name="Folder1"
          @isHovered={{this.is "Folder1"}}
          @isExpanded={{this.has "Folder1"}}
        />
        {{#if (this.has "Folder1")}}<PlaceholderFile
            @name="Existing1a"
          /><PlaceholderFile @name="Existing1b" /><PlaceholderFile
            @name="Existing1c"
          />{{/if}}
      </div>
      <div style="margin-bottom:2px">
        <FolderTitle
          @name="Folder2"
          @isHovered={{this.is "Folder2"}}
          @isExpanded={{this.has "Folder2"}}
        />
        {{#if (this.has "Folder2")}}<FileItem @name="File1" /><FileItem
            @name="File2"
          /><FileItem @name="File3" />{{/if}}
      </div>
      <div style="margin-bottom:2px">
        <FolderTitle
          @name="Folder3"
          @isHovered={{this.is "Folder3"}}
          @isExpanded={{this.has "Folder3"}}
        />
      </div>
      <div
        id="result"
        data-hovered={{if this.hovered this.hovered ""}}
        data-expanded={{this.expandedList}}
      ></div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | Drag layout reorder in StrictMode',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);
    const F = "[data-testid='file-File1']";

    test('Maintains drag position when content is inserted above (memoized component)', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ReorderStrict /></LayoutGroup>
        </template>
      );
      await wait(200);
      trigger(F, 'pointerdown', 100, 15);
      await wait(50);
      trigger(F, 'pointermove', 100, 20);
      await wait(50);
      trigger(F, 'pointermove', 100, 80);
      await wait(200);
      const preExpandTop = rect(F).top;
      // Expand Folder1 — inserts 3 items (~105px) ABOVE the dragged file
      tree!.expand('Folder1');
      await wait(500);
      assert.ok($("[data-testid='placeholder-Existing1a']"), 'expanded');
      await should(assert, (a) => {
        const t = rect(F).top;
        a.true(
          t >= preExpandTop - 50 && t <= preExpandTop + 50,
          `File1 jumped from ${preExpandTop} to ${t} after folder expand`
        );
      });
      trigger(F, 'pointerup');
    });

    test('Maintains drag position on simple hover state change', async function (assert) {
      await render(
        <template>
          <LayoutGroup><ReorderStrict /></LayoutGroup>
        </template>
      );
      await wait(200);
      trigger(F, 'pointerdown', 100, 15);
      await wait(50);
      trigger(F, 'pointermove', 100, 20);
      await wait(50);
      trigger(F, 'pointermove', 100, 80);
      await wait(200);
      const preHoverTop = rect(F).top;
      tree!.hover('Folder3');
      await wait(300);
      assert.strictEqual($('#result').getAttribute('data-hovered'), 'Folder3');
      await should(assert, (a) => {
        const t = rect(F).top;
        a.true(
          t >= preHoverTop - 30 && t <= preHoverTop + 30,
          `File1 jumped from ${preHoverTop} to ${t} after folder hover`
        );
      });
      trigger(F, 'pointerup');
    });
  }
);

/* ---------- drag-snap-to-cursor-initial.tsx ---------- */
const SNAP_INITIAL = { x: 100, y: 40 };
const SNAP_BOX = {
  position: 'absolute',
  top: 0,
  left: 500,
  width: 100,
  height: 100,
  background: 'red',
};
class SnapToCursorInitial extends Component<{ Args: { rerender?: boolean } }> {
  controls = createDragControls();
  @tracked dragCount = 0;
  startDrag = (e: PointerEvent) =>
    this.controls.start(e, { snapToCursor: true });
  // React re-renders the motion.div, and every commit re-measures its projection: layoutChange is that commit
  countDrag = () => layoutChange(() => this.dragCount++);
  get onDragEnd() {
    return this.args.rerender ? this.countDrag : undefined;
  }
  <template>
    <div
      id="trigger"
      data-drag-count={{this.dragCount}}
      style="position:absolute;top:0;left:0;width:400px;height:400px;background:#eee"
      {{on "pointerdown" this.startDrag}}
    ></div>
    <div
      id="box"
      {{motion
        drag=true
        dragControls=this.controls
        dragListener=false
        dragMomentum=false
        initial=SNAP_INITIAL
        onDragEnd=this.onDragEnd
        style=SNAP_BOX
      }}
    ></div>
  </template>
}

module(
  'Integration | motion | cypress | snapToCursor with initial coordinates',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    // cy.get().then(): measured once, no retry
    const expectBoxCenteredAt = (assert: Assert, x: number, y: number) => {
      const { left, top, width, height } = rect('#box');
      const cx = left + width / 2,
        cy = top + height / 2;
      assert.true(Math.abs(cx - x) <= 1, `centre x ${cx} within 1 of ${x}`);
      assert.true(Math.abs(cy - y) <= 1, `centre y ${cy} within 1 of ${y}`);
    };

    const snapAndDrag = async (assert: Assert) => {
      trigger('#trigger', 'pointerdown', 50, 50);
      await nextFrame();
      await wait(50);
      expectBoxCenteredAt(assert, 50, 50);

      trigger('#trigger', 'pointermove', 60, 60);
      await nextFrame();
      await wait(50);
      trigger('#trigger', 'pointermove', 200, 100);
      await nextFrame();
      await wait(50);
      expectBoxCenteredAt(assert, 200, 100);

      trigger('#trigger', 'pointerup', 200, 100);
      await wait(50);
      expectBoxCenteredAt(assert, 200, 100);
    };

    test('centres the element under the pointer on every drag start', async function (assert) {
      await render(<template><SnapToCursorInitial /></template>);
      await wait(200);
      await nextFrame();
      await nextFrame();
      expectBoxCenteredAt(assert, 650, 90);

      await snapAndDrag(assert);
      await snapAndDrag(assert);
      await snapAndDrag(assert);
    });

    test('centres the element under the pointer after re-renders', async function (assert) {
      await render(
        <template><SnapToCursorInitial @rerender={{true}} /></template>
      );
      await wait(200);
      await nextFrame();
      await nextFrame();
      expectBoxCenteredAt(assert, 650, 90);

      const dragCount = () => $('#trigger').getAttribute('data-drag-count');
      await snapAndDrag(assert);
      await should(assert, (a) => a.strictEqual(dragCount(), '1'));
      await snapAndDrag(assert);
      await should(assert, (a) => a.strictEqual(dragCount(), '2'));
      await snapAndDrag(assert);
    });
  }
);

/* ---------- drag-release-before-frame.tsx ---------- */
const RELEASE_BOX = { width: 50, height: 50, background: 'red' };
class ReleaseBeforeFrame extends Component {
  @tracked offset = '';
  // React re-renders the motion.div on setOffset, and every commit re-measures its projection: layoutChange is that commit
  onDragEnd = (_: PointerEvent, info: PanInfo) =>
    layoutChange(() => (this.offset = `${info.offset.x},${info.offset.y}`));
  <template>
    <div style="padding:100px">
      <div
        data-testid="draggable"
        {{motion
          drag=true
          dragElastic=0
          dragMomentum=false
          onDragEnd=this.onDragEnd
          style=RELEASE_BOX
        }}
      ></div>
      <div id="drag-end-offset">{{this.offset}}</div>
    </div>
  </template>
}

module(
  'Integration | motion | cypress | Drag release before the next frame',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    async function startDrag(assert: Assert) {
      await render(<template><ReleaseBeforeFrame /></template>);
      await nextFrame();
      await nextFrame();
      const start = rect();
      pointerAt($(D), 'pointerdown', start.left + 5, start.top + 5);
      pointerAt($(D), 'pointermove', start.left + 15, start.top + 15);
      await nextFrame();
      await nextFrame();
      const { left, top } = rect();
      assert.strictEqual(left - start.left, 10, 'x offset after first move');
      assert.strictEqual(top - start.top, 10, 'y offset after first move');
      return start;
    }

    async function expectRestingAt(
      assert: Assert,
      start: DOMRect,
      x: number,
      y: number
    ) {
      await nextFrame();
      await nextFrame();
      await should(assert, (a) =>
        a.strictEqual($('#drag-end-offset').textContent, `${x},${y}`)
      );
      const { left, top } = rect();
      assert.strictEqual(left - start.left, x, 'x offset at rest');
      assert.strictEqual(top - start.top, y, 'y offset at rest');
    }

    test('Applies a pointermove followed by pointerup within the same frame', async function (assert) {
      const start = await startDrag(assert);
      pointerAt($(D), 'pointermove', start.left + 105, start.top + 105);
      pointerAt($(D), 'pointerup', start.left + 105, start.top + 105);
      await expectRestingAt(assert, start, 100, 100);
    });

    // The frame applies the move before pointerup, so this rest position holds with or without the pointerup flush
    test('Applies a pointermove when a frame runs before pointerup', async function (assert) {
      const start = await startDrag(assert);
      pointerAt($(D), 'pointermove', start.left + 105, start.top + 105);
      await nextFrame();
      pointerAt($(D), 'pointerup', start.left + 105, start.top + 105);
      await expectRestingAt(assert, start, 100, 100);
    });
  }
);
