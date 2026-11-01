/**
 * A leaver parked in a region's orphan layer is kept as a memory
 * (glimmer-motion's keepAsMemory): it shows the frame it last showed, and
 * nothing in it acts.
 */
import { Choreo } from '@cardstack/choreo';
import { live, setupChoreo } from '@cardstack/choreo/test-support';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

/** a hook in a parked leaver, which carries the memory suffix */
const parked = (hook: string) =>
  find(`[data-choreo-orphans] [${hook}-memory]`) as HTMLElement | null;

module('Integration | choreo | orphan memory', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('a parked leaver holds the frame it showed, and nothing in it acts', async function (assert) {
    class App extends Component {
      @tracked show = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <style>
          @keyframes orphan-memory-rise {
            from {
              opacity: 0.25;
            }
            to {
              opacity: 1;
            }
          }
          .orphan-memory-rise {
            opacity: 0.5;
            animation: orphan-memory-rise 30ms forwards;
          }
          @keyframes orphan-memory-turn {
            to {
              rotate: 1turn;
            }
          }
          .orphan-memory-turn {
            animation: orphan-memory-turn 10s linear infinite;
          }
          .orphan-memory-scroller {
            height: 40px;
            overflow: auto;
          }
          .orphan-memory-glass {
            backdrop-filter: blur(4px);
          }
        </style>
        <Choreo style='width:300px;height:300px' as |c|>
          {{#if this.show}}
            <div
              id='leaver'
              data-test-leaver
              style='width:200px;height:200px'
              {{motion id='leaver' role='card'}}
            >
              <div class='orphan-memory-rise' data-test-risen>risen</div>
              <div class='orphan-memory-turn' data-test-turn>turn</div>
              <div class='orphan-memory-scroller' data-test-scroller>
                <div style='height:200px'></div>
              </div>
              <div class='orphan-memory-glass' data-test-glass>glass</div>
              <input
                type='radio'
                aria-label='leaving'
                name='orphan-memory'
                checked
              />
            </div>
          {{/if}}
          <input
            type='radio'
            aria-label='live'
            name='orphan-memory'
            data-test-live-radio
            checked={{if this.show false true}}
          />
          <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.4}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    const risen = find('[data-test-risen]') as HTMLElement;
    while (risen.getAnimations()[0]?.playState === 'running') {
      await nextFrame();
    }
    (find('[data-test-scroller]') as HTMLElement).scrollTop = 50;
    // the region records a scroll offset from the scroll event, a frame later
    await nextFrame();
    await nextFrame();
    const turned = Number(
      find('[data-test-turn]')!.getAnimations()[0]!.currentTime,
    );

    app!.show = false;
    await settled();

    const leaver = parked('data-test-leaver');
    assert.ok(leaver, 'the leaver is parked, with its test hooks suffixed');
    assert
      .dom('[data-test-leaver]')
      .doesNotExist('a test hook selector finds only live elements');
    assert.strictEqual(live('.orphan-memory-rise'), null, 'live() skips it');
    assert.dom(leaver).hasAttribute('data-motion-memory');
    assert
      .dom(leaver)
      .hasAttribute('inert')
      .hasAttribute('aria-hidden', 'true');
    assert.dom('#leaver').doesNotExist('its HTML elements carry no ids');
    assert.true(
      (find('[data-test-live-radio]') as HTMLInputElement).checked,
      'the parked radio does not uncheck the live one in its group',
    );

    assert.strictEqual(
      getComputedStyle(parked('data-test-risen')!).opacity,
      '1',
      'a finished entrance shows its last frame, and does not play again',
    );
    const [turn] = parked('data-test-turn')!.getAnimations();
    assert.strictEqual(turn?.playState, 'paused', 'a running one holds still');
    const held = Number(turn!.currentTime);
    assert.true(
      held >= turned && held < turned + 1000,
      `at the time it had reached (${turned} → ${held})`,
    );
    assert.strictEqual(
      parked('data-test-scroller')!.scrollTop,
      50,
      'its scroll offsets are restored',
    );
    assert.strictEqual(
      getComputedStyle(parked('data-test-glass')!).backdropFilter,
      'none',
      'its backdrop filters are off',
    );

    await animationsSettled();
    assert.strictEqual(
      parked('data-test-leaver'),
      null,
      'gone when its row ends',
    );
  });
});
