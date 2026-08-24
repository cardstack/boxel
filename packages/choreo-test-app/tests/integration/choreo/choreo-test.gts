/**
 * <Choreo>: boxel-motion's region-scoped choreography on the motion-dom engine.
 * docs/choreography.md is the spec these pin.
 */
import { array, hash } from '@ember/helper';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import {
  beacon,
  type Changeset,
  Choreo,
  motion,
  Presence,
  type Sprite,
} from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

const keyOf = (x: { key: string }) => x.key;
const FAST = { damping: 40, stiffness: 900 };
const SOFT = { damping: 16, stiffness: 80 };

const cellStyle = (k: string, open: string) =>
  k === open ? 'grid-column: 1 / -1; height: 60px' : 'height: 30px';

const opacityOf = (sel: string) =>
  parseFloat(getComputedStyle(find(sel)!).opacity);

module('Integration | choreo', function (hooks) {
  setupRenderingTest(hooks);
  // bounds are measured: an unscaled viewport, as the layout suites have
  setupFixtureViewport(hooks);

  test('a removed participant stays, locked where it was, for exactly its row', async function (assert) {
    class App extends Component {
      @tracked show = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="width:300px;height:200px" as |c|>
          <div style="padding:20px">
            {{#if this.show}}
              <div
                id="leaver"
                style="width:100px;height:40px;background:#0af"
                {{motion id="leaver" role="card"}}
              ></div>
            {{/if}}
          </div>
          <c.Tween @of={{c.removed "card"}} @opacity={{0}} @duration={{0.12}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const before = find('#leaver')!.getBoundingClientRect();
    app!.show = false;
    await settled();
    const el = find('#leaver') as HTMLElement | null;
    assert.ok(el, 'the removed element is still in the document');
    assert.ok(
      el!.closest('[data-choreo-orphans]'),
      'it lives in the orphan layer'
    );
    assert.strictEqual(el!.style.position, 'absolute', 'locked');
    const after = el!.getBoundingClientRect();
    assert.strictEqual(Math.round(after.left), Math.round(before.left));
    assert.strictEqual(Math.round(after.top), Math.round(before.top));
    assert.strictEqual(Math.round(after.width), Math.round(before.width));
    await sleep(60);
    assert.ok(find('#leaver'), 'still there mid-row');
    assert.ok(opacityOf('#leaver') < 1, 'and fading');
    await sleep(160);
    await nextFrame();
    assert.notOk(find('#leaver'), 'gone when its row ends');
  });

  test('a removed participant no step names goes at once', async function (assert) {
    class App extends Component {
      @tracked show = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo as |c|>
          {{#if this.show}}
            <div id="leaver" {{motion id="leaver" role="card"}}></div>
          {{/if}}
          <div id="other" {{motion id="other" role="other"}}></div>
          <c.Tween @of={{c.kept "other"}} @opacity={{0.5}} @duration={{0.1}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.show = false;
    await settled();
    await nextFrame();
    assert.notOk(find('#leaver'));
  });

  test('the first render never animates; an all-kept pass still runs its timeline', async function (assert) {
    // docs/choreo-constructs.md §3.1: the share badge, the hot wire — a Hold
    // with a lifetime fired by an event that inserts, removes and moves
    // nothing. Steps that select CHANGE stay quiet on such a pass.
    let holds = 0;
    let changed = 0;
    const count = () => {
      holds++;
      return 0;
    };
    const countChanged = () => {
      changed++;
      return 0;
    };
    class App extends Component {
      @tracked label = 'a';
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo as |c|>
          <div id="box" {{motion id="box"}}>{{this.label}}</div>
          <c.Parallel>
            <c.Hold @of={{c.all}} @zIndex={{count}} @duration={{0.01}} />
            <c.Tween
              @of={{c.moved}}
              @opacity={{countChanged}}
              @duration={{0.01}}
            />
          </c.Parallel>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    assert.strictEqual(holds, 0, 'first render never animates');
    app!.label = 'b';
    await settled();
    await nextFrame();
    assert.strictEqual(holds, 1, 'the all-kept pass ran its timeline');
    assert.strictEqual(changed, 0, 'steps that select change stayed quiet');
  });

  test('Move: a kept participant animates from where it was to where it is', async function (assert) {
    class App extends Component {
      @tracked shifted = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return this.shifted ? 'padding-left:150px' : 'padding-left:0';
      }
      <template>
        <Choreo as |c|>
          <div style={{this.pad}}>
            <div
              id="mover"
              style="width:50px;height:50px"
              {{motion id="mover" role="card"}}
            ></div>
          </div>
          <c.Move @of={{c.kept "card"}} @spring={{FAST}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const x0 = find('#mover')!.getBoundingClientRect().left;
    app!.shifted = true;
    await settled();
    await nextFrame();
    const mid = find('#mover')!.getBoundingClientRect().left;
    assert.ok(
      mid < x0 + 150 && mid >= x0 - 1,
      `on its way from ${x0} (${mid})`
    );
    assert.ok(
      (find('#mover') as HTMLElement).style.transform.includes('translateX'),
      'moved with a transform'
    );
    await sleep(700);
    await nextFrame();
    const end = find('#mover')!.getBoundingClientRect().left;
    assert.strictEqual(Math.round(end), Math.round(x0 + 150));
  });

  test('Hold: sets at its start, releases at its end, restores a prior value, keeps with @fill', async function (assert) {
    class App extends Component {
      @tracked n = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.n * 20}px`;
      }
      <template>
        <Choreo as |c|>
          <div style={{this.pad}}>
            <div id="a" {{motion id="a" role="card"}}></div>
            <div
              id="b"
              {{motion id="b" role="card" style=(hash zIndex=5)}}
            ></div>
            <div id="k" {{motion id="k" role="keep"}}></div>
          </div>
          <c.Parallel>
            <c.Hold @of={{c.role "card"}} @zIndex={{9}} @duration={{0.1}} />
            <c.Hold @of={{c.role "keep"}} @zIndex={{3}} @fill={{true}} />
            <c.Wait @of={{c.all}} @duration={{0.1}} />
          </c.Parallel>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.n = 1;
    await settled();
    await nextFrame();
    const a = find('#a') as HTMLElement;
    const b = find('#b') as HTMLElement;
    const k = find('#k') as HTMLElement;
    assert.strictEqual(a.style.zIndex, '9', 'held');
    assert.strictEqual(b.style.zIndex, '9', 'held over the prior value');
    assert.strictEqual(k.style.zIndex, '3', 'filled');
    await sleep(160);
    await nextFrame();
    assert.strictEqual(a.style.zIndex, '', 'released: removed');
    assert.strictEqual(b.style.zIndex, '5', 'released: restored');
    assert.strictEqual(k.style.zIndex, '3', 'kept');
  });

  test('Sequence: offsets accumulate, including after a spring; a hold without @ms spans its block', async function (assert) {
    let cs: Changeset | undefined;
    const grab = (_s: Sprite, changeset: Changeset) => {
      cs = changeset;
      return 1;
    };
    class App extends Component {
      @tracked n = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.n * 30}px`;
      }
      <template>
        <Choreo as |c|>
          <div style={{this.pad}}>
            <div
              id="a"
              style="width:40px;height:40px"
              {{motion id="a" role="card"}}
            ></div>
          </div>
          <c.Sequence>
            <c.Tween @of={{c.kept "card"}} @opacity={{0.5}} @duration={{0.1}} />
            <c.Parallel>
              <c.Move @of={{c.kept "card"}} @spring={{FAST}} />
              <c.Hold @of={{c.kept "card"}} @zIndex={{7}} />
            </c.Parallel>
            <c.Tween @of={{c.kept "card"}} @opacity={{grab}} @duration={{0.1}} />
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.n = 1;
    await settled();
    await nextFrame();
    const el = find('#a') as HTMLElement;
    assert.strictEqual(el.style.zIndex, '', 'the hold has not started');
    assert.ok(cs, 'property functions were resolved against the changeset');
    assert.strictEqual(cs!.kept.length, 1);
    assert.strictEqual(cs!.kept[0]!.delta!.x, 30);
    await sleep(150);
    await nextFrame();
    assert.strictEqual(el.style.zIndex, '7', 'held while the move runs');
    assert.ok(
      el.style.transform.includes('translateX'),
      'the move is under way'
    );
    await sleep(700);
    await nextFrame();
    assert.strictEqual(el.style.zIndex, '', 'released when the parallel ended');
    assert.strictEqual(
      opacityOf('#a'),
      1,
      'the last tween ran after the spring'
    );
  });

  test('a property function reads another sprite’s bounds', async function (assert) {
    const fromContainer = (_s: Sprite, cs: Changeset) =>
      cs.sprite({ id: 'container' })!.final!.parent.width;
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get w() {
        return this.wide ? 'width:200px' : 'width:100px';
      }
      <template>
        <Choreo as |c|>
          <div id="container" style={{this.w}} {{motion id="container"}}></div>
          <div id="content" {{motion id="content"}}></div>
          <c.Tween @of={{c.id "content"}} @width={{fromContainer}} @duration={{0.05}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.wide = true;
    await settled();
    await sleep(120);
    await nextFrame();
    assert.strictEqual((find('#content') as HTMLElement).style.width, '200px');
  });

  test('a leaving <Presence> child is a removed sprite; its exit completes when its row ends', async function (assert) {
    class App extends Component {
      @tracked items: { key: string }[] = [{ key: 'a' }];
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo as |c|>
          <Presence @items={{this.items}} @key={{keyOf}} as |item h|>
            <div
              class="leaver"
              data-key={{item.key}}
              {{motion presence=h id=item.key role="card"}}
            ></div>
          </Presence>
          <c.Tween @of={{c.removed "card"}} @opacity={{0}} @duration={{0.12}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.items = [];
    await settled();
    await sleep(50);
    assert.ok(find('.leaver'), 'held by the Presence while the row plays');
    assert.ok(opacityOf('.leaver') < 1, 'and fading');
    await sleep(150);
    await settled();
    assert.notOk(find('.leaver'), 'released when the row ended');
  });

  test('an inserted id that matches a removed one carries the old element as its counterpart', async function (assert) {
    let seen: Sprite | undefined;
    const grab = (s: Sprite) => {
      seen = s;
      return 1;
    };
    class App extends Component {
      @tracked gen = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo as |c|>
          {{#each (array this.gen) key="@identity" as |g|}}
            <div
              id="card-{{g}}"
              style="width:60px;height:30px"
              {{motion id="card" role="card"}}
            ></div>
          {{/each}}
          <c.Tween @of={{c.kept "card"}} @opacity={{grab}} @duration={{0.08}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.gen = 1;
    await settled();
    assert.ok(seen, 'the new element is a kept sprite');
    assert.strictEqual(seen!.type, 'kept');
    assert.ok(seen!.counterpart, 'with a counterpart');
    assert.strictEqual(seen!.counterpart!.element.id, 'card-0');
    assert.ok(
      seen!.counterpart!.element.closest('[data-choreo-orphans]'),
      'the old element is orphaned for the row'
    );
    await sleep(140);
    await nextFrame();
    assert.notOk(find('#card-0'), 'and dropped after it');
  });

  test('received / counterpart select only the two halves of a match, never an ordinary pass', async function (assert) {
    // The distinction these selectors exist for: `kept` also matches a sprite
    // whose bounds merely changed — which is every resize the region ever
    // sees — so a flight step written on `kept` re-fires on passes that are
    // not flights. `received` and `counterpart` fire only when an identity
    // actually changed hands.
    const seenReceived: Sprite[] = [];
    const seenCounterpart: Sprite[] = [];
    const grabReceived = (s: Sprite) => {
      seenReceived.push(s);
      return 1;
    };
    const grabCounterpart = (s: Sprite) => {
      seenCounterpart.push(s);
      return 0;
    };
    class App extends Component {
      @tracked gen = 0;
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get width() {
        return this.wide ? 'width:120px' : 'width:60px';
      }
      <template>
        <Choreo as |c|>
          {{#each (array this.gen) key="@identity" as |g|}}
            <div
              id="card-{{g}}"
              style="{{this.width}};height:30px"
              {{motion id="card" role="card"}}
            ></div>
          {{/each}}
          <c.Tween
            @of={{c.received "card"}}
            @opacity={{grabReceived}}
            @duration={{0.08}}
          />
          <c.Tween
            @of={{c.counterpart "card"}}
            @opacity={{grabCounterpart}}
            @duration={{0.08}}
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.wide = true;
    await settled();
    assert.strictEqual(
      seenReceived.length,
      0,
      'a resize is kept, not received'
    );
    assert.strictEqual(seenCounterpart.length, 0, 'and claims nothing');
    app!.gen = 1;
    await settled();
    assert.strictEqual(seenReceived.length, 1, 'the arriving element');
    assert.strictEqual(seenReceived[0]!.element.id, 'card-1');
    assert.strictEqual(seenReceived[0]!.type, 'kept', 'is a kept sprite');
    assert.strictEqual(seenCounterpart.length, 1, 'the claimed leaver');
    assert.strictEqual(seenCounterpart[0]!.element.id, 'card-0');
    assert.strictEqual(
      seenCounterpart[0],
      seenReceived[0]!.counterpart,
      'and they are the two halves of one match'
    );
    await sleep(140);
    await nextFrame();
    assert.notOk(find('#card-0'), 'the counterpart is released with its row');
  });

  test('an interrupted Move hands its borrowed size back, so the next pass measures a true layout', async function (assert) {
    // The failure this pins: switching the open card mid-flight left the old
    // hero frozen at its animating width, which squeezed every 1fr track
    // around it — the other cards collapsed into pills.
    class App extends Component {
      @tracked open = 'a';
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class="grid"
          style="display:grid;grid-template-columns:1fr 1fr 1fr;width:300px"
          as |c|
        >
          {{#each (array "a" "b" "c") as |k|}}
            <div
              id="cell-{{k}}"
              style={{cellStyle k this.open}}
              {{motion id=k role="cell"}}
            ></div>
          {{/each}}
          <c.Move @of={{c.moved "cell"}} @duration={{0.4}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const width = (k: string) =>
      find(`#cell-${k}`)!.getBoundingClientRect().width;
    const rest = width('b');
    app!.open = 'b';
    await settled();
    await sleep(120);
    // …and interrupt it half-way through
    app!.open = 'c';
    await settled();
    await sleep(500);
    await nextFrame();
    assert.strictEqual(
      (find('#cell-a') as HTMLElement).style.width,
      '',
      'the interrupted hero gave its width back'
    );
    assert.ok(
      Math.abs(width('a') - rest) < 2,
      `a returned to a normal track (${width('a')} vs ${rest})`
    );
    assert.ok(
      width('b') > rest * 0.5,
      `b was not squeezed into a pill (${width('b')})`
    );
  });

  test('an interrupted Move never strands a transform on the element', async function (assert) {
    // Clicking faster than the spring settles used to leave elements offset
    // forever: the next pass measured them where they LOOKED (mid-flight)
    // rather than where the stylesheet puts them, saw no change, generated no
    // cue, and the transform stayed on the element for good.
    class App extends Component {
      @tracked left: string[] = ['a', 'b', 'c'];
      @tracked right: string[] = [];
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      move = (k: string) => {
        if (this.left.includes(k)) {
          this.left = this.left.filter((x) => x !== k);
          this.right = [...this.right, k];
        } else {
          this.right = this.right.filter((x) => x !== k);
          this.left = [...this.left, k];
        }
      };
      <template>
        <Choreo style="display:flex;gap:40px" as |c|>
          <div class="col-l" style="width:120px">
            {{#each this.left key="@identity" as |k|}}
              <div
                id="i-{{k}}"
                style="height:20px"
                {{motion id=k role="i"}}
              >{{k}}</div>
            {{/each}}
          </div>
          <div class="col-r" style="width:120px">
            {{#each this.right key="@identity" as |k|}}
              <div
                id="i-{{k}}"
                style="height:20px"
                {{motion id=k role="i"}}
              >{{k}}</div>
            {{/each}}
          </div>
          <c.Move @of={{c.kept "i"}} @duration={{0.4}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    // hammer:each interrupt lands well inside the 400ms move
    for (const k of ['a', 'b', 'c', 'a', 'b', 'c']) {
      app!.move(k);
      await settled();
      await sleep(30);
    }
    await sleep(900);
    await nextFrame();
    const stranded = ['a', 'b', 'c'].filter((k) => {
      const el = find(`#i-${k}`) as HTMLElement | null;
      const tf = el?.style.transform ?? '';
      return tf !== '' && tf !== 'none' && !/\(0px\)/.test(tf);
    });
    assert.deepEqual(
      stranded,
      [],
      'no element kept a transform it never undid'
    );
  });

  test('a second dirty pass cancels the run, releases holds and strands no orphans', async function (assert) {
    class App extends Component {
      @tracked show = true;
      @tracked n = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.n * 10}px`;
      }
      <template>
        <Choreo as |c|>
          <div style={{this.pad}}>
            {{#if this.show}}
              <div id="leaver" {{motion id="leaver" role="card"}}></div>
            {{/if}}
            <div id="stay" {{motion id="stay" role="stay"}}></div>
          </div>
          <c.Parallel>
            <c.Tween @of={{c.removed "card"}} @opacity={{0}} @duration={{0.4}} />
            <c.Hold @of={{c.role "stay"}} @zIndex={{4}} @duration={{0.4}} />
          </c.Parallel>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.show = false;
    await settled();
    await sleep(50);
    assert.ok(find('#leaver'), 'orphan in flight');
    assert.strictEqual((find('#stay') as HTMLElement).style.zIndex, '4');
    // a second pass: the orphan is still a removed sprite and is named again, so it keeps going
    app!.n = 1;
    await settled();
    await sleep(20);
    assert.ok(find('#leaver'), 'renamed by the new run, so it stays');
    await sleep(500);
    await nextFrame();
    assert.notOk(find('#leaver'), 'released by the new run');
    assert.strictEqual((find('#stay') as HTMLElement).style.zIndex, '');
  });

  /**
   * Two halves of one guarantee, both of which ember-animated gets right.
   *
   * Position: the release that hands borrowed values back before a re-measure
   * has to land BEFORE the measurement, or `final` comes back with the very
   * transform the run is undoing still applied, and the element jumps.
   *
   * Speed: ember-animated sums a corrective curve onto the one it interrupts,
   * which carries velocity implicitly. A spring takes a velocity outright, so
   * the equivalent here is to hand it over. The signature of getting it right
   * is overshoot — a box reversed mid-flight keeps going the old way for a
   * moment before it turns, exactly as a thrown object would.
   */
  test('an interrupted move keeps its place and its speed', async function (assert) {
    class App extends Component {
      @tracked far = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.far ? 240 : 0}px`;
      }
      <template>
        <Choreo class="stage" style="width:400px;height:80px" as |c|>
          <div style={{this.pad}}>
            <div
              id="runner"
              style="width:40px;height:40px;background:#0af"
              {{motion id="runner" role="box"}}
            ></div>
          </div>
          <c.Move @of={{c.moved "box"}} @spring={{SOFT}} @size={{false}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const x = () => (find('#runner') as HTMLElement).getBoundingClientRect().x;

    app!.far = true;
    await settled();
    for (let i = 0; i < 14; i++) {
      await nextFrame();
    }
    const flying = x();
    assert.ok(
      flying > 60 && flying < 220,
      `mid-flight to the right (${Math.round(flying)})`
    );

    // reverse the destination while it is still moving
    app!.far = false;
    await settled();
    assert.ok(
      Math.abs(x() - flying) < 12,
      `picked up where it was, not at the old destination (${Math.round(flying)} -> ${Math.round(x())})`
    );

    // two consecutive frames of the NEW run: a spring that inherited the old
    // velocity is still travelling right; one starting from rest is already
    // heading left toward its new target
    await nextFrame();
    const p1 = x();
    await nextFrame();
    const p2 = x();
    assert.ok(
      p2 > p1,
      `still travelling the old way one frame in (${Math.round(p1)} -> ${Math.round(p2)})`
    );

    await sleep(1200);
    await nextFrame();
    assert.ok(Math.abs(x()) < 3, `and it still lands at rest (${x()})`);
  });

  /**
   * A beacon is a named box that never animates. Other sprites borrow it as a
   * fake start or a fake end. It is deliberately not `layoutId`: `layoutId`
   * pairs two real elements and morphs one into the other, so putting it on the
   * bin would make the bin stretch. A beacon has no identity in the changeset —
   * it is not inserted, kept or removed, and it moving does not start a run.
   */
  test('a removed sprite can fly to a beacon it never occupied', async function (assert) {
    class App extends Component {
      @tracked show = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        {{! the bin lives OUTSIDE the region, as the chrome would }}
        <div
          id="bin"
          style="position:absolute;left:300px;top:220px;width:40px;height:40px"
          {{beacon "trash"}}
        ></div>
        <Choreo class="stage" style="width:400px;height:300px" as |c|>
          <div style="padding:20px">
            {{#if this.show}}
              <div
                id="row"
                style="width:100px;height:30px;background:#0af"
                {{motion id="row" role="row"}}
              ></div>
            {{/if}}
          </div>
          <c.Move
            @of={{c.removed "row"}}
            @to={{c.beacon "trash"}}
            @duration={{0.4}}
            @size={{false}}
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const binBox = (find('#bin') as HTMLElement).getBoundingClientRect();
    const startBox = (find('#row') as HTMLElement).getBoundingClientRect();

    app!.show = false;
    await settled();
    await sleep(60);
    const row = find('#row') as HTMLElement | null;
    assert.ok(row, 'the leaver is orphaned so it can finish the flight');

    await sleep(200);
    const mid = (find('#row') as HTMLElement).getBoundingClientRect();
    assert.ok(
      mid.left > startBox.left + 20,
      `travelling toward the bin (${Math.round(startBox.left)} -> ${Math.round(mid.left)}, bin at ${Math.round(binBox.left)})`
    );
    assert.ok(
      Math.abs(
        binBox.width -
          (find('#bin') as HTMLElement).getBoundingClientRect().width
      ) < 0.5,
      'the beacon itself never moved or stretched'
    );

    await sleep(500);
    await nextFrame();
    assert.notOk(find('#row'), 'and it is released when the row ends');
  });

  test('a beacon nothing claimed leaves the move alone', async function (assert) {
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.wide ? 120 : 0}px`;
      }
      <template>
        <Choreo class="stage" style="width:400px;height:120px" as |c|>
          <div style={{this.pad}}>
            <div
              id="plain"
              style="width:40px;height:40px"
              {{motion id="plain" role="box"}}
            ></div>
          </div>
          {{! nothing registers 'nowhere' }}
          <c.Move
            @of={{c.moved "box"}}
            @to={{c.beacon "nowhere"}}
            @duration={{0.2}}
            @size={{false}}
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    app!.wide = true;
    await settled();
    await sleep(400);
    await nextFrame();
    const left = (find('#plain') as HTMLElement).getBoundingClientRect().left;
    assert.ok(
      left > 100,
      `fell back to the sprite's own destination (${Math.round(left)})`
    );
  });

  /**
   * A step gives every sprite it matched the same start. `@stagger` walks them
   * up a ladder in the order the query returned them, which is document order.
   * The step's own length grows by the whole ladder, so a Sequence still waits
   * for the last one.
   */
  test('@stagger walks a step across the sprites it matched', async function (assert) {
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.wide ? 120 : 0}px`;
      }
      <template>
        <Choreo class="stage" style="width:400px;height:220px" as |c|>
          <div style={{this.pad}}>
            {{#each (array "a" "b" "c") as |k|}}
              <div
                id="s-{{k}}"
                style="width:30px;height:30px;background:#0af"
                {{motion id=k role="box"}}
              ></div>
            {{/each}}
          </div>
          <c.Move
            @of={{c.moved "box"}}
            @duration={{0.2}}
            @stagger={{0.15}}
            @size={{false}}
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const x = (k: string) =>
      (find(`#s-${k}`) as HTMLElement).getBoundingClientRect().left;

    app!.wide = true;
    await settled();
    await sleep(120);
    // a is under way; c has not been let go yet
    const [a1, b1, c1] = [x('a'), x('b'), x('c')];
    assert.ok(a1 > c1 + 10, `the first leads the last (${a1} vs ${c1})`);
    assert.ok(a1 >= b1, `and the second is between (${b1})`);

    await sleep(900);
    await nextFrame();
    assert.ok(
      Math.abs(x('a') - x('c')) < 2,
      'and they all land together in the end'
    );
  });

  /**
   * Far matching: one identity, two regions.
   *
   * Each <Choreo> is its own scene, so an element that leaves one and appears
   * in the other would normally read as a death here and an unrelated birth
   * there. The barrier pairs them by id before either region compiles, and the
   * receiving element flies from where the sender was standing.
   *
   * Ember Animated calls these sentSprites / receivedSprites; boxel-motion
   * described it but never built it.
   */
  test('an id that leaves one region and lands in another flies between them', async function (assert) {
    class App extends Component {
      @tracked here = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <div style="display:flex;gap:120px;align-items:flex-start">
          <Choreo
            @id="left"
            class="stage"
            style="width:150px;height:120px"
            as |c|
          >
            {{#if this.here}}
              <div
                id="tok"
                style="width:40px;height:40px;background:#0af"
                {{motion id="token" role="tok"}}
              ></div>
            {{/if}}
            <c.Move @of={{c.kept "tok"}} @spring={{FAST}} />
          </Choreo>

          <Choreo
            @id="right"
            class="stage"
            style="width:150px;height:120px"
            as |c|
          >
            {{#unless this.here}}
              <div
                id="tok"
                style="width:40px;height:40px;background:#0af"
                {{motion id="token" role="tok"}}
              ></div>
            {{/unless}}
            <c.Move @of={{c.kept "tok"}} @spring={{FAST}} />
          </Choreo>
        </div>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const box = () => find('#tok') as HTMLElement;
    const from = box().getBoundingClientRect().x;

    app!.here = false;
    await settled();
    // the element now lives in the RIGHT region, but is pinned where the left
    // one was standing — one continuous flight, not a cut
    const pinned = box().getBoundingClientRect().x;
    assert.ok(
      Math.abs(pinned - from) < 3,
      `starts where the sender stood (${Math.round(from)} -> ${Math.round(pinned)})`
    );

    await sleep(900);
    await nextFrame();
    const landed = box().getBoundingClientRect().x;
    assert.ok(
      landed > from + 100,
      `and lands in the other region (${Math.round(landed)})`
    );
    assert.strictEqual(
      document.querySelectorAll('#tok').length,
      1,
      'the sender was let go, not orphaned alongside it'
    );
  });
});
