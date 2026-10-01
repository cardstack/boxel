/**
 * A whole demo as a popLayout leaver.
 *
 * The gallery filters its cards with popLayout, and a card's Presence waits
 * for every registered child under it — including a <Choreo> region's
 * participants. The region hands back participants no cue names; a score
 * that named removed sprites (an untyped `c.id` matches them) would ride a
 * dying card through its full opening and stall the whole exiting batch.
 * BuildOrder selects kept sprites only, and this pins that contract.
 */
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { motion, Presence } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { BuildOrder } from 'test-app/components/examples/build-order';
import { setupRenderingTest } from 'test-app/tests/helpers';

const keyOf = (item: { id: string }) => item.id;
const gone = { opacity: 0 };
const here = { opacity: 1 };
const quick = { bounce: 0.12, type: 'spring', visualDuration: 0.3 } as const;

class Shown {
  @tracked items = [{ id: 'bo' }, { id: 'plain' }];
  narrow = () => {
    this.items = this.items.filter((item) => item.id === 'plain');
  };
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));

module('Integration | choreo | build-order leaver', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a popLayout leaver holding BuildOrder is removed', async function (assert) {
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
              {{#if (isBo item)}}<BuildOrder />{{else}}<p>plain</p>{{/if}}
            </article>
          </Presence>
        </div>
      </template>
    );
    await rest(400);
    assert.strictEqual(
      document.querySelectorAll('[data-it]').length,
      2,
      'both up'
    );
    await click('.narrow');
    await rest(900);
    const bo = document.querySelector<HTMLElement>('[data-it="bo"]');
    const stage = document.querySelector('.bo-stage') as
      | (HTMLElement & { buildOrder?: { c?: { run: unknown } } })
      | null;
    const run = stage?.buildOrder?.c?.run as
      | { duration: number; isDone(): boolean; time: number }
      | null
      | undefined;
    assert.strictEqual(
      document.querySelectorAll('[data-it]').length,
      1,
      `leaver removed — left: ${[...document.querySelectorAll('[data-it]')].map((el) => (el as HTMLElement).dataset['it']).join(',')} · ` +
        `bo opacity=${bo ? getComputedStyle(bo).opacity : 'gone'} · ` +
        `run=${run ? `t=${run.time.toFixed(2)}/${run.duration.toFixed(2)} done=${run.isDone()}` : String(run)} · ` +
        `animations=${document.getAnimations().length}`
    );
  });
});

function isBo(item: { id: string }) {
  return item.id === 'bo';
}
