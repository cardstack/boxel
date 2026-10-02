/**
 * A Glimmer-only hazard with no React counterpart: React's AnimatePresence
 * keeps the *element tree* it captured before the diff, so nothing can mount
 * into a leaving child. A Glimmer block re-runs from live tracked state, so a
 * leaving subtree CAN grow new motion elements while it exits — and those
 * must never be able to block the exit that is already under way.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import { setupMotion } from 'glimmer-motion/test-support';
import type { Transition } from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

const FAST: Transition = { duration: 0.05 };
const IN = { opacity: 0 };
const ON = { opacity: 1 };
const OUT = { opacity: 0, transition: FAST };
const keyOf = (x: { key: string }) => x.key;

module('Integration | motion | presence late child', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a motion element mounting inside a leaving child does not block its exit', async function (assert) {
    class App extends Component {
      @tracked items: { key: string }[] = [{ key: 'a' }];
      /** live state the block reads — it changes while `a` is leaving */
      @tracked extras: number[] = [];
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Presence @items={{this.items}} @key={{keyOf}} as |item handle|>
          <div
            class="leaver"
            data-key={{item.key}}
            {{motion presence=handle initial=IN animate=ON exit=OUT}}
          >
            {{#each this.extras as |n|}}
              <span class="extra" {{motion layout=true}}>{{n}}</span>
            {{/each}}
          </div>
        </Presence>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    assert.strictEqual(document.querySelectorAll('.leaver').length, 1);

    app!.items = [];
    await settled();
    // …and, mid-exit, the block's live state grows a new motion child
    app!.extras = [1];
    await settled();
    for (let i = 0; i < 30; i++) {
      await nextFrame();
    }
    assert.strictEqual(
      document.querySelectorAll('.leaver').length,
      0,
      'the leaver still left'
    );
  });
});
