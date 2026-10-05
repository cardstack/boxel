/**
 * A score that is waiting for a cue must not hold a leaver in the document.
 *
 * A <Choreo> region takes a leaving participant into a run and undertakes to
 * see it out; the <Presence> holding that element waits for the region to say
 * when. That bargain is sound while the clock is moving. A GATE stops it: the
 * run parks, `stopTicking` halts the clock, and every row end still ahead
 * becomes unreachable — so `onSpriteDone` can never fire and the Presence
 * waits on a beat that is not coming. A gate is a promise that something will
 * ask for the next beat, and a leaver has nobody left to ask.
 *
 * The batch is why this matters more than one stuck element. <Presence>
 * releases its leavers together, so a single region parked at a gate strands
 * every child leaving in the same pass. That is what `plain` is here for: it
 * has no Choreo, nothing to wait for, and an exit that finished long before
 * these assertions run. It stayed on screen anyway.
 *
 * Found by the gallery, which is the point of the gallery: forty-two live
 * demos inside a grid that itself animates. Rack's score is a gate followed by
 * one parallel over sixty-one tiles, held still until its slider asks — so
 * filtering its card away parked a run with all sixty-one participants pending
 * on a clock at zero, and took the other thirty-nine cards down with it. Under
 * popLayout they stayed lifted out of flow, invisible and still clickable, and
 * clicking one demo opened a different one.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion, Presence } from 'glimmer-motion';
import { module, test } from 'qunit';

const keyOf = (item: { id: string }) => item.id;
const gone = { opacity: 0 };
const here = { opacity: 1 };
const quick = { bounce: 0.12, type: 'spring', visualDuration: 0.3 } as const;

class Shown {
  @tracked items = [{ id: 'gated' }, { id: 'plain' }, { id: 'stays' }];
  narrow = () => {
    this.items = this.items.filter((item) => item.id === 'stays');
  };
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));
const left = () =>
  [...document.querySelectorAll<HTMLElement>('[data-it]')]
    .map((el) => el.dataset['it'])
    .join(',') || 'none';

module('Integration | choreo | gated leaver', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('a run parked at a gate hands its leavers back', async function (assert) {
    const state = new Shown();
    await render(
      <template>
        <button type='button' class='narrow' {{on 'click' state.narrow}}>
          x
        </button>
        <div style='position:relative'>
          <Presence
            @items={{state.items}}
            @key={{keyOf}}
            @mode='popLayout'
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
              {{#if (gated item)}}
                <Choreo as |c|>
                  <div {{motion id='tile' role='tile'}}>tile</div>
                  <c.Sequence>
                    {{! nothing will ever open this — the card is leaving }}
                    <c.Gate />
                    <c.Tween
                      @of={{c.role 'tile'}}
                      @opacity={{0}}
                      @duration={{600}}
                    />
                  </c.Sequence>
                </Choreo>
              {{else}}
                <p>{{item.id}}</p>
              {{/if}}
            </article>
          </Presence>
        </div>
      </template>,
    );
    await rest(400);
    assert.strictEqual(
      document.querySelectorAll('[data-it]').length,
      3,
      'all three up',
    );

    await click('.narrow');
    await rest(900);

    assert.notOk(
      document.querySelector('[data-it="gated"]'),
      `the gated leaver is gone — left: ${left()}`,
    );
    assert.notOk(
      document.querySelector('[data-it="plain"]'),
      `and did not take its batch with it — left: ${left()}`,
    );
    assert.ok(
      document.querySelector('[data-it="stays"]'),
      'the survivor stays',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-motion-pop-id]').length,
      0,
      'nothing left lifted out of flow, invisible and clickable',
    );
  });
});

function gated(item: { id: string }) {
  return item.id === 'gated';
}
