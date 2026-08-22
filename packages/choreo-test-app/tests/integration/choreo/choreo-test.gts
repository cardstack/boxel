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
          <c.Tween @of={{c.removed "card"}} @opacity={{0}} @ms={{120}} />
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
          <c.Tween @of={{c.kept "other"}} @opacity={{0.5}} @ms={{100}} />
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

  test('the first render never animates; a clean pass never runs', async function (assert) {
    let runs = 0;
    const count = () => {
      runs++;
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
          <c.Hold @of={{c.all}} @zIndex={{count}} @ms={{10}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    assert.strictEqual(runs, 0, 'first render');
    app!.label = 'b';
    await settled();
    await nextFrame();
    assert.strictEqual(runs, 0, 'nothing moved, nothing inserted or removed');
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
            <c.Hold @of={{c.role "card"}} @zIndex={{9}} @ms={{100}} />
            <c.Hold @of={{c.role "keep"}} @zIndex={{3}} @fill={{true}} />
            <c.Wait @of={{c.all}} @ms={{100}} />
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
            <c.Tween @of={{c.kept "card"}} @opacity={{0.5}} @ms={{100}} />
            <c.Parallel>
              <c.Move @of={{c.kept "card"}} @spring={{FAST}} />
              <c.Hold @of={{c.kept "card"}} @zIndex={{7}} />
            </c.Parallel>
            <c.Tween @of={{c.kept "card"}} @opacity={{grab}} @ms={{100}} />
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
          <c.Tween @of={{c.id "content"}} @width={{fromContainer}} @ms={{50}} />
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
          <c.Tween @of={{c.removed "card"}} @opacity={{0}} @ms={{120}} />
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
          <c.Tween @of={{c.kept "card"}} @opacity={{grab}} @ms={{80}} />
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
            <c.Tween @of={{c.removed "card"}} @opacity={{0}} @ms={{400}} />
            <c.Hold @of={{c.role "stay"}} @zIndex={{4}} @ms={{400}} />
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
});
