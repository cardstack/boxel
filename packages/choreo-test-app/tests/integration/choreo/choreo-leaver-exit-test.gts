/**
 * A <Choreo> inside a leaving <Presence> child must not hold the exit open.
 *
 * A participant registers with the nearest <Presence> when it joins a region,
 * so that a removal row has time to play before the element is taken away. The
 * registration is discharged when that row ends — which is fine as long as a
 * row is coming. When the REGION ITSELF is inside the leaver, none is: the card
 * goes and the region goes with it, so the region never sees a removal of its
 * own, never runs a row, and every participant it registered sits on the
 * <Presence> unreported for good.
 *
 * The blast radius is the part worth pinning. <Presence> releases its leavers
 * as a batch — nothing goes until everything is ready — so one such region
 * strands every other child leaving in the same pass. That is what the second
 * assertion is for: `plain` has no Choreo, nothing to wait for, and an exit
 * that finished long before the assertion runs. It stayed on screen anyway.
 *
 * The score here deliberately names only kept sprites, which is the ordinary
 * case (build-order-leaver-test covers a real component making the same
 * choice). A score that never mentions removed sprites is not a mistake to be
 * caught — it is most scores — so the binding, not the score, has to be the
 * thing that gives up on a row that is never coming.
 */
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { Choreo, motion, Presence } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

const keyOf = (item: { id: string }) => item.id;
const gone = { opacity: 0 };
const here = { opacity: 1 };
const quick = { bounce: 0.12, type: 'spring', visualDuration: 0.3 } as const;

class Shown {
  @tracked items = [{ id: 'danced' }, { id: 'plain' }, { id: 'stays' }];
  narrow = () => {
    this.items = this.items.filter((item) => item.id === 'stays');
  };
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
const left = () =>
  [...document.querySelectorAll<HTMLElement>('[data-it]')]
    .map((el) => el.dataset['it'])
    .join(',') || 'none';

module('Integration | choreo | leaver exit', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a region inside a leaver does not strand it, or its batch', async function (assert) {
    const state = new Shown();
    await render(
      <template>
        <button
          type="button"
          class="narrow"
          {{on "click" state.narrow}}
        >x</button>
        <div style="position:relative">
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode="popLayout"
            @initial={{false}}
            as |item h|
          >
            <article
              data-it={{item.id}}
              {{motion
                presence=h
                initial=gone
                animate=here
                exit=gone
                transition=quick
              }}
            >
              {{#if (danced item)}}
                <Choreo as |c|>
                  <div {{motion id="mover" role="tile"}}>tile</div>
                  <c.Move @of={{c.still "tile"}} @ms={{200}} />
                </Choreo>
              {{else}}
                <p>{{item.id}}</p>
              {{/if}}
            </article>
          </Presence>
        </div>
      </template>
    );
    await rest(400);
    assert.strictEqual(
      document.querySelectorAll('[data-it]').length,
      3,
      'all three up'
    );

    await click('.narrow');
    await rest(900);

    assert.notOk(
      document.querySelector('[data-it="danced"]'),
      `the choreographed leaver is gone — left: ${left()}`
    );
    assert.notOk(
      document.querySelector('[data-it="plain"]'),
      `and it did not take its batch down with it — left: ${left()}`
    );
    assert.ok(
      document.querySelector('[data-it="stays"]'),
      'the survivor stays'
    );
    assert.strictEqual(
      document.querySelectorAll('[data-motion-pop-id]').length,
      0,
      'and nothing is left lifted out of flow, invisible and clickable'
    );
  });
});

function danced(item: { id: string }) {
  return item.id === 'danced';
}
