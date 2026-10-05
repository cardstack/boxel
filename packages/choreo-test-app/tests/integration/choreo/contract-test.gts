/**
 * The <Choreo> contract.
 *
 * The interruption suite next door is a soak: it hammers the real gallery and
 * asserts that nothing was left behind. It catches "the gallery leaked". It
 * cannot tell you *which rule* broke, because it does not state any.
 *
 * This file states them. Every test here is a scar Ember Animated already has —
 * nesting, beacon lifetime, undo, far matching, orphan ownership, measuring
 * inside a transformed parent — written against fixtures small enough that a
 * failure names the defect instead of a demo. Nothing in here renders a
 * gallery component on purpose: a contract that can only be checked through
 * three hundred lines of someone's UI is not a contract.
 *
 * Everything waits with `animationsSettled()` and measures with `bounds()`.
 * There is no `sleep()` used as "it is probably done by now" — where a sleep
 * appears it is deliberately mid-flight, and says so.
 */
import {
  after,
  at,
  beacon,
  Choreo,
  type ChoreoContext,
  type DeriveContext,
  type SpringSpec,
  type StepArgs,
  StepComponent,
  type TimelineNode,
  toMs,
} from '@cardstack/choreo';
import {
  orphanCount,
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import {
  find,
  findAll,
  render,
  settled,
  setupOnerror,
} from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

/** short enough that a whole flight fits inside a test, slow enough to interrupt */
const FAST: SpringSpec = { damping: 40, stiffness: 900 };
const SLOW: SpringSpec = { damping: 26, stiffness: 60 };

const el = (sel: string) => find(sel) as HTMLElement;

/** the region's yielded context, for tests that read the compiled cues */
let ctx: ChoreoContext;
const grabCtx = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

module('Integration | choreo | contract', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  /* ------------------------------------------------------------------ *
   * Anchors — a block is a step's equal
   * ------------------------------------------------------------------ */

  module('anchors', function () {
    /**
     * A composite step (c.Crossing, and anything an author writes) returns a
     * BLOCK, so everything the anchor system offers a step has to be offered
     * to a block too — or a composite is a thing you cannot point at. The
     * crossing works around this today by naming a child `__crossing-flight`
     * and anchoring against that, which is a private string an author reaches
     * only by accident.
     *
     * Start times are read from the compiled cues, in ms: what the compiler
     * resolved, not what the DOM happens to be showing.
     */
    const startOf = (id: string) =>
      ctx.run!.cues.filter((cue) => cue.sprite.id === id).map((c) => c.start);

    test('a named block can be anchored against, and its span is its content', async function (assert) {
      class App extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          anchored = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:60px" as |c|>
            {{grabCtx c}}
            {{#if this.show}}
              <div
                id="a"
                style="width:10px;height:10px"
                {{motion id="a"}}
              ></div>
              <div
                id="b"
                style="width:10px;height:10px"
                {{motion id="b"}}
              ></div>
              <div
                id="c"
                style="width:10px;height:10px"
                {{motion id="c"}}
              ></div>
              <div
                id="d"
                style="width:10px;height:10px"
                {{motion id="d"}}
              ></div>
            {{/if}}
            {{! the composite: two tweens at once, the longer one 0.5s }}
            <c.Parallel @name="intro">
              <c.Tween
                @of={{c.id "a"}}
                @opacity={{array 0 1}}
                @duration={{0.2}}
              />
              <c.Tween
                @of={{c.id "b"}}
                @opacity={{array 0 1}}
                @duration={{0.5}}
              />
            </c.Parallel>
            {{! after the WHOLE block, not after either child }}
            <c.Tween
              @at={{after "intro"}}
              @of={{c.id "c"}}
              @opacity={{array 0 1}}
              @duration={{0.2}}
            />
            {{! and halfway into it }}
            <c.Tween
              @at={{at "intro" 0.5}}
              @of={{c.id "d"}}
              @opacity={{array 0 1}}
              @duration={{0.2}}
            />
          </Choreo>
        </template>
      }
      let anchored: App | undefined;
      await render(<template><App /></template>);
      anchored!.show = true;
      await settled();

      assert.deepEqual(startOf('a'), [0], 'the block starts at the top');
      assert.deepEqual(startOf('b'), [0], 'its children are parallel');
      assert.deepEqual(
        startOf('c'),
        [500],
        'after the block is after its LONGEST child, not its first'
      );
      assert.deepEqual(
        startOf('d'),
        [250],
        'a fraction of a block is a fraction of its span'
      );
      await animationsSettled();
    });

    test('a block takes a delay, and an anchored block lifts out of the flow', async function (assert) {
      class App extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          delayed = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:60px" as |c|>
            {{grabCtx c}}
            {{#if this.show}}
              <div
                id="a"
                style="width:10px;height:10px"
                {{motion id="a"}}
              ></div>
              <div
                id="b"
                style="width:10px;height:10px"
                {{motion id="b"}}
              ></div>
              <div
                id="c"
                style="width:10px;height:10px"
                {{motion id="c"}}
              ></div>
              <div
                id="e"
                style="width:10px;height:10px"
                {{motion id="e"}}
              ></div>
            {{/if}}
            <c.Sequence>
              <c.Tween
                @name="first"
                @of={{c.id "a"}}
                @opacity={{array 0 1}}
                @duration={{0.2}}
              />
              {{! a delayed block: the delay is inside its slot, and it still
                  pushes the sequence forward by delay + content }}
              <c.Parallel @delay={{0.1}}>
                <c.Tween
                  @of={{c.id "b"}}
                  @opacity={{array 0 1}}
                  @duration={{0.3}}
                />
              </c.Parallel>
              {{! an ANCHORED block neither pushes the sequence nor stretches
                  it — §4.2's rule, one level up }}
              <c.Parallel @at={{at "first"}}>
                <c.Tween
                  @of={{c.id "c"}}
                  @opacity={{array 0 1}}
                  @duration={{0.9}}
                />
              </c.Parallel>
              {{! the step after it: this is where "lifts out of the flow"
                  is actually observable }}
              <c.Tween
                @of={{c.id "e"}}
                @opacity={{array 0 1}}
                @duration={{0.1}}
              />
            </c.Sequence>
          </Choreo>
        </template>
      }
      let delayed: App | undefined;
      await render(<template><App /></template>);
      delayed!.show = true;
      await settled();

      assert.deepEqual(startOf('a'), [0], 'the first step is at the top');
      assert.deepEqual(
        startOf('b'),
        [300],
        "the block's delay is spent inside its own slot"
      );
      assert.deepEqual(
        startOf('c'),
        [0],
        'the anchored block starts where it points, not where it sits'
      );
      assert.deepEqual(
        startOf('e'),
        [600],
        'the anchored block did not push the sequence forward (0.2 + 0.1 + 0.3)'
      );
      // it does still lengthen the RUN — a lifted block is out of the flow,
      // not out of the score, and a run is as long as its longest cue
      assert.strictEqual(
        Math.round(ctx.run!.duration * 1000),
        900,
        'the run still spans the anchored block it holds'
      );
      await animationsSettled();
    });
  });

  /* ------------------------------------------------------------------ *
   * Composite steps — a new word, written in the public seam
   * ------------------------------------------------------------------ */

  module('composite steps', function () {
    /**
     * Everything below is written the way an APP would write it: nothing
     * imported from a deep path, nothing the published package does not
     * export. If this file ever needs a privilege to say a new step, the
     * contract on StepComponent is a lie and that is the bug.
     *
     * Hoisted, not allocated per node(): functions in the tree print by
     * identity, so a fresh one per pass would declare an edit every frame.
     */
    const startOf = (id: string) =>
      ctx.run!.cues.filter((cue) => cue.sprite.id === id).map((c) => c.start);

    class Reveal extends StepComponent<
      StepArgs & { duration?: number; rise?: number }
    > {
      node(): TimelineNode {
        const { of, duration = 0.3, rise = 12 } = this.args;
        return {
          at: this.args.at,
          children: [
            {
              generic: true,
              kind: 'tween',
              ms: toMs(duration),
              of,
              props: { opacity: [0, 1] },
            },
            {
              generic: true,
              kind: 'tween',
              ms: toMs(duration),
              of,
              props: { y: [rise, 0] },
            },
          ],
          delay: toMs(this.args.delay),
          kind: 'parallel',
          name: this.args.name,
        };
      }
    }

    test('an app can say a new step, and the score can point at it', async function (assert) {
      class App extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          composed = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:60px" as |c|>
            {{grabCtx c}}
            {{#if this.show}}
              <div
                id="a"
                style="width:10px;height:10px"
                {{motion id="a"}}
              ></div>
              <div
                id="b"
                style="width:10px;height:10px"
                {{motion id="b"}}
              ></div>
            {{/if}}
            <Reveal
              @name="intro"
              @of={{c.id "a"}}
              @duration={{0.4}}
              @delay={{0.1}}
            />
            <c.Tween
              @at={{after "intro"}}
              @of={{c.id "b"}}
              @opacity={{array 0 1}}
              @duration={{0.2}}
            />
          </Choreo>
        </template>
      }
      let composed: App | undefined;
      await render(<template><App /></template>);
      composed!.show = true;
      await settled();

      // the composite expanded: one step in the template, two cues on one
      // sprite, both starting after the composite's own delay
      assert.deepEqual(
        startOf('a'),
        [100, 100],
        "both of the composite's children play, after its delay"
      );
      assert.deepEqual(
        startOf('b'),
        [500],
        'a sibling anchors against the composite as one thing (0.1 + 0.4)'
      );
      await animationsSettled();
    });

    test("a composite's generic children yield to a step that names the sprite", async function (assert) {
      class App extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          yielded = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:60px" as |c|>
            {{grabCtx c}}
            {{#if this.show}}
              <div
                id="a"
                style="width:10px;height:10px"
                {{motion id="a"}}
              ></div>
              <div
                id="b"
                style="width:10px;height:10px"
                {{motion id="b"}}
              ></div>
            {{/if}}
            {{! the composite offers its default to BOTH }}
            <Reveal @of={{c.all}} @duration={{0.4}} />
            {{! …and 'b' takes something else instead, with no exclusion
                syntax anywhere: the yield rule, from the outside }}
            <c.Tween
              @of={{c.id "b"}}
              @opacity={{array 0 1}}
              @duration={{0.9}}
            />
          </Choreo>
        </template>
      }
      let yielded: App | undefined;
      await render(<template><App /></template>);
      yielded!.show = true;
      await settled();

      assert.deepEqual(
        startOf('a').length,
        2,
        'the unclaimed sprite keeps the composite’s two children'
      );
      const b = ctx.run!.cues.filter((cue) => cue.sprite.id === 'b');
      assert.strictEqual(
        b.length,
        1,
        'the claimed sprite is animated once, by the step that named it'
      );
      assert.strictEqual(
        Math.round(b[0]!.duration),
        900,
        'and it is the specific step that owns it, not the composite'
      );
      await animationsSettled();
    });
  });

  /* ------------------------------------------------------------------ *
   * Subjects — the steps that have none
   * ------------------------------------------------------------------ */

  module('subjects', function () {
    /**
     * A wait has no subject and a tether reads only its two ends, so neither
     * should have to name one. `@of` was required on both anyway, which left
     * every author writing `@of={{c.all}}` — a query run on every pass to
     * answer a question nothing asks, and a lie about what the step reads.
     */
    test('a wait needs no @of, and still occupies its sequence', async function (assert) {
      class App extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          waited = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:60px" as |c|>
            {{grabCtx c}}
            {{#if this.show}}
              <div
                id="w"
                style="width:10px;height:10px"
                {{motion id="w"}}
              ></div>
            {{/if}}
            <c.Sequence>
              <c.Tween
                @of={{c.id "w"}}
                @opacity={{array 0 1}}
                @duration={{0.2}}
              />
              <c.Wait @duration={{0.3}} />
              <c.Tween
                @of={{c.id "w"}}
                @opacity={{array 1 0.4}}
                @duration={{0.2}}
              />
            </c.Sequence>
          </Choreo>
        </template>
      }
      let waited: App | undefined;
      await render(<template><App /></template>);
      waited!.show = true;
      await settled();

      assert.deepEqual(
        ctx.run!.cues.map((cue) => [cue.kind, Math.round(cue.start)]),
        [
          ['tween', 0],
          ['wait', 200],
          ['tween', 500],
        ],
        'the subjectless wait holds its 300ms of the sequence open'
      );
      await animationsSettled();
    });
  });

  /* ------------------------------------------------------------------ *
   * c.Follow — a value derived from the scene, every frame
   * ------------------------------------------------------------------ */

  module('follow', function () {
    /**
     * Hoisted, not inline: property functions print by identity, and a
     * fresh closure per render would declare an edit on every pass.
     * `read` pins the badge's top-left to the card's top-right — `rest`
     * is the badge's resting box from the pass, `now` is where the run
     * holds the card this frame.
     */
    const corner = ({ rest, sources }: DeriveContext) => {
      const card = sources[0]!.now;
      return { x: card.x + card.width - rest.x, y: card.y - rest.y };
    };
    const REST = { x: 0, y: 0 };
    /** deliberately illegal: width is layout, and layout is refused */
    const WIDE = { width: 0 };
    /** the fixture under test, for the refusal helper to drive */
    let bad: { show: boolean } | undefined;

    test('a follower tracks its source, and stands at rest when its window closes', async function (assert) {
      class App extends Component {
        @tracked far = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          followed = this;
        }
        <template>
          <Choreo class="stage" style="width:400px;height:200px" as |c|>
            {{grabCtx c}}
            <div style="padding-left:{{if this.far '200px' '0px'}}">
              <div
                id="card"
                style="width:80px;height:40px;background:#0af"
                {{motion id="card" role="card"}}
              ></div>
            </div>
            <div
              id="badge"
              style="position:absolute;top:0;left:0;width:16px;height:16px;background:#f30"
              {{motion id="badge"}}
            ></div>
            <c.Parallel>
              <c.Move @of={{c.moved "card"}} @spring={{SLOW}} />
              <c.Follow
                @of={{c.id "badge"}}
                @to={{c.id "card"}}
                @read={{corner}}
                @rest={{REST}}
                @duration={{0.6}}
              />
            </c.Parallel>
          </Choreo>
        </template>
      }
      let followed: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      followed!.far = true;
      await settled();
      // MID-FLIGHT, deliberately: the point of a follower is that it is
      // right on the frames in between, not only at the ends
      await nextFrame();
      await nextFrame();
      await nextFrame();
      // A follower is EXACT, not merely close: `now` is the source's
      // resting box composed with the values driving it this frame, so it
      // reads the frame being drawn rather than the one last painted. The
      // bound below would be a whole bay wide if it did not — on the
      // first frame of a FLIP the source's layout has already jumped to
      // the destination.
      const step = bounds(el('#card')).left;
      await nextFrame();
      const card = bounds(el('#card'));
      const badge = bounds(el('#badge'));
      const perFrame = Math.abs(card.left - step);
      assert.true(
        perFrame > 1,
        `the card really is in motion (${perFrame.toFixed(1)}px this frame)`
      );
      assert.true(
        Math.abs(badge.left - (card.left + card.width)) < 2,
        `the badge is ON the card's right edge mid-flight (off by ${Math.abs(badge.left - (card.left + card.width)).toFixed(1)}px, a frame of travel is ${perFrame.toFixed(1)}px)`
      );

      await animationsSettled();
      // the window closed: the declared rest is what stands, so a measure
      // pass sees the element where the stylesheet puts it
      // identity spellings — '', 'none', translateX(0px) — are all rest;
      // what must not stand is the 280 it was holding mid-flight
      const style = getComputedStyle(el('#badge')).transform;
      const painted = new DOMMatrix(style === 'none' ? '' : style);
      assert.true(
        Math.abs(painted.e) < 1 && Math.abs(painted.f) < 1,
        `the follower rests where it declared — got '${style}'`
      );
    });

    test('a derived value is a still: seeking back reproduces the frame', async function (assert) {
      class App extends Component {
        @tracked far = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          sought = this;
        }
        <template>
          <Choreo class="stage" style="width:400px;height:200px" as |c|>
            {{grabCtx c}}
            <div style="padding-left:{{if this.far '200px' '0px'}}">
              <div
                id="card2"
                style="width:80px;height:40px;background:#0af"
                {{motion id="card2" role="card2"}}
              ></div>
            </div>
            <div
              id="badge2"
              style="position:absolute;top:0;left:0;width:16px;height:16px;background:#f30"
              {{motion id="badge2"}}
            ></div>
            <c.Parallel>
              <c.Tween
                @of={{c.moved "card2"}}
                @duration={{1}}
                @ease="linear"
                @opacity={{array 1 1}}
              />
              <c.Follow
                @of={{c.id "badge2"}}
                @to={{c.id "card2"}}
                @read={{corner}}
                @rest={{REST}}
                @duration={{1}}
              />
            </c.Parallel>
          </Choreo>
        </template>
      }
      let sought: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      sought!.far = true;
      await settled();

      const run = ctx.run!;
      run.pause();
      run.time = 0.4;
      await nextFrame();
      const first = bounds(el('#badge2')).left;
      run.time = 0.8;
      await nextFrame();
      run.time = 0.4;
      await nextFrame();
      const again = bounds(el('#badge2')).left;
      assert.true(
        Math.abs(first - again) < 1,
        `the same t is the same frame (${Math.round(first)} vs ${Math.round(again)})`
      );
      run.cancel();
    });

    test('a follower computes from the pass, not the page', async function (assert) {
      class App extends Component {
        @tracked far = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          vandal = this;
        }
        <template>
          <Choreo class="stage" style="width:400px;height:200px" as |c|>
            {{grabCtx c}}
            <div style="padding-left:{{if this.far '200px' '0px'}}">
              <div
                id="card3"
                style="width:80px;height:40px;background:#0af"
                {{motion id="card3" role="card3"}}
              ></div>
            </div>
            <div
              id="badge3"
              style="position:absolute;top:0;left:0;width:16px;height:16px;background:#f30"
              {{motion id="badge3"}}
            ></div>
            <c.Parallel>
              <c.Tween
                @of={{c.moved "card3"}}
                @duration={{1}}
                @ease="linear"
                @opacity={{array 1 1}}
              />
              <c.Follow
                @of={{c.id "badge3"}}
                @to={{c.id "card3"}}
                @read={{corner}}
                @rest={{REST}}
                @duration={{1}}
              />
            </c.Parallel>
          </Choreo>
        </template>
      }
      let vandal: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      vandal!.far = true;
      await settled();

      const run = ctx.run!;
      run.pause();
      run.time = 0.4;
      await nextFrame();
      const first = bounds(el('#badge3')).left;
      // Vandalise the page mid-window, with no pass to tell the region:
      // under the API this replaces, @read was handed live boxes and a
      // follower would chase this. Now every box it sees was measured by
      // the pass, so the frame at t is a function of t and nothing else.
      el('#card3').style.marginLeft = '40px';
      run.time = 0.8;
      await nextFrame();
      run.time = 0.4;
      await nextFrame();
      const again = bounds(el('#badge3')).left;
      assert.true(
        Math.abs(first - again) < 1,
        `the frame at t is untouched by a mutation the score never saw (${Math.round(first)} vs ${Math.round(again)})`
      );
      el('#card3').style.marginLeft = '';
      run.cancel();
    });

    /**
     * Both refusals are compile-time and both are load-bearing, so they are
     * asserted the way the gate rules are: render, arm the handler, then
     * make the pass that compiles.
     */
    const refusal = async (
      make: () => object,
      pattern: RegExp,
      what: string,
      assert: Assert
    ) => {
      let message = '';
      setupOnerror((error) => {
        message = String(error);
      });
      const App = make();
      await render(App as never);
      bad!.show = true;
      await settled().catch(() => {});
      assert.true(pattern.test(message), `${what} — got '${message}'`);
      setupOnerror();
    };

    test('a derived value may not write layout', async function (assert) {
      class Layout extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          bad = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:80px" as |c|>
            {{#if this.show}}
              <div id="l1" style="width:10px;height:10px" {{motion id="l1"}}>
              </div>
              <div id="l2" style="width:10px;height:10px" {{motion id="l2"}}>
              </div>
            {{/if}}
            <c.Follow
              @of={{c.id "l1"}}
              @to={{c.id "l2"}}
              @read={{corner}}
              @rest={{WIDE}}
              @duration={{0.2}}
            />
          </Choreo>
        </template>
      }
      await refusal(
        () => <template><Layout /></template>,
        /may only write transform/,
        'driving width is refused where the author can still read the name',
        assert
      );
    });

    test('a follower may not follow a follower', async function (assert) {
      class Chain extends Component {
        @tracked show = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          bad = this;
        }
        <template>
          <Choreo class="stage" style="width:200px;height:80px" as |c|>
            {{#if this.show}}
              <div id="c1" style="width:10px;height:10px" {{motion id="c1"}}>
              </div>
              <div id="c2" style="width:10px;height:10px" {{motion id="c2"}}>
              </div>
              <div id="c3" style="width:10px;height:10px" {{motion id="c3"}}>
              </div>
            {{/if}}
            <c.Follow
              @of={{c.id "c1"}}
              @to={{c.id "c2"}}
              @read={{corner}}
              @rest={{REST}}
              @duration={{0.2}}
            />
            <c.Follow
              @of={{c.id "c2"}}
              @to={{c.id "c3"}}
              @read={{corner}}
              @rest={{REST}}
              @duration={{0.2}}
            />
          </Choreo>
        </template>
      }
      await refusal(
        () => <template><Chain /></template>,
        /may not follow a follower/,
        'a chain is refused rather than half-supported',
        assert
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * Nesting — an inner region is another scene
   * ------------------------------------------------------------------ */

  module('nesting', function () {
    test('a region does not see the participants of a region inside it', async function (assert) {
      class App extends Component {
        @tracked open = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo @id="shell" class="shell" as |c|>
            <div style="height:{{if this.open '200px' '100px'}}">
              <div
                id="card"
                style="width:60px;height:20px"
                {{motion id="card" role="card"}}
              ></div>

              <Choreo @id="panel" class="panel" as |p|>
                <div
                  id="row"
                  style="width:40px;height:20px"
                  {{motion id="row" role="row"}}
                ></div>
                <p.Move @of={{p.moved "row"}} @spring={{FAST}} />
              </Choreo>
            </div>
            <c.Move @of={{c.kept "card"}} @spring={{FAST}} />
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.open = true;
      await settled();

      const shell = el('.shell');
      const panel = el('.panel');
      // the participant inside the panel belongs to the panel, by DOM ancestry
      assert.strictEqual(
        el('#row').closest('[data-choreo]'),
        panel,
        'the row’s nearest region is the panel'
      );
      assert.strictEqual(
        el('#card').closest('[data-choreo]'),
        shell,
        'the card’s is the shell'
      );
      await animationsSettled();
    });

    test('an inner timeline is not collected by the region above it', async function (assert) {
      // The inner <p.Move> would match the shell's own `moved` query if the
      // shell walked into the panel's subtree looking for steps. It must not:
      // a nested region declares its own scene, and the only reason this is
      // even possible to get wrong is that steps are found by walking the DOM.
      class App extends Component {
        @tracked tall = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo @id="shell" class="shell">
            <div style="padding-top:{{if this.tall '80px' '0px'}}">
              <div
                id="card"
                style="width:60px;height:20px"
                {{motion id="card" role="card"}}
              ></div>
              <Choreo @id="panel" class="panel" as |p|>
                <p.Tween @of={{p.all}} @opacity={{0}} @duration={{0.4}} />
              </Choreo>
            </div>
            {{! deliberately no step of its own: if the shell collected the
                panel's fade, the card would be the thing it faded }}
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.tall = true;
      await animationsSettled();

      assert.strictEqual(
        el('#card').style.opacity,
        '',
        'the panel’s fade never reached the shell’s card'
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * Beacons — a name, a lifetime, and no identity
   * ------------------------------------------------------------------ */

  module('beacons', function () {
    // Every fixture here keeps the leaving row alive with a long fade, so the
    // flight can be measured while it is still happening. Without it the row's
    // row ends and the element is dropped, and the test measures nothing.
    test('the first element to claim a name keeps it', async function (assert) {
      class App extends Component {
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          {{! padding-top stops the stage's margin collapsing out through the
              wrapper, which would move the container itself and make every
              measurement here relative to nothing }}
          <div style="position:relative;height:420px;padding-top:1px">
            <span
              id="first"
              style="position:absolute;left:250px;top:10px;width:20px;height:20px"
              {{beacon "bin"}}
            ></span>
            <span
              id="second"
              style="position:absolute;left:10px;top:340px;width:20px;height:20px"
              {{beacon "bin"}}
            ></span>

            <Choreo class="stage" style="height:120px;margin-top:140px" as |c|>
              {{#if this.show}}
                <div
                  class="row"
                  style="width:40px;height:20px"
                  {{motion id="row" role="row"}}
                ></div>
              {{/if}}
              <c.Move
                @of={{c.removed "row"}}
                @to={{c.beacon "bin"}}
                @spring={{SLOW}}
              />
              <c.Tween
                @of={{c.removed "row"}}
                @opacity={{0}}
                @duration={{0.9}}
              />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const start = bounds(el('.row'));

      app!.show = false;
      await settled();
      await sleep(250); // mid-flight on purpose: the row is on its way to the bin
      await nextFrame();

      const now = bounds(el('.row'));
      assert.ok(
        now.left > start.left + 20 && now.top < start.top - 5,
        `it aimed at the FIRST claimant, up and to the right (${Math.round(start.left)},${Math.round(start.top)} -> ${Math.round(now.left)},${Math.round(now.top)})`
      );
      await animationsSettled();
    });

    test('a beacon that leaves gives the name back', async function (assert) {
      class App extends Component {
        @tracked marked = true;
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="position:relative;height:400px">
            {{#if this.marked}}
              <span
                id="bin"
                style="position:absolute;left:250px;top:10px;width:20px;height:20px"
                {{beacon "bin"}}
              ></span>
            {{/if}}

            <Choreo class="stage" style="height:120px;margin-top:140px" as |c|>
              {{#if this.show}}
                <div
                  class="row"
                  style="width:40px;height:20px"
                  {{motion id="row" role="row"}}
                ></div>
              {{/if}}
              <c.Move
                @of={{c.removed "row"}}
                @to={{c.beacon "bin"}}
                @spring={{SLOW}}
              />
              <c.Tween
                @of={{c.removed "row"}}
                @opacity={{0}}
                @duration={{0.9}}
              />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const home = bounds(el('.row'));

      app!.marked = false;
      await animationsSettled();
      app!.show = false;
      await settled();
      await sleep(250); // mid-row: with nobody holding the name there is nowhere to go
      const now = bounds(el('.row'));
      assert.ok(
        Math.abs(now.left - home.left) < 4 && Math.abs(now.top - home.top) < 4,
        `an unclaimed name leaves the move alone (${Math.round(now.left)},${Math.round(now.top)})`
      );
      assert.ok(
        parseFloat(getComputedStyle(el('.row')).opacity) < 1,
        'the rest of its row still played'
      );
      await animationsSettled();
    });

    test('a beacon that moves is measured again, even though the list did not render', async function (assert) {
      // This is why beacons are re-measured every pass and never cached. The
      // bin lives in the chrome: a header collapsing, a column resizing or a
      // scroll moves it without the region rendering at all.
      class App extends Component {
        @tracked pushed = false;
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="position:relative;height:400px">
            <span
              id="bin"
              style="position:absolute;left:{{if
                this.pushed
                '300px'
                '0px'
              }};top:10px;width:20px;height:20px"
              {{beacon "bin"}}
            ></span>

            <Choreo class="stage" style="height:120px;margin-top:200px" as |c|>
              {{#if this.show}}
                <div
                  class="row"
                  style="width:40px;height:20px"
                  {{motion id="row" role="row"}}
                ></div>
              {{/if}}
              <c.Move
                @of={{c.removed "row"}}
                @to={{c.beacon "bin"}}
                @spring={{SLOW}}
              />
              <c.Tween
                @of={{c.removed "row"}}
                @opacity={{0}}
                @duration={{0.9}}
              />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const start = bounds(el('.row'));

      // move the beacon; the region's own contents are untouched by this
      app!.pushed = true;
      await animationsSettled();

      app!.show = false;
      await settled();
      await sleep(250); // mid-flight
      await nextFrame();
      const now = bounds(el('.row'));
      assert.ok(
        now.left > start.left + 20,
        `the flight aimed at where the bin is NOW, not where it was (${Math.round(start.left)} -> ${Math.round(now.left)})`
      );
      await animationsSettled();
    });
  });

  /* ------------------------------------------------------------------ *
   * Undo — a leaver that comes back
   * ------------------------------------------------------------------ */

  module('undo', function () {
    test('a leaver that returns mid-flight is one element, not two', async function (assert) {
      class App extends Component {
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo class="stage" style="height:200px" as |c|>
            {{#if this.show}}
              <div
                class="row"
                style="width:40px;height:20px"
                {{motion id="row" role="row"}}
              ></div>
            {{/if}}
            <c.Move @of={{c.kept "row"}} @spring={{SLOW}} />
            <c.Tween @of={{c.removed "row"}} @opacity={{0}} @duration={{0.6}} />
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.show = false;
      await settled();
      await sleep(120); // the leaver is fading in the orphan layer
      assert.strictEqual(orphanCount(), 1, 'it is in flight');

      app!.show = true;
      await animationsSettled();

      assert.strictEqual(
        findAll('.row').length,
        1,
        'one row, not the returning one alongside its own ghost'
      );
      assert.strictEqual(orphanCount(), 0, 'nothing left in the orphan layer');
      assert.deepEqual(strandedTransforms(), [], 'and no borrowed transform');
      assert.strictEqual(
        el('.row').style.opacity,
        '',
        'the fade was released, not left at whatever it had reached'
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * Orphans — who owns a removed element
   * ------------------------------------------------------------------ */

  module('orphans', function () {
    /**
     * The external-scale rule, at the orphan lock: a leaver is locked at
     * its PAGE coordinates, but those are client-space measurements that
     * carry every ancestor transform, and the offsets are written as
     * local pixels inside the (equally transformed) orphan layer. Inside
     * a scaled ancestor — a page crossing carrying the region — the
     * subtraction bakes the scale in twice and the leaver jumps the
     * moment it is lifted.
     */
    test('a leaver orphaned inside a scaled ancestor is locked where it stood', async function (assert) {
      class App extends Component {
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          {{! the crossing, reduced to the one wrapper that matters }}
          <div style="transform:scale(0.5);transform-origin:0 0">
            <Choreo
              class="stage"
              style="position:relative;width:400px;height:200px"
              as |c|
            >
              {{#if this.show}}
                <div
                  id="bye"
                  style="margin:60px 0 0 140px;width:120px;height:60px;background:#0af"
                  {{motion id="bye" role="bye"}}
                ></div>
              {{/if}}
              <c.Tween
                @of={{c.removed "bye"}}
                @opacity={{0}}
                @duration={{0.4}}
              />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const before = el('#bye').getBoundingClientRect();

      app!.show = false;
      await settled();
      await nextFrame();
      assert.strictEqual(orphanCount(), 1, 'the leaver was lifted');
      const after = el('#bye').getBoundingClientRect();
      assert.true(
        Math.abs(after.left - before.left) < 2 &&
          Math.abs(after.top - before.top) < 2,
        `locked where it stood on the page (${Math.round(before.left)},${Math.round(
          before.top
        )} → ${Math.round(after.left)},${Math.round(after.top)})`
      );
      assert.true(
        Math.abs(after.width - before.width) < 2,
        `at its own size (${Math.round(before.width)} → ${Math.round(after.width)})`
      );
      await animationsSettled();
    });

    test('only the topmost removed element is orphaned; its children go with it', async function (assert) {
      class App extends Component {
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo class="stage" style="height:200px" as |c|>
            {{#if this.show}}
              <div
                id="parent"
                style="width:120px;height:60px"
                {{motion id="parent" role="card"}}
              >
                <span
                  id="child"
                  style="display:block;width:40px;height:20px"
                  {{motion id="child" role="card"}}
                ></span>
              </div>
            {{/if}}
            <c.Tween
              @of={{c.removed "card"}}
              @opacity={{0}}
              @duration={{0.4}}
            />
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.show = false;
      await settled();
      await sleep(80); // mid-row

      assert.strictEqual(
        orphanCount(),
        1,
        'one thing was lifted into the layer, not two'
      );
      assert.ok(
        el('#child').closest('#parent'),
        'the child rode along inside its parent'
      );
      await animationsSettled();
      assert.strictEqual(orphanCount(), 0, 'and both are gone at the end');
    });
  });

  /* ------------------------------------------------------------------ *
   * Far matching — one identity, more than one region
   * ------------------------------------------------------------------ */

  module('far matching', function () {
    test('with three regions, the id lands in the one that received it', async function (assert) {
      class App extends Component {
        @tracked where = 'a';
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="display:flex;gap:60px;align-items:flex-start">
            <Choreo
              @id="a"
              class="stage"
              style="width:120px;height:100px"
              as |c|
            >
              {{#if this.isA}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/if}}
              <c.Move @of={{c.kept "tok"}} @spring={{FAST}} />
            </Choreo>
            <Choreo
              @id="b"
              class="stage"
              style="width:120px;height:100px"
              as |c|
            >
              {{#if this.isB}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/if}}
              <c.Move @of={{c.kept "tok"}} @spring={{FAST}} />
            </Choreo>
            <Choreo
              @id="c"
              class="stage"
              style="width:120px;height:100px"
              as |c|
            >
              {{#if this.isC}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/if}}
              <c.Move @of={{c.kept "tok"}} @spring={{FAST}} />
            </Choreo>
          </div>
        </template>
        get isA() {
          return this.where === 'a';
        }
        get isB() {
          return this.where === 'b';
        }
        get isC() {
          return this.where === 'c';
        }
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const start = bounds(el('.tok'));

      app!.where = 'c';
      await settled();

      assert.strictEqual(findAll('.tok').length, 1, 'one token, still');
      const pinned = bounds(el('.tok'));
      assert.ok(
        Math.abs(pinned.left - start.left) < 4,
        `pinned where the sender stood (${Math.round(start.left)} \u2192 ${Math.round(pinned.left)})`
      );
      assert.strictEqual(
        orphanCount(),
        0,
        'the sender was let go quietly, not orphaned alongside the receiver'
      );

      await animationsSettled();
      const landed = bounds(el('.tok'));
      assert.ok(
        landed.left > start.left + 100,
        `and it flew to the third region (${Math.round(landed.left)})`
      );
      assert.deepEqual(strandedTransforms(), [], 'nothing kept a transform');
    });

    test('an id with no other half is an ordinary removal', async function (assert) {
      class App extends Component {
        @tracked show = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="display:flex;gap:60px">
            <Choreo
              @id="left"
              class="stage"
              style="width:120px;height:100px"
              as |c|
            >
              {{#if this.show}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/if}}
              <c.Tween
                @of={{c.removed "tok"}}
                @opacity={{0}}
                @duration={{0.3}}
              />
            </Choreo>
            {{! a second region that renders every pass and receives nothing }}
            <Choreo
              @id="right"
              class="stage"
              style="width:120px;height:100px"
              as |c|
            >
              <div
                class="other"
                style="width:30px;height:{{if this.show '30px' '60px'}}"
                {{motion id="other" role="other"}}
              ></div>
              <c.Move @of={{c.moved "other"}} @spring={{FAST}} />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.show = false;
      await settled();
      await sleep(80); // mid-row
      assert.strictEqual(
        orphanCount(),
        1,
        'unmatched, so its own region plays its removal'
      );

      await animationsSettled();
      assert.strictEqual(findAll('.tok').length, 0, 'and then it is gone');
      assert.strictEqual(orphanCount(), 0, 'with nothing stranded');
    });

    test('a far match interrupted mid-flight strands nothing', async function (assert) {
      class App extends Component {
        @tracked here = true;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="display:flex;gap:120px">
            <Choreo
              @id="left"
              class="stage"
              style="width:150px;height:120px"
              as |c|
            >
              {{#if this.here}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/if}}
              <c.Move @of={{c.kept "tok"}} @spring={{SLOW}} />
            </Choreo>
            <Choreo
              @id="right"
              class="stage"
              style="width:150px;height:120px"
              as |c|
            >
              {{#unless this.here}}
                <div
                  class="tok"
                  style="width:30px;height:30px"
                  {{motion id="token" role="tok"}}
                ></div>
              {{/unless}}
              <c.Move @of={{c.kept "tok"}} @spring={{SLOW}} />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const home = bounds(el('.tok'));

      for (const flip of [false, true, false, true]) {
        app!.here = flip;
        await settled();
        await sleep(70); // send it back before the last flight finished
      }
      await animationsSettled();

      assert.strictEqual(findAll('.tok').length, 1, 'exactly one token');
      assert.strictEqual(orphanCount(), 0, 'no sender left behind');
      assert.deepEqual(strandedTransforms(), [], 'no borrowed transform');
      const rest = bounds(el('.tok'));
      assert.ok(
        Math.abs(rest.left - home.left) < 2 &&
          Math.abs(rest.top - home.top) < 2,
        `and it came to rest where the stylesheet puts it (${Math.round(rest.left)},${Math.round(rest.top)})`
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * Measurement — the space two regions can agree on
   * ------------------------------------------------------------------ */

  module('measurement', function () {
    test('a Move inside a transformed parent still lands where the stylesheet puts it', async function (assert) {
      // Bounds cross a region boundary in page space, and a transformed
      // ancestor is exactly what makes page space and offset space disagree.
      class App extends Component {
        @tracked wide = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <div style="transform: translate(37px, 23px)">
            <Choreo class="stage" style="width:300px;height:200px" as |c|>
              <div style="padding-left:{{if this.wide '120px' '0px'}}">
                <div
                  id="box"
                  style="width:40px;height:40px"
                  {{motion id="box" role="box"}}
                ></div>
              </div>
              <c.Move @of={{c.moved "box"}} @spring={{FAST}} />
            </Choreo>
          </div>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const start = bounds(el('#box'));

      app!.wide = true;
      await settled();
      const pinned = bounds(el('#box'));
      assert.ok(
        Math.abs(pinned.left - start.left) < 2,
        `pinned where it was, not 37px off (${Math.round(start.left)} → ${Math.round(pinned.left)})`
      );

      await animationsSettled();
      const rest = bounds(el('#box'));
      assert.ok(
        Math.abs(rest.left - (start.left + 120)) < 2,
        `and it arrives at the new layout (${Math.round(rest.left)})`
      );
      // scoped to the region: the fixture's own wrapper carries the transform
      // this test is about, and it is not a leak
      assert.deepEqual(
        strandedTransforms(el('.stage')),
        [],
        'with nothing left on it'
      );
    });

    test('a moved wrapper is a reflow: the pass may not be declined for it', async function (assert) {
      // The fast keep fingerprints layout to decide whether a pass can be
      // declined. What a render moves may be an ANCESTOR that is a
      // participant of nothing — Escort's seat, one positioned wrapper
      // carrying three participants — and a fingerprint read at the
      // participant alone (offsetLeft against that same wrapper) is blind
      // to it. Declined, the old run plays on against the moved layout
      // and everything in the seat teleports a whole bay, together,
      // mid-flight. This is that page, reduced.
      class App extends Component {
        @tracked far = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo
            class="stage"
            style="width:400px;height:120px;position:relative"
            as |c|
          >
            {{grabCtx c}}
            <div
              style="position:absolute;top:0;left:{{if this.far '200px' '0px'}}"
            >
              <div
                id="seated"
                style="width:60px;height:40px;background:#0af"
                {{motion id="seated" role="seated"}}
              ></div>
            </div>
            <c.Move @of={{c.moved "seated"}} @spring={{SLOW}} />
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();

      app!.far = true;
      await settled();
      await nextFrame();
      await nextFrame();
      await nextFrame();
      const before = ctx.run;
      const mid = bounds(el('#seated')).left;

      // the retarget, mid-flight, again through the wrapper alone
      app!.far = false;
      await settled();
      await nextFrame();
      const after = bounds(el('#seated')).left;
      assert.true(
        Math.abs(after - mid) < 30,
        `the retarget pins the painted box, it does not teleport ` +
          `(${Math.round(mid)} → ${Math.round(after)})`
      );
      assert.true(
        ctx.run !== before && ctx.run !== undefined,
        'a moved wrapper compiled a replacement run'
      );

      await animationsSettled();
      const rest = bounds(el('#seated')).left;
      const home = bounds(el('.stage')).left;
      assert.true(
        Math.abs(rest - home) < 2,
        `and it lands where the wrapper now rests (${Math.round(rest)} vs ${Math.round(home)})`
      );
    });
  });

  /* ------------------------------------------------------------------ *
   * The waiter itself
   * ------------------------------------------------------------------ */

  module('animationsSettled', function () {
    test('it waits for a spring, and it is not simply waiting for settled()', async function (assert) {
      class App extends Component {
        @tracked wide = false;
        constructor(o: unknown, a: object) {
          super(o as never, a);
          app = this;
        }
        <template>
          <Choreo class="stage" style="width:400px;height:200px" as |c|>
            <div style="padding-left:{{if this.wide '200px' '0px'}}">
              <div
                id="box"
                style="width:40px;height:40px"
                {{motion id="box" role="box"}}
              ></div>
            </div>
            <c.Move @of={{c.moved "box"}} @spring={{SLOW}} />
          </Choreo>
        </template>
      }
      let app: App | undefined;
      await render(<template><App /></template>);
      await animationsSettled();
      const start = bounds(el('#box'));

      app!.wide = true;
      await settled();
      // settled() returns with the flight barely begun — this is the assertion
      // that the waiter is doing real work rather than resolving immediately
      const justAfterSettled = bounds(el('#box'));
      assert.ok(
        justAfterSettled.left < start.left + 40,
        `settled() alone leaves it near the start (${Math.round(justAfterSettled.left)})`
      );

      await animationsSettled();
      const rest = bounds(el('#box'));
      assert.ok(
        Math.abs(rest.left - (start.left + 200)) < 2,
        `animationsSettled() waited for the spring to arrive (${Math.round(rest.left)})`
      );
    });
  });
});
