// Pretui — StickToBottom unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// The component's scoped CSS is inert in this harness, so every size the
// tests depend on is an inline style on the fixture, and no assertion reads
// a computed style.
import { module, test } from 'qunit';
import {
  render,
  click,
  settled,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { StickToBottom } from './stick-to-bottom';
import type { FollowChangeSource, StickToBottomApi } from './stick-to-bottom';

const FRAME = htmlSafe('height: 200px');
// the component's scoped CSS is inert here, so the root gets its sizing inline
const ROOT = htmlSafe(
  'height: 100%; min-height: 0; display: flex; flex-direction: column',
);
// overflow-anchor: none as the component's own CSS sets it: the browser's
// anchoring would otherwise hold the line and hide the component's own
const VIEWPORT_STYLE =
  'flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-anchor: none';
const ROW = htmlSafe('height: 50px; margin: 0');
const TALL = htmlSafe('height: 350px; margin: 0');
const REGION = htmlSafe('height: 40px; overflow-y: auto');
const REGION_INNER = htmlSafe('height: 400px');

function ids(count: number, start = 0): string[] {
  return Array.from({ length: count }, (_, i) => `r${start + i}`);
}

function root(): HTMLElement {
  return document.querySelector(
    '[data-test-pretui-stick-to-bottom]',
  ) as HTMLElement;
}
function viewport(): HTMLElement {
  let el = document.querySelector(
    '[data-test-pretui-stick-to-bottom-viewport]',
  ) as HTMLElement;
  // the component's own stylesheet does not apply here, so make it scroll
  el.setAttribute('style', VIEWPORT_STYLE);
  return el;
}
function distance(el: HTMLElement): number {
  return el.scrollHeight - el.clientHeight - el.scrollTop;
}
function frames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
/** A scroll the way a reader makes one: their hand on the wheel, then the
 * scroll event, which arrives asynchronously. */
async function userScroll(el: HTMLElement, top: number) {
  el.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: top < el.scrollTop ? -1 : 1,
      bubbles: true,
    }),
  );
  el.scrollTop = top;
  await frames();
}
/** A row's offset below the viewport top in layout pixels: the harness
 * scales its container, so rect deltas are divided back out. */
function rowOffset(id: string): number {
  let row = document.querySelector(
    `[data-transcript-id='${id}']`,
  ) as HTMLElement;
  let el = viewport();
  let scale = el.getBoundingClientRect().height / el.offsetHeight;
  return (
    (row.getBoundingClientRect().top - el.getBoundingClientRect().top) / scale
  );
}

class State {
  @tracked rows: string[] = ids(10);
  @tracked active = false;
  @tracked following: boolean | undefined = undefined;
  @tracked expanded = false;
  changes: [boolean, FollowChangeSource][] = [];
  onFollowChange = (following: boolean, by: FollowChangeSource) => {
    this.changes.push([following, by]);
  };
  append = (count: number) => {
    let next = this.rows.length;
    this.rows = [...this.rows, ...ids(count, next + 100)];
  };
  toggle = () => {
    this.expanded = !this.expanded;
  };
}

// ── the anchoring invariant, as a property ────────────────────────────────
// A seeded generator of layout changes: rows inserted, removed, grown and
// shrunk anywhere, in one render pass each. After every pass the anchor
// must hold (packages/pretui/docs/scroll-anchoring-protocol.md).

/** mulberry32: a small seeded generator, so a failure reproduces */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SizedRow {
  id: string;
  h: number;
}

class SizedRows {
  @tracked rows: SizedRow[];
  private next = 0;
  constructor(count: number, random: () => number) {
    this.rows = Array.from({ length: count }, () => this.make(random));
  }
  make(random: () => number): SizedRow {
    return { id: `s${this.next++}`, h: 20 + Math.round(random() * 80) };
  }
}

const rowStyle = (row: SizedRow) => htmlSafe(`height: ${row.h}px; margin: 0`);

/** the row the reading line crosses, by the component's own rule */
function rowAtReadingLine(): HTMLElement | undefined {
  let el = viewport();
  let view = el.getBoundingClientRect();
  let line = view.top + view.height / 3;
  return Array.from(
    el.querySelectorAll<HTMLElement>('[data-transcript-id]'),
  ).find((row) => {
    let rect = row.getBoundingClientRect();
    return rect.top <= line && rect.bottom > line;
  });
}

type Op = { name: string; apply: (state: SizedRows) => void };

/** One random change that leaves `keep` in place (it may resize it). */
function randomOp(
  random: () => number,
  state: SizedRows,
  keep: string | undefined,
): Op {
  let rows = state.rows;
  // half the changes land above the anchor, where holding it takes a
  // correction; the rest anywhere
  let keepAt = keep ? rows.findIndex((row) => row.id === keep) : -1;
  let above = keepAt > 0 && random() < 0.5;
  let at = above
    ? Math.floor(random() * keepAt)
    : Math.floor(random() * (rows.length + 1));
  let others = rows.filter(
    (row, index) => row.id !== keep && (!above || index < keepAt),
  );
  let pick = others[Math.floor(random() * others.length)];
  let kind = Math.floor(random() * 5);
  if (kind === 0 || !pick) {
    let row = state.make(random);
    return {
      name: `insert ${row.id}@${at}`,
      apply: (s) =>
        (s.rows = [...s.rows.slice(0, at), row, ...s.rows.slice(at)]),
    };
  }
  if (kind === 1 && rows.length > 6) {
    return {
      name: `remove ${pick.id}`,
      apply: (s) => (s.rows = s.rows.filter((row) => row.id !== pick!.id)),
    };
  }
  if (kind === 2 && keep) {
    let h = 20 + Math.round(random() * 160);
    return {
      name: `resize anchor ${keep} to ${h}`,
      apply: (s) =>
        (s.rows = s.rows.map((row) => (row.id === keep ? { ...row, h } : row))),
    };
  }
  let h = 10 + Math.round(random() * 200);
  return {
    name: `resize ${pick.id} to ${h}`,
    apply: (s) =>
      (s.rows = s.rows.map((row) =>
        row.id === pick!.id ? { ...row, h } : row,
      )),
  };
}

module('Pretui | components/stick-to-bottom', function (hooks) {
  setupCardTest(hooks);

  test('starts at the end and follows content growth', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    assert.strictEqual(root().dataset['following'], 'true');

    state.append(5);
    await waitUntil(() => distance(el) < 1 && el.scrollHeight >= 750, {
      timeout: 2000,
    });
    assert.ok(distance(el) < 1, 'growth while following keeps the end in view');
    assert.deepEqual(
      state.changes,
      [],
      'its own scrolls are never reported as the reader leaving',
    );
  });

  test('a scroll the reader did not make (content shrinking) keeps following', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    // no wheel, touch or key: content shrinks under the reader at the end,
    // and the browser pulls the position up with it
    state.rows = state.rows.slice(0, -2);
    await frames();
    await frames();
    assert.strictEqual(
      root().dataset['following'],
      'true',
      'a shrink is not the reader leaving',
    );
    state.append(3);
    await waitUntil(() => distance(el) < 1 && el.scrollHeight >= 550, {
      timeout: 2000,
    });
    assert.strictEqual(
      root().dataset['following'],
      'true',
      'still following: only the reader leaves',
    );
    assert.deepEqual(
      state.changes,
      [],
      'nothing reported as the reader leaving',
    );
  });

  test('navigate brings an element into view, stops following, and holds it while content grows above', async function (assert) {
    let state = new State();
    let api: StickToBottomApi | undefined;
    let grab = (a: StickToBottomApi) => {
      api = a;
      return '';
    };
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}} as |scroll|>
            {{grab scroll}}
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    let target = document.querySelector(
      "[data-transcript-id='r3']",
    ) as HTMLElement;
    api!.navigate(target, { block: 'start' });
    await frames();
    assert.ok(Math.abs(rowOffset('r3')) <= 1, 'r3 is at the top of the view');
    assert.strictEqual(root().dataset['following'], 'false');
    state.rows = ['x0', 'x1', ...state.rows];
    await frames();
    await frames();
    assert.ok(
      Math.abs(rowOffset('r3')) <= 1,
      'and stays there while rows arrive above',
    );
  });

  test("the app's own scroll up (as scrollIntoView makes) is not undone", async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}}>
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    // what scrollIntoView does to this viewport: no input, no size change
    el.scrollTop = 0;
    await frames();
    await frames();
    assert.ok(
      distance(el) > 100,
      `the scroll it asked for stands (top ${el.scrollTop}, height ${el.scrollHeight}, view ${el.clientHeight})`,
    );
    assert.strictEqual(root().dataset['following'], 'false');
  });

  test('a user scroll up detaches, growth then leaves the viewport alone, and returning to the end re-pins', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    await userScroll(el, el.scrollTop - 100);
    assert.strictEqual(root().dataset['following'], 'false');
    assert.deepEqual(state.changes, [[false, 'user']]);

    let top = el.scrollTop;
    state.append(4);
    await waitUntil(() => el.scrollHeight >= 700, { timeout: 2000 });
    await frames();
    assert.strictEqual(
      el.scrollTop,
      top,
      'detached: new content does not move the reader',
    );

    await userScroll(el, el.scrollHeight - el.clientHeight - 4);
    assert.strictEqual(
      root().dataset['following'],
      'true',
      'within the threshold re-pins',
    );
    assert.deepEqual(state.changes, [
      [false, 'user'],
      [true, 'user'],
    ]);
  });

  test('scrollToEnd re-pins as an api change, from the overlay slot', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            <:default>
              {{#each state.rows as |id|}}
                <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
              {{/each}}
            </:default>
            <:overlay as |scroll|>
              <button
                type='button'
                data-test-jump
                data-visible={{if scroll.following 'false' 'true'}}
                {{on 'click' (fn scroll.scrollToEnd 'auto')}}
              >Jump</button>
            </:overlay>
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    let jump = document.querySelector('[data-test-jump]') as HTMLElement;
    assert.strictEqual(
      jump.dataset['visible'],
      'false',
      'the overlay sees the yielded state',
    );

    await userScroll(el, 0);
    assert.strictEqual(jump.dataset['visible'], 'true');

    await click(jump);
    await frames();
    assert.ok(distance(el) < 1, 'back at the end');
    assert.deepEqual(state.changes, [
      [false, 'user'],
      [true, 'api'],
    ]);
  });

  test('wheel-up inside a nested scroll region does not detach; outside it does', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
            <div data-scroll-region data-test-region style={{REGION}}>
              <div style={{REGION_INNER}}></div>
            </div>
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    let region = document.querySelector('[data-test-region]') as HTMLElement;
    region.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -40, bubbles: true }),
    );
    assert.strictEqual(
      root().dataset['following'],
      'true',
      'nested region: still following',
    );

    let row = document.querySelector(
      "[data-transcript-id='r3']",
    ) as HTMLElement;
    row.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }));
    await frames();
    assert.strictEqual(
      root().dataset['following'],
      'false',
      'the transcript itself: detached',
    );
  });

  test('selecting text detaches only while the content is active', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @active={{state.active}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    let row = document.querySelector(
      "[data-transcript-id='r9']",
    ) as HTMLElement;
    let selection = window.getSelection()!;
    selection.selectAllChildren(row);

    await triggerEvent(el, 'pointerup');
    assert.strictEqual(
      root().dataset['following'],
      'true',
      'idle: a selection is just a selection',
    );

    state.active = true;
    await frames();
    await triggerEvent(el, 'pointerup');
    assert.strictEqual(
      root().dataset['following'],
      'false',
      'streaming: selecting holds the text still',
    );
    selection.removeAllRanges();
  });

  test('content the reader expands does not drag them to the end; it detaches instead', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
            <button
              type='button'
              data-test-toggle
              {{on 'click' state.toggle}}
            >More</button>
            {{#if state.expanded}}
              <div style={{TALL}}></div>
            {{/if}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    let top = el.scrollTop;

    let toggle = document.querySelector('[data-test-toggle]') as HTMLElement;
    await triggerEvent(toggle, 'pointerdown');
    await click(toggle);
    await waitUntil(() => root().dataset['following'] === 'false', {
      timeout: 2000,
    });
    assert.strictEqual(
      el.scrollTop,
      top,
      'the viewport stayed where the reader was',
    );
    assert.deepEqual(state.changes, [[false, 'user']]);
  });

  test("reaching the start loads older rows and holds the reader's line still", async function (assert) {
    let state = new State();
    state.rows = ids(20, 10);
    let loads = 0;
    let loadOlder = async () => {
      loads++;
      state.rows = [...ids(10, 0), ...state.rows];
      await Promise.resolve();
    };
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onReachStart={{loadOlder}}
            @startMargin={{100}}
          >
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    await userScroll(el, 500);
    assert.strictEqual(loads, 0, 'outside the start margin: nothing loads');
    // at scrollTop 60, r11 (50–100) starts 10px above the viewport's top edge
    await userScroll(el, 60);

    await waitUntil(
      () => loads === 1 && el.getAttribute('aria-busy') === null,
      {
        timeout: 2000,
      },
    );
    assert.strictEqual(
      document.querySelectorAll('[data-transcript-id]').length,
      30,
    );
    assert.ok(
      Math.abs(rowOffset('r11') + 10) <= 1,
      `the anchor row kept its offset (-10 → ${rowOffset('r11')})`,
    );
  });

  test('reveal brings a row to the top and stops following', async function (assert) {
    let state = new State();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @onFollowChange={{state.onFollowChange}}
          >
            <:default>
              {{#each state.rows as |id|}}
                <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
              {{/each}}
            </:default>
            <:overlay as |scroll|>
              <button
                type='button'
                data-test-reveal
                {{on 'click' (fn scroll.reveal 'r2' undefined)}}
              >
                Reveal
              </button>
            </:overlay>
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    await click('[data-test-reveal]');
    await frames();
    assert.ok(
      Math.abs(rowOffset('r2')) <= 1,
      'r2 is at the top of the viewport',
    );
    assert.deepEqual(state.changes, [[false, 'api']]);
  });

  test('controlled: growth is not followed while @following is false, and switching it on goes to the end', async function (assert) {
    let state = new State();
    state.following = false;
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}} @following={{state.following}}>
            {{#each state.rows as |id|}}
              <p data-transcript-id={{id}} style={{ROW}}>{{id}}</p>
            {{/each}}
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    await frames();
    assert.strictEqual(el.scrollTop, 0, 'not following: stays at the top');

    state.following = true;
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });
    assert.strictEqual(root().dataset['following'], 'true');
  });

  test('a label makes the viewport a named region; without one it has no role', async function (assert) {
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}} @label='Conversation'><p
              style={{ROW}}
            >one</p></StickToBottom>
        </div>
      </template>,
    );
    assert.strictEqual(viewport().getAttribute('role'), 'region');
    assert.strictEqual(viewport().getAttribute('aria-label'), 'Conversation');

    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}}><p style={{ROW}}>one</p></StickToBottom>
        </div>
      </template>,
    );
    assert.strictEqual(viewport().getAttribute('role'), null);
    assert.strictEqual(
      viewport().getAttribute('tabindex'),
      null,
      'nothing to scroll: no tab stop',
    );
  });

  test('holdTail keeps new rows out while the reader is away, counts them, and lands them on return', async function (assert) {
    class Rows {
      @tracked items = ids(10).map((id) => ({ id }));
      get itemIds() {
        return this.items.map((item) => item.id);
      }
    }
    let state = new Rows();
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom
            style={{ROOT}}
            @holdTail={{true}}
            @itemIds={{state.itemIds}}
          >
            <:default as |scroll|>
              {{#each (scroll.visibleItems state.items) as |item|}}
                <p data-transcript-id={{item.id}} style={{ROW}}>{{item.id}}</p>
              {{/each}}
            </:default>
            <:overlay as |scroll|>
              <span data-test-pending>{{scroll.pendingCount}}</span>
            </:overlay>
          </StickToBottom>
        </div>
      </template>,
    );
    let el = viewport();
    let rendered = () =>
      document.querySelectorAll('[data-transcript-id]').length;
    let pending = () =>
      document.querySelector('[data-test-pending]')!.textContent;
    await waitUntil(() => distance(el) < 1, { timeout: 2000 });

    await userScroll(el, el.scrollTop - 100);
    assert.strictEqual(root().dataset['holding'], 'true');
    let top = el.scrollTop;

    state.items = [...state.items, { id: 'n1' }, { id: 'n2' }, { id: 'n3' }];
    await settled();
    assert.strictEqual(rendered(), 10, 'new rows are held back');
    assert.strictEqual(pending(), '3');
    assert.strictEqual(el.scrollTop, top, 'the reader did not move');

    state.items = [{ id: 'old' }, ...state.items];
    await settled();
    assert.strictEqual(rendered(), 11, 'older history still loads above');
    assert.strictEqual(pending(), '3');

    await userScroll(el, el.scrollHeight);
    await waitUntil(() => rendered() === 14 && distance(el) < 1, {
      timeout: 2000,
    });
    assert.strictEqual(
      pending(),
      '0',
      'one scroll event back to the end releases them',
    );
    assert.strictEqual(root().dataset['holding'], undefined);
  });

  test('@recede turns on the prominence ramp for everything inside', async function (assert) {
    await render(
      <template>
        <div style={{FRAME}}>
          <StickToBottom style={{ROOT}} @recede={{true}}><p
              style={{ROW}}
            >one</p></StickToBottom>
        </div>
      </template>,
    );
    assert.strictEqual(
      root().style.getPropertyValue('--pretui-recede-opacity'),
      '0.45',
      'set as a property, so a caller style attribute does not erase it',
    );
  });

  for (let seed of [1, 7, 42]) {
    test(`property: a reader's line holds through random changes (seed ${seed})`, async function (assert) {
      let random = seeded(seed);
      let state = new SizedRows(24, random);
      await render(
        <template>
          <div style={{FRAME}}>
            <StickToBottom style={{ROOT}}>
              {{#each state.rows key='id' as |row|}}
                <p
                  data-transcript-id={{row.id}}
                  data-scroll-anchor
                  style={{rowStyle row}}
                >{{row.id}}</p>
              {{/each}}
            </StickToBottom>
          </div>
        </template>,
      );
      let el = viewport();
      await waitUntil(() => distance(el) < 1, { timeout: 2000 });
      // the reader goes up into the middle and reads
      await userScroll(el, Math.round(el.scrollHeight / 2));
      await frames();
      let held = 0;
      for (let step = 0; step < 30; step++) {
        let probe = rowAtReadingLine();
        let id = probe?.getAttribute('data-transcript-id') ?? undefined;
        let before = id ? rowOffset(id) : 0;
        let op = randomOp(random, state, id);
        op.apply(state);
        await frames();
        await frames();
        let clamped = el.scrollTop <= 0 || distance(el) <= 0.5;
        if (id && !clamped) {
          let after = rowOffset(id);
          assert.ok(
            Math.abs(after - before) <= 1,
            `seed ${seed} step ${step} (${op.name}): ${id} moved ${before} → ${after}`,
          );
          held++;
        }
      }
      assert.ok(held >= 10, `the invariant was checked ${held} times`);
    });

    test(`property: following keeps the end through random changes (seed ${seed})`, async function (assert) {
      let random = seeded(seed + 1000);
      let state = new SizedRows(24, random);
      await render(
        <template>
          <div style={{FRAME}}>
            <StickToBottom style={{ROOT}}>
              {{#each state.rows key='id' as |row|}}
                <p
                  data-transcript-id={{row.id}}
                  data-scroll-anchor
                  style={{rowStyle row}}
                >{{row.id}}</p>
              {{/each}}
            </StickToBottom>
          </div>
        </template>,
      );
      let el = viewport();
      await waitUntil(() => distance(el) < 1, { timeout: 2000 });
      for (let step = 0; step < 30; step++) {
        let op = randomOp(random, state, undefined);
        op.apply(state);
        await frames();
        await frames();
        assert.ok(
          distance(el) < 1,
          `seed ${seed} step ${step} (${op.name}): ${distance(el)}px from the end`,
        );
      }
      assert.strictEqual(root().dataset['following'], 'true');
    });

    test(`property: what the reader pressed holds while it changes (seed ${seed})`, async function (assert) {
      let random = seeded(seed + 2000);
      let state = new SizedRows(24, random);
      await render(
        <template>
          <div style={{FRAME}}>
            <StickToBottom style={{ROOT}}>
              {{#each state.rows key='id' as |row|}}
                <p
                  data-transcript-id={{row.id}}
                  data-scroll-anchor
                  style={{rowStyle row}}
                >{{row.id}}</p>
              {{/each}}
            </StickToBottom>
          </div>
        </template>,
      );
      let el = viewport();
      await waitUntil(() => distance(el) < 1, { timeout: 2000 });
      let checked = 0;
      for (let step = 0; step < 12; step++) {
        // the reader presses a row in view, near the top of the view
        let view = el.getBoundingClientRect();
        let target = Array.from(
          el.querySelectorAll<HTMLElement>('[data-transcript-id]'),
        ).find((row) => row.getBoundingClientRect().top >= view.top + 4);
        if (!target) {
          continue;
        }
        let id = target.getAttribute('data-transcript-id')!;
        target.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true }),
        );
        let before = rowOffset(id);
        // what it opens: it grows, and something else changes in the pass
        let h = 40 + Math.round(random() * 200);
        state.rows = state.rows.map((row) =>
          row.id === id ? { ...row, h } : row,
        );
        randomOp(random, state, id).apply(state);
        await frames();
        await frames();
        if (el.scrollTop > 0 && distance(el) > 0.5) {
          assert.ok(
            Math.abs(rowOffset(id) - before) <= 1,
            `seed ${seed} step ${step}: pressed ${id} moved ${before} → ${rowOffset(id)}`,
          );
          checked++;
        }
      }
      assert.ok(checked >= 4, `the invariant was checked ${checked} times`);
    });
  }
});
