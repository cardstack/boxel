import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const keyOf = (item: { id: string }) => item.id;
const gone = { opacity: 0 };
const here = { opacity: 1 };
const quick = { duration: 0.08 } as const;
const slow = { duration: 0.6 } as const;

class Items {
  @tracked items: { id: string }[] = all;
}

function report() {
  return [...document.querySelectorAll<HTMLElement>('[data-item]')].map(
    (el) => `${el.dataset['item']}:${getComputedStyle(el).opacity}`
  );
}

module('Integration | motion | presence round trip', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('an item that leaves and comes back is present again', async function (assert) {
    const state = new Items();

    await render(
      <template>
        <div style="position:relative">
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode="popLayout"
            @initial={{false}}
            as |item h|
          >
            <span
              data-item={{item.id}}
              {{motion
                presence=h
                layout=true
                initial=gone
                animate=here
                exit=gone
                transition=quick
              }}
            >{{item.id}}</span>
          </Presence>
        </div>
      </template>
    );
    await animationsSettled();
    assert.deepEqual(report(), ['a:1', 'b:1', 'c:1'], 'all three at rest');

    state.items = [all[1]!];
    await settled();
    await animationsSettled();
    assert.deepEqual(report(), ['b:1'], 'only b remains');

    state.items = all;
    await settled();
    await animationsSettled();
    assert.deepEqual(report(), ['a:1', 'b:1', 'c:1'], 'and all three return');
  });

  test('an item that comes back mid-exit is restored', async function (assert) {
    const state = new Items();

    await render(
      <template>
        <div style="position:relative">
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode="popLayout"
            @initial={{false}}
            as |item h|
          >
            <span
              data-item={{item.id}}
              {{motion
                presence=h
                layout=true
                initial=gone
                animate=here
                exit=gone
                transition=slow
              }}
            >{{item.id}}</span>
          </Presence>
        </div>
      </template>
    );
    await animationsSettled();

    // leave, and change your mind before the exit has finished
    state.items = [all[1]!];
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 60));
    state.items = all;
    await settled();
    await animationsSettled();

    assert.deepEqual(report(), ['a:1', 'b:1', 'c:1'], 'all three are back');
  });

  /**
   * The same round trip, but each item has a motion element INSIDE it.
   *
   * A descendant registers with the presence context and must report before
   * the leaver may be removed. React re-renders the whole subtree of a leaving
   * child, so every descendant learns it is exiting; Glimmer only re-runs the
   * modifiers whose own args changed, so a descendant whose args are static
   * never finds out — and its registration holds the exit open forever.
   */
  test('a leaver with motion descendants still completes its exit', async function (assert) {
    const state = new Items();

    await render(
      <template>
        <div style="position:relative">
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode="popLayout"
            @initial={{false}}
            as |item h|
          >
            <span
              data-item={{item.id}}
              {{motion
                presence=h
                layout=true
                initial=gone
                animate=here
                exit=gone
                transition=quick
              }}
            >
              <i {{motion animate=here transition=quick}}>{{item.id}}</i>
            </span>
          </Presence>
        </div>
      </template>
    );
    await animationsSettled();

    state.items = [all[1]!];
    await settled();
    await animationsSettled();
    assert.strictEqual(
      document.querySelectorAll('[data-item]').length,
      1,
      'the leavers are gone from the DOM, not merely invisible'
    );

    state.items = all;
    await settled();
    await animationsSettled();
    assert.deepEqual(report(), ['a:1', 'b:1', 'c:1'], 'and all three return');
  });
});
