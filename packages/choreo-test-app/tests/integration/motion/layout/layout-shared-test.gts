/**
 * Port of Motion's packages/framer-motion/cypress/integration/layout-shared.ts (motion@bbabb00) with its 18 fixtures.
 * Each fixture is a Glimmer component; `?type=`/`?size=`/`?move=`/`?sibling=` become args. The two
 * upstream `it.skip` cases (A -> AB -> A switch) are skipped here too. <MotionConfig transition> is
 * passed to each motion element directly (the binding has no MotionConfig), and `key=` remounts are
 * `{{#if}}` branches.
 */
import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { click, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { instantLayoutTransition } from 'glimmer-motion/layout';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import { setupMotion } from 'glimmer-motion/test-support';
import { cancelFrame, frame, mix, motionValue } from 'motion-dom';
import { module, skip, test } from 'qunit';

import {
  $,
  expectBbox,
  setupFixtureViewport,
  should,
  wait,
} from '../../../helpers/layout-fixture';

const keyOf = (it: { key: string }) => it.key;
type LayoutType = true | 'position' | 'size' | 'preserve-aspect';
const BOX = { position: 'absolute', top: 0, left: 0, background: 'red' };
const A = { ...BOX, width: 100, height: 200 };
const B = { ...BOX, top: 100, left: 200, width: 300, height: 300 };

/* ---------- layout-shared-toggle-multiple.tsx ---------- */
const TM_T = { duration: 1 };
const TM_BOX = { width: 100, height: 100, background: 'red', borderRadius: 20 };
const TM_OPEN = { width: 200, height: 200, background: 'blue' };
class ToggleMultiple extends Component {
  @tracked isOpen = false;
  toggle = () => {
    this.isOpen = !this.isOpen;
  };
  <template>
    <button
      type="button"
      style="position:fixed;top:0;left:300px"
      {{on "click" this.toggle}}
    >Toggle</button>
    <div id="a" {{motion layoutId="box" style=TM_BOX transition=TM_T}}></div>
    {{#if this.isOpen}}<div
        id="b"
        {{motion layoutId="box" style=TM_OPEN transition=TM_T}}
      ></div>{{/if}}
  </template>
}

/* ---------- layout-shared-animate-presence.tsx ---------- */
const AP_ANIMATE = [
  { backgroundColor: '#09f', borderRadius: 10, opacity: 1 },
  { backgroundColor: '#90f', borderRadius: 100, opacity: 0.5 },
  { backgroundColor: '#f09', borderRadius: 0, opacity: 1 },
  { backgroundColor: '#9f0', borderRadius: 50, opacity: 0.5 },
];
const AP_STYLES = [
  { width: 100, height: 100, top: 100 },
  { width: 200, height: 200, left: 100 },
  { width: 100, height: 100, left: 'calc(100vw - 100px)' },
  { width: 200, height: 200 },
];
const AP_T = { duration: 10, ease: () => 0.25 };
class SharedAnimatePresence extends Component {
  @tracked count = 0;
  get items() {
    return [{ key: `shape-${this.count}`, count: this.count }];
  }
  cycle = () => {
    this.count = (this.count + 1) % 4;
  };
  styleFor = (count: number) => ({ position: 'absolute', ...AP_STYLES[count] });
  animateFor = (count: number) => AP_ANIMATE[count];
  <template>
    <div
      style="position:fixed;top:0;left:0;right:0;bottom:0;background:white;display:flex;justify-content:center;align-items:center"
    >
      <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
        <div
          id="shape-{{it.count}}"
          {{motion
            presence=h
            initial=false
            style=(this.styleFor it.count)
            transition=AP_T
            animate=(this.animateFor it.count)
            layoutId="box"
          }}
          {{on "click" this.cycle}}
        ></div>
      </Presence>
    </div>
  </template>
}

/* ---------- layout-shared-switch-a-b.tsx ---------- */
class SwitchAB extends Component<{ Args: { type?: LayoutType } }> {
  @tracked state = true;
  backgroundColor = motionValue('#f00');
  transition = { duration: 1, ease: () => 0.5 };
  get layout() {
    return this.args.type ?? true;
  }
  get style() {
    return {
      ...(this.state ? A : B),
      backgroundColor: this.backgroundColor,
      borderRadius: this.state ? 0 : 20,
      opacity: this.state ? 0.4 : 1,
    };
  }
  toggle = () => {
    this.state = !this.state;
  };
  onStart = () => this.backgroundColor.set('#0f0');
  onComplete = () => this.backgroundColor.set('#00f');
  <template>
    {{#if this.state}}
      <div
        id="a"
        {{motion
          layoutId="box"
          layout=this.layout
          style=this.style
          transition=this.transition
          onLayoutAnimationStart=this.onStart
          onLayoutAnimationComplete=this.onComplete
        }}
        {{on "click" this.toggle}}
      ></div>
    {{else}}
      <div
        id="b"
        {{motion
          layoutId="box"
          layout=this.layout
          style=this.style
          transition=this.transition
          onLayoutAnimationStart=this.onStart
          onLayoutAnimationComplete=this.onComplete
        }}
        {{on "click" this.toggle}}
      ></div>
    {{/if}}
  </template>
}

/* ---------- layout-shared-switch-0-a-b-0.tsx ---------- */
const S0_T = { default: { duration: 5, ease: () => 0.5 } };
class Switch0AB0 extends Component<{ Args: { type?: LayoutType } }> {
  @tracked count = 0;
  get layout() {
    return this.args.type ?? true;
  }
  get showA() {
    return this.count === 1 || this.count === 3;
  }
  get showB() {
    return this.count === 2;
  }
  bump = () => {
    this.count++;
  };
  <template>
    <div
      id="trigger"
      style="position:absolute;top:0;right:0;bottom:0;left:0"
      {{on "click" this.bump}}
    >
      {{#if this.showA}}<div
          id="a"
          {{motion layoutId="box" layout=this.layout style=A transition=S0_T}}
        ></div>{{/if}}
      {{#if this.showB}}<div
          id="b"
          {{motion layoutId="box" style=B transition=S0_T}}
        ></div>{{/if}}
    </div>
  </template>
}

/* ---------- layout-shared-crossfade-a-b-transform-template.tsx ---------- */
const TT_BOX = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  background: 'red',
};
const TT_A = { ...TT_BOX, width: 100, height: 200 };
const TT_B = { ...TT_BOX, width: 300, height: 300 };
const TT_T = { duration: 1, ease: () => 0.5 };
const TT_TEMPLATE = (_: unknown, generated: string) =>
  `translate(-50%, -50%) ${generated}`;
class CrossfadeTransformTemplate extends Component<{
  Args: { type?: LayoutType };
}> {
  @tracked state = true;
  get layout() {
    return this.args.type ?? true;
  }
  get style() {
    return {
      ...(this.state ? TT_A : TT_B),
      backgroundColor: this.state ? '#f00' : '#0f0',
      borderRadius: this.state ? 0 : 20,
    };
  }
  get items() {
    return [{ key: this.state ? 'a' : 'b', a: this.state }];
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <div
      style="position:relative;width:500px;height:500px;background-color:blue"
      {{motion}}
    >
      <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
        <div
          id={{if it.a "a" "b"}}
          {{motion
            presence=h
            layoutId="box"
            layout=this.layout
            style=this.style
            transition=TT_T
            transformTemplate=TT_TEMPLATE
          }}
          {{on "click" this.toggle}}
        ></div>
      </Presence>
    </div>
  </template>
}

/* ---------- layout-shared-crossfade-a-ab.tsx ---------- */
const AAB_T = {
  default: { duration: 1, ease: () => 0.5 },
  opacity: { duration: 1, ease: () => 0.1 },
};
const A_LARGE = { ...BOX, top: 100, left: 200, width: 300, height: 600 };
class CrossfadeAAB extends Component<{
  Args: { move?: string; size?: string; type?: LayoutType };
}> {
  @tracked state = false;
  get layout() {
    return this.args.type ?? true;
  }
  get bStyle() {
    const s = { ...(this.args.size ? A_LARGE : B) };
    if (this.args.move === 'no') {
      s.top = 0;
      s.left = 0;
    }
    return s;
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <div
      id="a"
      {{motion layoutId="box" layout=this.layout style=A transition=AAB_T}}
      {{on "click" this.toggle}}
    ></div>
    {{#if this.state}}<div
        id="b"
        {{motion
          layoutId="box"
          layout=this.layout
          style=this.bStyle
          transition=AAB_T
        }}
        {{on "click" this.toggle}}
      ></div>{{/if}}
  </template>
}

/* ---------- layout-preserve-ratio.tsx ---------- */
const PR_T = { default: { duration: 5 } };
class PreserveRatio extends Component {
  @tracked state = false;
  opacity = motionValue(0);
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    // useAnimationFrame: force animation frames to pull transform
    const tick = () => this.opacity.set(mix(0.99, 1, Math.random()));
    frame.update(tick, true);
    registerDestructor(this, () => cancelFrame(tick));
  }
  get outerStyle() {
    return this.state
      ? { width: 100, height: 200, background: 'black' }
      : { width: 200, height: 200, background: 'black' };
  }
  get style() {
    return {
      position: 'absolute',
      top: 100,
      left: 100,
      background: 'red',
      width: this.state ? 100 : 200,
      height: 200,
      opacity: this.opacity,
    };
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <div {{motion layout=true style=this.outerStyle}}>
      <div
        id="a"
        {{motion layout="preserve-aspect" style=this.style transition=PR_T}}
        {{on "click" this.toggle}}
      ></div>
    </div>
  </template>
}

/* ---------- layout-shared-instant-transition-a-ab-a.tsx ---------- */
const IT_T = {
  default: { duration: 0.2, ease: () => 0.5 },
  opacity: { duration: 0.2, ease: () => 0.1 },
};
const IT_A = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 100,
  height: 200,
  borderRadius: 0,
};
const IT_B = {
  position: 'absolute',
  top: 100,
  left: 200,
  width: 300,
  height: 300,
  borderRadius: 20,
};
class InstantTransitionAABA extends Component<{ Args: { type?: LayoutType } }> {
  @tracked bgColor = '#f00';
  @tracked state = false;
  get layout() {
    return this.args.type ?? true;
  }
  get aStyle() {
    return { ...IT_A, background: this.bgColor };
  }
  get bStyle() {
    return { ...IT_B, background: this.bgColor };
  }
  get items() {
    return this.state ? [{ key: 'b' }] : [];
  }
  // a -> instant -> b ; b -> animate -> a
  instantTransit = () => {
    instantLayoutTransition(() => {
      this.bgColor = '#00f';
    });
    this.state = !this.state;
  };
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <div
      id="a"
      {{motion
        layoutId="box"
        layout=this.layout
        style=this.aStyle
        transition=IT_T
      }}
      {{on "click" this.instantTransit}}
    ></div>
    <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
      <div
        id="b"
        {{motion presence=h layoutId="box" style=this.bStyle}}
        {{on "click" this.toggle}}
      ></div>
    </Presence>
  </template>
}

/* ---------- layout-shared-crossfade-nested.tsx / -display-contents.tsx ---------- */
const N_A = { ...BOX, width: 100, height: 200, top: 100, left: 200 };
const N_B = { ...BOX, top: 300, left: 200, width: 300, height: 300 };
const N_CHILD = { width: 100, height: 100, background: 'blue' };
const N_CONTENTS = { display: 'contents' };
class CrossfadeNested extends Component<{
  Args: { contents?: boolean; type?: LayoutType };
}> {
  @tracked state = true;
  get transition() {
    return this.args.contents
      ? { duration: 0.5, ease: () => 0.5 }
      : { duration: 1, ease: () => 0.5 };
  }
  get layout() {
    return this.args.type ?? true;
  }
  get style() {
    return {
      ...(this.state ? N_A : N_B),
      backgroundColor: this.state ? '#f00' : '#0f0',
      borderRadius: this.state ? 0 : 20,
    };
  }
  get items() {
    return [{ key: this.state ? 'a' : 'b', a: this.state }];
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
      <div
        style="position:absolute;top:0;left:0;width:500px;height:400px"
        {{motion presence=h}}
      >
        <div
          id={{if it.a "a" "b"}}
          {{motion
            layoutId="box"
            layout=this.layout
            style=this.style
            transition=this.transition
          }}
          {{on "click" this.toggle}}
        >
          {{#if @contents}}
            <div
              id="mid"
              {{motion
                layoutId="mid"
                style=N_CONTENTS
                transition=this.transition
              }}
            >
              <div
                id="child"
                {{motion
                  layoutId="child"
                  style=N_CHILD
                  transition=this.transition
                }}
              ></div>
            </div>
          {{else}}
            <div
              id="child"
              {{motion
                layoutId="child"
                transition=this.transition
                style=N_CHILD
              }}
            ></div>
          {{/if}}
        </div>
      </div>
    </Presence>
  </template>
}

/* ---------- layout-group-unmount.tsx ---------- */
const GU_STYLE = {
  width: 100,
  height: 100,
  background: 'red',
  opacity: 1,
  borderRadius: 20,
  margin: 20,
};
const GU_STYLE_B = { ...GU_STYLE, backgroundColor: 'blue' };
const GU_T = { duration: 0.2, ease: () => 0.5 };
const GU_CONTENTS = { display: 'contents' };
const GU_STACK = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'start',
};
class GroupUnmountItem extends Component {
  @tracked variant = 'a';
  toggle = () => {
    this.variant = this.variant === 'a' ? 'b' : 'a';
  };
  <template>
    <LayoutGroup @id="group-2">
      <div {{motion style=GU_CONTENTS}}>
        {{#if (eq this.variant "a")}}<div
            id="a"
            {{motion layoutId="a" style=GU_STYLE}}
            {{on "click" this.toggle}}
          ></div>{{/if}}
      </div>
    </LayoutGroup>
  </template>
}
const GroupUnmount = <template>
  <LayoutGroup @id="group-1">
    <div {{motion style=GU_CONTENTS}}>
      <div {{motion style=GU_STACK}}><GroupUnmountItem /></div>
      <div
        id="b"
        {{motion layoutId="b" style=GU_STYLE_B transition=GU_T}}
      ></div>
    </div>
  </LayoutGroup>
</template>;

/* ---------- layout-group-unmount-list.tsx ---------- */
const GL_STYLE = {
  width: 100,
  height: 100,
  opacity: 1,
  borderRadius: 20,
  margin: 20,
};
const GL_T = { duration: 10, ease: () => 0.5 };
const GL_STACK_T = { duration: 0.2, ease: () => 0.5 };
const GL_CONTAINER = {
  containerStyle: {
    display: 'block',
    width: 'min-content',
    height: 'min-content',
  },
};
const GL_STACK = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  padding: 20,
  width: 'auto',
  height: 'auto',
  backgroundColor: 'blue',
};
class GroupUnmountListItem extends Component<{
  Args: { backgroundColor: string; id: string };
}> {
  @tracked visible = true;
  get style() {
    return { ...GL_STYLE, backgroundColor: this.args.backgroundColor };
  }
  hide = () => {
    this.visible = false;
  };
  <template>
    <LayoutGroup @id="group-2">
      <div {{motion style=GU_CONTENTS}}>
        {{#if this.visible}}<div
            id={{@id}}
            {{motion layoutId=@id style=this.style transition=GL_T}}
            {{on "click" this.hide}}
          ></div>{{/if}}
      </div>
    </LayoutGroup>
  </template>
}
const GroupUnmountList = <template>
  <LayoutGroup @id="group-1">
    <div style="position:absolute;left:100px;bottom:100px" {{motion}}>
      <LayoutGroup @id="list">
        <div {{motion style=GU_CONTENTS}}>
          <div
            id="stack"
            {{motion layoutId="stack" style=GL_CONTAINER transition=GL_STACK_T}}
          >
            <div {{motion style=GL_STACK}}>
              <div {{motion style=GU_CONTENTS}}>
                <GroupUnmountListItem @id="a" @backgroundColor="red" />
                <GroupUnmountListItem @id="b" @backgroundColor="yellow" />
              </div>
            </div>
          </div>
        </div>
      </LayoutGroup>
    </div>
  </LayoutGroup>
</template>;

/* ---------- layout-shared-clear-snapshots.tsx ---------- */
const CS_BOX = {
  position: 'absolute',
  top: 100,
  left: 0,
  width: 100,
  height: 100,
  background: 'red',
};
const CS_A = CS_BOX;
const CS_B = { ...CS_BOX, left: 200 };
const CS_SIBLING = { ...CS_BOX, backgroundColor: 'blue', top: 200 };
const CS_T = { duration: 0.15 };
class ClearSnapshots extends Component<{ Args: { sibling?: boolean } }> {
  @tracked state = 0;
  cycle = () => {
    this.state = (this.state + 1) % 3;
  };
  get style() {
    return this.state === 0 ? CS_A : CS_B;
  }
  <template>
    <button type="button" id="next" {{on "click" this.cycle}}>Next</button>
    {{#if (neq this.state 1)}}<div
        id="box"
        {{motion layout=true layoutId="box" style=this.style transition=CS_T}}
      ></div>{{/if}}
    {{#if (and @sibling (neq this.state 2))}}<div
        {{motion layout=true style=CS_SIBLING}}
      ></div>{{/if}}
  </template>
}

/* ---------- layout-follow-pointer-events.tsx ---------- */
const FP_T = { duration: 0.1 };
const FP_A = { background: 'red', width: 100, height: 200 };
const FP_B = { width: 300, height: 300, background: 'blue', borderRadius: 20 };
class FollowPointerEvents extends Component {
  @tracked isOpen = false;
  open = () => {
    this.isOpen = true;
  };
  close = () => {
    this.isOpen = false;
  };
  <template>
    <div
      id="a"
      {{motion layoutId="box" style=FP_A transition=FP_T}}
      {{on "click" this.open}}
    ></div>
    {{#if this.isOpen}}<div
        id="b"
        {{motion layoutId="box" style=FP_B transition=FP_T}}
        {{on "click" this.close}}
      ></div>{{/if}}
  </template>
}

/* ---------- layout-queuemicrotask.tsx ---------- */
const QM_T = { duration: 0.1 };
const QM_OPEN = {
  height: '400px',
  width: '400px',
  backgroundColor: 'red',
  position: 'absolute',
  top: '200px',
  left: '200px',
};
const QM_TARGET = { height: '200px', width: '200px', backgroundColor: 'blue' };
class QueueMicrotask extends Component {
  @tracked isOpen = false;
  @tracked error = '';
  get items() {
    return this.isOpen ? [{ key: '1' }] : [];
  }
  open = () => {
    this.isOpen = true;
  };
  close = () => {
    this.isOpen = false;
  };
  onLayoutMeasure = (layout: { x: { min: number } }) => {
    if (layout.x.min !== 200) {
      this.error = 'Layout measured incorrectly';
    }
  };
  <template>
    <div style="position:relative">
      <Presence @items={{this.items}} @key={{keyOf}} @mode="wait" as |it h|>
        <div
          id="open"
          {{motion
            presence=h
            layoutId="1"
            style=QM_OPEN
            transition=QM_T
            onLayoutMeasure=this.onLayoutMeasure
          }}
          {{on "click" this.close}}
        ></div>
      </Presence>
      <div
        id="target"
        {{motion layoutId="1" style=QM_TARGET transition=QM_T}}
        {{on "click" this.open}}
      ></div>
      <div id="error" style="color:red">{{this.error}}</div>
    </div>
  </template>
}

/* ---------- layout-shared-rotate.tsx ---------- */
class SharedRotate extends Component {
  @tracked state = false;
  get style() {
    const size = this.state ? 100 : 200;
    return { rotate: 45, width: size, height: size, backgroundColor: 'red' };
  }
  get transition() {
    return { duration: 10, ease: this.state ? () => 0.5 : () => 0 };
  }
  toggle = () => {
    this.state = !this.state;
  };
  <template>
    {{#if this.state}}
      <div
        id="box"
        {{motion layoutId="box" style=this.style transition=this.transition}}
        {{on "click" this.toggle}}
      ></div>
    {{else}}
      <div
        id="box"
        {{motion layoutId="box" style=this.style transition=this.transition}}
        {{on "click" this.toggle}}
      ></div>
    {{/if}}
  </template>
}

/* ---------- layout-shared-border-radius.tsx ---------- */
const BR_T = { duration: 10 };
const BR_A = {
  background: 'red',
  gridArea: '1 / 1',
  width: 80,
  height: 80,
  borderRadius: 24,
};
const BR_B = {
  background: 'red',
  gridArea: '1 / 1',
  left: 200,
  width: 140,
  height: 140,
  borderRadius: 0,
};
class BorderRadius extends Component {
  @tracked isOpen = false;
  toggle = () => {
    this.isOpen = !this.isOpen;
  };
  <template>
    <button type="button" id="next" {{on "click" this.toggle}}>Next</button>
    <div
      style="display:flex;justify-content:center;align-items:center;gap:20px;width:300px;height:300px"
    >
      <div {{motion style=BR_A transition=BR_T layoutId="boxA"}}></div>
      {{#if this.isOpen}}<div
          class="measure-box"
          {{motion style=BR_B transition=BR_T layoutId="boxA"}}
        ></div>{{/if}}
    </div>
    <div
      style="display:flex;justify-content:center;align-items:center;gap:20px;width:300px;height:300px"
    >
      {{#if this.isOpen}}
        <div
          class="measure-box"
          {{motion style=BR_B transition=BR_T layoutId="boxB"}}
        ></div>
      {{else}}
        <div {{motion style=BR_A transition=BR_T layoutId="boxB"}}></div>
      {{/if}}
    </div>
  </template>
}

function eq(a: unknown, b: unknown) {
  return a === b;
}
function neq(a: unknown, b: unknown) {
  return a !== b;
}
function and(a: unknown, b: unknown) {
  return Boolean(a && b);
}

module('Integration | motion | cypress | Shared layout', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('Toggle multiple times: Should allow multiple toggles', async function (assert) {
    await render(
      <template>
        <LayoutGroup><ToggleMultiple /></LayoutGroup>
      </template>
    );
    await wait(50);
    for (let i = 0; i < 4; i++) {
      await click('button');
      await wait(200);
      await should(assert, (a) =>
        a.notStrictEqual($('#a').getBoundingClientRect().left, 0)
      );
      if (i % 2 === 0) {
        await should(assert, (a) =>
          a.notStrictEqual($('#b').getBoundingClientRect().left, 0)
        );
      }
    }
  });

  test("A -> B transition: When performing crossfade animation, removed element isn't removed until animation is complete", async function (assert) {
    await render(
      <template>
        <LayoutGroup><SharedAnimatePresence /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      a.strictEqual($('#shape-0').style.opacity, '1')
    );
    await click('#shape-0');
    await wait(50);
    await should(assert, (a) =>
      a.strictEqual($('#shape-0').style.opacity, '1')
    );
    await should(assert, (a) =>
      a.strictEqual($('#shape-1').style.opacity, '0.433013')
    );
  });

  for (const mode of ['switch', 'crossfade'] as const) {
    test(`A -> B ${mode} transition: Correctly fires layout={true} animations and fires onLayoutAnimationStart and onLayoutAnimationComplete`, async function (assert) {
      await render(
        <template>
          <LayoutGroup><SwitchAB /></LayoutGroup>
        </template>
      );
      await wait(50);
      await should(assert, (a) => {
        expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 });
        if (mode === 'switch') {
          a.strictEqual(getComputedStyle($('#a')).opacity, '0.4');
        }
      });
      await click('#a');
      await wait(200);
      await should(assert, (a) => {
        a.strictEqual($('#b').style.backgroundColor, 'rgb(0, 255, 0)');
        a.strictEqual(getComputedStyle($('#b')).borderRadius, '5% / 4%');
        if (mode === 'switch') {
          a.strictEqual(getComputedStyle($('#b')).opacity, '0.7');
        }
        expectBbox(a, $('#b'), { top: 50, left: 100, width: 200, height: 250 });
      });
      await wait(2000);
      await should(assert, (a) =>
        a.strictEqual($('#b').style.backgroundColor, 'rgb(0, 0, 255)')
      );
      await click('#b');
      await wait(200);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 50, left: 100, width: 200, height: 250 })
      );
    });

    test(`A -> B ${mode} transition: It correctly fires layout="position" animations`, async function (assert) {
      await render(
        <template>
          <LayoutGroup><SwitchAB @type="position" /></LayoutGroup>
        </template>
      );
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
      );
      await click('#a');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#b'), { top: 50, left: 100, width: 300, height: 300 })
      );
      await click('#b');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 25, left: 50, width: 100, height: 200 })
      );
    });

    test(`A -> B ${mode} transition: It correctly fires layout="size" animations`, async function (assert) {
      await render(
        <template>
          <LayoutGroup><SwitchAB @type="size" /></LayoutGroup>
        </template>
      );
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
      );
      await click('#a');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#b'), { top: 100, left: 200, width: 200, height: 250 })
      );
      await click('#b');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 0, left: 0, width: 150, height: 225 })
      );
    });
  }

  skip(
    'A -> AB -> A switch transition: Correctly fires layout={true} animations and fires onLayoutAnimationComplete (upstream it.skip)'
  );
  skip(
    'A -> AB -> A switch transition: It correctly fires layout="position" animations (upstream it.skip)'
  );

  for (const name of [
    '0 -> A -> B -> 0 transition',
    '0 -> A -> AB -> A -> 0 transition',
    '0 -> A -> B -> 0 crossfade transition',
    '0 -> A -> AB -> A -> 0 crossfade transition',
  ]) {
    test(`${name}: Correctly fires layout={true} animations`, async function (assert) {
      await render(
        <template>
          <LayoutGroup><Switch0AB0 /></LayoutGroup>
        </template>
      );
      await wait(50);
      await click('#trigger');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
      );
      await click('#trigger');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#b'), { top: 50, left: 100, width: 200, height: 250 })
      );
      await click('#trigger');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#a'), { top: 25, left: 50, width: 150, height: 225 })
      );
    });
  }

  test('A -> B crossfade transition: It correctly fires layout={true} animations when the component has a transformTemplate', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeTransformTemplate /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 150, left: 200, width: 100, height: 200 })
    );
    await click('#a');
    await wait(100);
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 125, left: 150, width: 200, height: 250 })
    );
    // interrupt the animation
    await click('#b');
    await wait(100);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 137.5, left: 175, width: 150, height: 225 })
    );
  });

  test('A -> AB -> A crossfade transition: Correctly fires layout={true} animations and fires onLayoutAnimationComplete', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeAAB /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(50);
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#a').style.opacity) || 1, 1);
      expectBbox(a, $('#a'), { top: 50, left: 100, width: 200, height: 250 });
    });
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#b').style.opacity) || 1, 1);
      expectBbox(a, $('#b'), { top: 50, left: 100, width: 200, height: 250 });
    });
  });

  test('A -> AB -> A crossfade transition: It correctly fires layout="position" animations', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeAAB @type="position" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 50, left: 100, width: 100, height: 200 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 50, left: 100, width: 300, height: 300 })
    );
  });

  test('A -> AB -> A crossfade transition: It correctly animates layout="preserve-aspect" as "position" animations if aspect ratios are different', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeAAB @type="preserve-aspect" /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(50);
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#a').style.opacity) || 1, 1);
      expectBbox(a, $('#a'), { top: 50, left: 100, width: 100, height: 200 });
    });
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#b').style.opacity) || 1, 1);
      expectBbox(a, $('#b'), { top: 50, left: 100, width: 300, height: 300 });
    });
  });

  test(`A -> AB -> A crossfade transition: It correctly doesn't animate if layout="preserve-aspect" if size is different and position is the same`, async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeAAB
            @type="preserve-aspect"
            @move="no"
          /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(50);
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#a').style.opacity) || 1, 1);
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 });
    });
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#b').style.opacity) || 1, 1);
      expectBbox(a, $('#b'), { top: 0, left: 0, width: 300, height: 300 });
    });
  });

  test(`A -> AB -> A crossfade transition: It correctly doesn't animate if layout="preserve-aspect" on same element if size and position are the same`, async function (assert) {
    await render(
      <template>
        <LayoutGroup><PreserveRatio /></LayoutGroup>
      </template>
    );
    await wait(50);
    const width = () => Math.round($('#a').getBoundingClientRect().width);
    await should(assert, (a) => a.strictEqual(width(), 200));
    await click('#a');
    await wait(50);
    await should(assert, (a) => a.strictEqual(width(), 100));
    await click('#a');
    await wait(50);
    await should(assert, (a) => a.strictEqual(width(), 200));
    await click('#a');
    await wait(50);
    await should(assert, (a) => a.strictEqual(width(), 100));
  });

  test('A -> AB -> A crossfade transition: It correctly animates layout="preserve-aspect" as normal layout animations if both aspect ratios are the same', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeAAB
            @type="preserve-aspect"
            @size="same"
          /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(100);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 50, left: 100, width: 200, height: 400 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 50, left: 100, width: 200, height: 400 })
    );
  });

  test('A -> AB -> A crossfade transition: Correctly fires layout={true} animations after an instant transition', async function (assert) {
    await render(
      <template>
        <LayoutGroup><InstantTransitionAABA /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(50);
    // a shouldn't change since the update is blocked
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#a').style.opacity) || 1, 1);
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 });
    });
    // b should have its identical layout
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#b').style.opacity) || 1, 1);
      expectBbox(a, $('#b'), { top: 100, left: 200, width: 300, height: 300 });
    });
    await click('#b');
    await wait(50);
    // half way back to a
    await should(assert, (a) => {
      a.strictEqual(parseFloat($('#a').style.opacity) || 1, 1);
      expectBbox(a, $('#a'), { top: 50, left: 100, width: 200, height: 250 });
    });
  });

  test('nested crossfade transition: Correctly fires layout={true} animations', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeNested /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#a');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 200, left: 200, width: 200, height: 250 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#child'), {
        top: 200,
        left: 200,
        width: 100,
        height: 100,
      })
    );
    await click('#b');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 150, left: 200, width: 150, height: 225 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#child'), {
        top: 150,
        left: 200,
        width: 100,
        height: 100,
      })
    );
  });

  test('nested crossfade transition: Correctly fires layout={true} animations when there are divs with `display: contents` in the path', async function (assert) {
    await render(
      <template>
        <LayoutGroup><CrossfadeNested @contents={{true}} /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#a');
    await wait(250);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 200, left: 200, width: 200, height: 250 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#child'), {
        top: 200,
        left: 200,
        width: 100,
        height: 100,
      })
    );
    await click('#b');
    await wait(250);
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 150, left: 200, width: 150, height: 225 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#child'), {
        top: 150,
        left: 200,
        width: 100,
        height: 100,
      })
    );
  });

  test('component unmounts in a LayoutGroup: Should trigger sibling animation when unmount', async function (assert) {
    await render(<template><GroupUnmount /></template>);
    await wait(50);
    await click('#a');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 90, left: 20, width: 100, height: 100 })
    );
  });

  test("component unmounts in a LayoutGroup: If a sibling's position relative to the parent has changed, it should remain at its position", async function (assert) {
    await render(<template><GroupUnmountList /></template>);
    await wait(50);
    const bbox = $('#b').getBoundingClientRect();
    await click('#a');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#b'), {
        top: bbox.top,
        left: bbox.left,
        width: bbox.width,
        height: bbox.height,
      })
    );
  });

  for (const sibling of [false, true]) {
    test(`A -> undefined -> B transition: ${sibling ? 'As previous, but with rendering layout projecting sibling that is not removed' : 'After removing an element with a layoutId, the next element with that ID should not animate from the last element'}`, async function (assert) {
      await render(
        <template>
          <LayoutGroup><ClearSnapshots @sibling={{sibling}} /></LayoutGroup>
        </template>
      );
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#box'), { top: 100, left: 0, width: 100, height: 100 })
      );
      await click('button');
      await wait(50);
      await click('button');
      await wait(50);
      await should(assert, (a) =>
        expectBbox(a, $('#box'), {
          top: 100,
          left: 200,
          width: 100,
          height: 100,
        })
      );
    });
  }

  test('Shared pointer events: Applies pointer-events: none to follow elements', async function (assert) {
    await render(
      <template>
        <LayoutGroup><FollowPointerEvents /></LayoutGroup>
      </template>
    );
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
    await click('#a');
    await wait(200);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 200, left: 0, width: 300, height: 300 })
    );
    await should(assert, (a) =>
      expectBbox(a, $('#b'), { top: 200, left: 0, width: 300, height: 300 })
    );
    // the follower has pointer-events: none, so the click lands on #b
    await click('#b');
    await wait(200);
    await should(assert, (a) =>
      expectBbox(a, $('#a'), { top: 0, left: 0, width: 100, height: 200 })
    );
  });

  test("Works with queueMicrotasks: queueMicrotasks doesn't break layout measurements", async function (assert) {
    await render(
      <template>
        <LayoutGroup><QueueMicrotask /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#target');
    await wait(150);
    await click('#open');
    await wait(150);
    await settled();
    await click('#target');
    await wait(150);
    await click('#open');
    await wait(150);
    await settled();
    await should(assert, (a) => a.strictEqual($('#error').innerText, ''));
  });

  test('Measures rotated elements correctly when animation is interrupted: Measures correctly', async function (assert) {
    await render(
      <template>
        <LayoutGroup><SharedRotate /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#box');
    await wait(50);
    const bbox = $('#box').getBoundingClientRect();
    await click('#box');
    await wait(50);
    await should(assert, (a) =>
      expectBbox(a, $('#box'), {
        top: bbox.top,
        left: bbox.left,
        width: bbox.width,
        height: bbox.height,
      })
    );
  });

  test('Border radius: Should animate border radius', async function (assert) {
    await render(
      <template>
        <LayoutGroup><BorderRadius /></LayoutGroup>
      </template>
    );
    await wait(50);
    await click('#next');
    await wait(200);
    await should(assert, (a) => {
      const [boxA, boxB] = Array.from(
        document.querySelectorAll('.measure-box')
      );
      const sa = getComputedStyle(boxA!),
        sb = getComputedStyle(boxB!);
      a.notStrictEqual(sa.borderRadius, '0%');
      a.notStrictEqual(sb.borderRadius, '0%');
      a.strictEqual(sb.borderRadius, sa.borderRadius);
    });
  });
});
