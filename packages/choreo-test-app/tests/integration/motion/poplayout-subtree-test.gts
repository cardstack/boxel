import { on } from '@ember/modifier';
import { click, render, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { catalog, type DemoEntry } from 'test-app/lib/catalog';
import { setupRenderingTest } from 'test-app/tests/helpers';

const keyOf = (demo: DemoEntry) => demo.id;
const gone = { opacity: 0, scale: 0.96 };
const here = { opacity: 1, scale: 1 };
const leaves = { opacity: 0, scale: 0.96 };
const quick = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.42,
} as const;

class Shown {
  @tracked group: string | undefined;

  /** the gallery's shape: a getter, so every read is a NEW array and
   *  <Presence> re-diffs on every render rather than only when items change */
  get demos(): DemoEntry[] {
    return this.group
      ? catalog.filter((demo) => demo.group === this.group)
      : catalog.slice();
  }

  /** the gallery changes the filter from inside a click handler, not from a
   *  bare assignment: the runloop flush is not the same shape */
  narrow = () => {
    this.group = 'Drag';
  };
}

/**
 * Wait for the DOM to reach the shape under test, rather than sleeping and
 * hoping. A fixed sleep here was a budget for the whole catalog mounting
 * and exiting at once, and every demo added to the gallery ate into it —
 * the failure it produced named a stuck leaver rather than a slow one.
 */
function until(count: number) {
  return waitUntil(
    () => document.querySelectorAll('[data-demo]').length === count,
    { timeout: 8000 }
  ).catch(() => {
    // fall through: the assertion below reports which ones are stuck,
    // which is the diagnostic this test exists to give
  });
}

/** a beat for the exits to actually finish once the count is right */
function settleOut() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

module('Integration | motion | popLayout subtree', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a leaver whose subtree is a whole demo is removed from the DOM', async function (assert) {
    const state = new Shown();

    await render(
      <template>
        <button type="button" class="narrow" {{on "click" state.narrow}}>
          Drag
        </button>
        <LayoutGroup>
          <div class="grid" style="position:relative">
            <Presence
              @items={{state.demos}}
              @key={{keyOf}}
              @mode="popLayout"
              @initial={{false}}
              as |demo h|
            >
              <article
                data-demo={{demo.id}}
                {{motion
                  presence=h
                  layout=true
                  initial=gone
                  animate=here
                  exit=leaves
                  transition=quick
                }}
              >
                {{#let demo.Example as |Example|}}
                  <Example />
                {{/let}}
              </article>
            </Presence>
          </div>
        </LayoutGroup>
      </template>
    );
    await until(catalog.length);
    assert.strictEqual(
      document.querySelectorAll('[data-demo]').length,
      catalog.length,
      'everything is up'
    );

    const drag = catalog.filter((demo) => demo.group === 'Drag');
    await click('.narrow');
    await until(drag.length);
    await settleOut();

    const left = [...document.querySelectorAll<HTMLElement>('[data-demo]')];
    const stuck = left
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.5)
      .map((el) => el.dataset['demo']);
    assert.strictEqual(
      left.length,
      drag.length,
      `still in the DOM: ${JSON.stringify(stuck)}`
    );
  });
});
