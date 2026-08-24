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
import { find, findAll, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { beacon, Choreo, motion, type SpringSpec } from 'glimmer-motion';
import {
  animationsSettled,
  bounds,
  orphanCount,
  setupMotion,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

/** short enough that a whole flight fits inside a test, slow enough to interrupt */
const FAST: SpringSpec = { damping: 40, stiffness: 900 };
const SLOW: SpringSpec = { damping: 26, stiffness: 60 };

const el = (sel: string) => find(sel) as HTMLElement;

module('Integration | choreo | contract', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupMotion(hooks);

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
                <p.Tween @of={{p.all}} @opacity={{0}} @ms={{400}} />
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
              <c.Tween @of={{c.removed "row"}} @opacity={{0}} @ms={{900}} />
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
              <c.Tween @of={{c.removed "row"}} @opacity={{0}} @ms={{900}} />
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
              <c.Tween @of={{c.removed "row"}} @opacity={{0}} @ms={{900}} />
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
            <c.Tween @of={{c.removed "row"}} @opacity={{0}} @ms={{600}} />
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
            <c.Tween @of={{c.removed "card"}} @opacity={{0}} @ms={{400}} />
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
              <c.Tween @of={{c.removed "tok"}} @opacity={{0}} @ms={{300}} />
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
