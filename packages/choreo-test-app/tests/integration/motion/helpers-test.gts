/**
 * The template helpers.
 *
 * These are plain functions used as helpers — no `helper()` wrapper, no
 * registration. Glimmer hands a plain function its positional arguments and,
 * when there are any, its named arguments as one trailing object. That last
 * part is the whole design and it is not obvious from the outside, so it is
 * pinned here: if it ever stopped being true, `(spring stiffness=300)` would
 * quietly become `spring()` and every transition in the docs would be a
 * default.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { ease, inertia, motion, spring, to, tween } from 'glimmer-motion';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

module('Integration | motion | template helpers', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('named arguments reach a plain function as one trailing object', function (assert) {
    assert.deepEqual(to({ opacity: 1, x: 4 }), { opacity: 1, x: 4 });
    assert.deepEqual(spring({ damping: 30, stiffness: 300 }), {
      damping: 30,
      stiffness: 300,
      type: 'spring',
    });
    assert.deepEqual(tween({ duration: 0.4, ease: 'backOut' }), {
      duration: 0.4,
      ease: 'backOut',
      type: 'tween',
    });
    assert.deepEqual(inertia({ power: 0.28 }), {
      power: 0.28,
      type: 'inertia',
    });
    assert.deepEqual(ease(0.4, 0, 0.1, 1), [0.4, 0, 0.1, 1]);
  });

  test('(to …) and (spring …) drive a real animation from a template', async function (assert) {
    class App extends Component {
      @tracked shown = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <div
          id="box"
          style="width:40px;height:40px"
          {{motion
            initial=(to opacity=0 x=0)
            animate=(if this.shown (to opacity=1 x=120) (to opacity=0 x=0))
            transition=(spring visualDuration=0.2 bounce=0)
          }}
        ></div>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();

    const box = document.querySelector('#box') as HTMLElement;
    assert.strictEqual(box.style.opacity, '0', 'initial was applied');

    app!.shown = true;
    await settled();
    await nextFrame();
    assert.notStrictEqual(
      box.style.transform,
      'translateX(120px)',
      'it is animating rather than jumping — the spring was used'
    );

    await animationsSettled();
    assert.strictEqual(box.style.opacity, '1');
    assert.ok(
      /120px/.test(box.style.transform),
      `and it arrived (${box.style.transform})`
    );
  });

  test('a spring helper fits a <Choreo> step as well as a transition', function (assert) {
    // The return type has to satisfy both `transition=` on {{motion}} and
    // `@spring=` on a step, which is why it is not simply `Transition`.
    const s = spring({ damping: 24, stiffness: 300 });
    assert.strictEqual(s.type, 'spring');
    assert.strictEqual(s.stiffness, 300);
  });
});
