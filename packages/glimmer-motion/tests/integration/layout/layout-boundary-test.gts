import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import ReorderGroup from 'glimmer-motion/reorder/group';
import ReorderItem from 'glimmer-motion/reorder/item';
import {
  animationsSettled,
  bounds,
  setupMotion,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';
import { setupFixtureViewport } from '../../helpers/layout-fixture';

/**
 * `layout=true` animates a change only when something measured the element's
 * box BEFORE Glimmer patched the DOM. That measurement is a render detector, a
 * getter re-evaluated at the start of every render pass, and only four
 * components carry one: <LayoutGroup>, <Presence>, <ReorderGroup> and Choreo's
 * <Choreo>. A keyed `{{#each}}` that reorders with none of them above it moves
 * its DOM nodes, nothing snapshots, and the rows land in their new places at
 * once.
 *
 * A `layoutId` hand-off has the same dependency: the outgoing element's box is
 * only known if something measured it before it left.
 *
 * The first two modules pin that down; the third covers the development-mode
 * warning an element raises when it registers with no such boundary above it.
 */
const slow = { duration: 1, ease: 'linear' } as const;

class Rows {
  @tracked order = ['a', 'b', 'c'];
}
class Toggle {
  @tracked open = false;
}
const keyOf = (id: string) => id;

function row(id: string) {
  return document.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
}
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left ? requestAnimationFrame(() => step(left - 1)) : resolve();
    step(n);
  });

/**
 * Swap one `layoutId` element for another 300px below it, and report how far
 * the incoming one still sits from its own slot a few frames in. 0 means it
 * jumped; close to 300 means it set off from the outgoing one's box.
 */
async function handOff(toggle: Toggle): Promise<number> {
  await animationsSettled();
  toggle.open = true;
  await settled();
  await frames(3);
  return 300 - bounds(row('shared')).top;
}

/**
 * Move the last row to the top, and report how far it still sits from its new
 * slot a few frames in, in row heights. 0 means it jumped; close to 2 means
 * it set off from where it was and is gliding up.
 */
async function promoteLast(rows: Rows): Promise<number> {
  await animationsSettled();
  const rowHeight = bounds(row('a')).height;
  const slot = bounds(row('a')).top;
  rows.order = ['c', 'a', 'b'];
  await settled();
  await frames(3);
  return (bounds(row('c')).top - slot) / rowHeight;
}

module('Integration | motion | layout | render detector', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  // unscaled, so a distance read on screen is the distance the engine moved
  setupFixtureViewport(hooks);

  test('a keyed reorder with no boundary above it does not animate', async function (assert) {
    const rows = new Rows();
    await render(
      <template>
        <ul style='margin: 0; padding: 0; list-style: none'>
          {{#each rows.order key='@identity' as |id|}}
            <li
              data-row={{id}}
              style='height: 40px'
              {{motion layout=true transition=slow}}
            >{{id}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    const offset = await promoteLast(rows);
    assert.strictEqual(
      Math.round(offset * 100) / 100,
      0,
      'the promoted row is already in its new slot',
    );
  });

  test('the same reorder glides inside a <LayoutGroup>', async function (assert) {
    const rows = new Rows();
    await render(
      <template>
        <LayoutGroup>
          <ul style='margin: 0; padding: 0; list-style: none'>
            {{#each rows.order key='@identity' as |id|}}
              <li
                data-row={{id}}
                style='height: 40px'
                {{motion layout=true transition=slow}}
              >{{id}}</li>
            {{/each}}
          </ul>
        </LayoutGroup>
      </template>,
    );
    const offset = await promoteLast(rows);
    assert.true(
      offset > 1.5,
      `the promoted row set off from its old slot (${offset.toFixed(2)} rows away)`,
    );
  });

  test('the same reorder glides inside a <Presence>', async function (assert) {
    const rows = new Rows();
    await render(
      <template>
        <ul style='margin: 0; padding: 0; list-style: none'>
          <Presence @items={{rows.order}} @key={{keyOf}} as |id p|>
            <li
              data-row={{id}}
              style='height: 40px'
              {{motion presence=p layout=true transition=slow}}
            >{{id}}</li>
          </Presence>
        </ul>
      </template>,
    );
    const offset = await promoteLast(rows);
    assert.true(
      offset > 1.5,
      `the promoted row set off from its old slot (${offset.toFixed(2)} rows away)`,
    );
  });
});

module(
  'Integration | motion | layout | render detector, layoutId',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);
    setupFixtureViewport(hooks);

    test('a layoutId hand-off with no boundary above it does not animate', async function (assert) {
      const toggle = new Toggle();
      await render(
        <template>
          {{#if toggle.open}}
            <div
              data-row='shared'
              style='position: absolute; top: 300px; left: 0; width: 40px; height: 40px'
              {{motion layoutId='shared' transition=slow}}
            ></div>
          {{else}}
            <div
              data-row='shared'
              style='position: absolute; top: 0; left: 0; width: 40px; height: 40px'
              {{motion layoutId='shared' transition=slow}}
            ></div>
          {{/if}}
        </template>,
      );
      const offset = await handOff(toggle);
      assert.strictEqual(
        Math.round(offset),
        0,
        'the incoming element is already in its own slot',
      );
    });

    test('the same hand-off morphs inside a <LayoutGroup>', async function (assert) {
      const toggle = new Toggle();
      await render(
        <template>
          <LayoutGroup>
            {{#if toggle.open}}
              <div
                data-row='shared'
                style='position: absolute; top: 300px; left: 0; width: 40px; height: 40px'
                {{motion layoutId='shared' transition=slow}}
              ></div>
            {{else}}
              <div
                data-row='shared'
                style='position: absolute; top: 0; left: 0; width: 40px; height: 40px'
                {{motion layoutId='shared' transition=slow}}
              ></div>
            {{/if}}
          </LayoutGroup>
        </template>,
      );
      const offset = await handOff(toggle);
      assert.true(
        offset > 250,
        `the incoming element set off from the outgoing one's box (${offset.toFixed(0)}px away)`,
      );
    });
  },
);

module('Integration | motion | layout | ungrouped warning', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  let warnings: unknown[][] = [];
  let realWarn: typeof console.warn;
  hooks.beforeEach(function () {
    warnings = [];
    realWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });
  hooks.afterEach(function () {
    console.warn = realWarn;
  });
  const ungrouped = () =>
    warnings.filter(
      ([message]) =>
        typeof message === 'string' &&
        message.startsWith('glimmer-motion: a {{motion layout}} or layoutId'),
    );

  test('a layout element with no boundary above it warns once, naming the element', async function (assert) {
    await render(
      <template>
        <ul>
          <li class='first' {{motion layout=true}}>a</li>
          <li class='second' {{motion layout=true}}>b</li>
        </ul>
      </template>,
    );
    const raised = ungrouped();
    assert.strictEqual(raised.length, 1, 'one warning for the whole page');
    assert.strictEqual(
      raised[0]?.[1],
      document.querySelector('.first'),
      'the first element without a boundary rides along, so it can be found',
    );
  });

  test('layout="position" warns as well', async function (assert) {
    await render(
      <template>
        <div {{motion layout='position'}}></div>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 1);
  });

  test('inside a <LayoutGroup> it does not warn', async function (assert) {
    await render(
      <template>
        <LayoutGroup>
          <ul><li {{motion layout=true}}>a</li></ul>
        </LayoutGroup>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });

  test('inside a <Presence> it does not warn, nested below the presence child too', async function (assert) {
    const items = ['a'];
    await render(
      <template>
        <Presence @items={{items}} @key={{keyOf}} as |id p|>
          <div {{motion presence=p layout=true}}>
            <span {{motion layout=true}}>{{id}}</span>
          </div>
        </Presence>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });

  test('a <ReorderGroup> and its items do not warn', async function (assert) {
    const items = ['a', 'b'];
    const noop = () => {};
    await render(
      <template>
        <ReorderGroup
          @values={{items}}
          @onReorder={{noop}}
          @layout={{true}}
          as |group|
        >
          {{#each items as |item|}}
            <ReorderItem @group={{group}} @value={{item}}>{{item}}</ReorderItem>
          {{/each}}
        </ReorderGroup>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });

  test('inside a participant host (a <Choreo> region) it does not warn', async function (assert) {
    await render(
      <template>
        <div data-motion-host>
          <div {{motion layout=true}}></div>
        </div>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });

  test('a portalled element does not warn, since its DOM ancestors are not its template ancestors', async function (assert) {
    const body = document.body;
    await render(
      <template>
        <LayoutGroup>
          {{#in-element body insertBefore=null}}
            <div data-framer-portal-id='sheet' {{motion layout=true}}>
              <span {{motion layout=true}}></span>
            </div>
          {{/in-element}}
        </LayoutGroup>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });

  test('a layoutId element with no boundary above it warns', async function (assert) {
    await render(
      <template>
        <div class='tab' {{motion layoutId='tab'}}></div>
      </template>,
    );
    const raised = ungrouped();
    assert.strictEqual(raised.length, 1);
    assert.strictEqual(raised[0]?.[1], document.querySelector('.tab'));
  });

  test('drag alone does not warn', async function (assert) {
    await render(
      <template>
        <div {{motion drag=true}}></div>
      </template>,
    );
    assert.strictEqual(ungrouped().length, 0);
  });
});
