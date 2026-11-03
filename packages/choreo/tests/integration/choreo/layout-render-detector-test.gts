/**
 * A region is a render detector: it snapshots every projecting element before
 * a render pass patches the DOM, so `{{motion layout=true}}` inside a
 * <Choreo> animates without a <LayoutGroup> around it, and glimmer-motion's
 * development-mode check for an ungrouped layout element stays quiet there.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { visualElementStore } from 'motion-dom';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

/** long enough that a slow runner's three frames barely dent it: after 1s the row is still 1.8 rows away */
const slow = { duration: 10, ease: 'linear' } as const;

class Rows {
  @tracked order = ['a', 'b', 'c'];
}

function row(id: string) {
  return document.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
}

/**
 * Stop every row's layout animation once it has been measured. Unmounting an
 * element leaves its layout animation running, so a 10s glide would keep the
 * frame loop ticking through the tests that follow and shift their first
 * frames.
 */
function stopGlides() {
  for (const el of document.querySelectorAll('[data-row]')) {
    visualElementStore.get(el)?.projection?.currentAnimation?.stop();
  }
}

module('Integration | choreo | layout render detector', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

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

  test('a keyed reorder of layout rows glides inside a region, and nothing warns', async function (assert) {
    const rows = new Rows();
    await render(
      <template>
        <Choreo>
          <ul style='margin: 0; padding: 0; list-style: none'>
            {{#each rows.order key='@identity' as |id|}}
              <li
                data-row={{id}}
                style='height: 40px'
                {{motion layout=true transition=slow}}
              >{{id}}</li>
            {{/each}}
          </ul>
        </Choreo>
      </template>,
    );
    await animationsSettled();
    const rowHeight = bounds(row('a')).height;
    const slot = bounds(row('a')).top;
    rows.order = ['c', 'a', 'b'];
    await settled();
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const offset = (bounds(row('c')).top - slot) / rowHeight;
    stopGlides();
    assert.true(
      offset > 1.5,
      `the promoted row set off from its old slot (${offset.toFixed(2)} rows away)`,
    );
    assert.deepEqual(
      warnings.filter(
        ([message]) =>
          typeof message === 'string' &&
          message.startsWith('glimmer-motion: a {{motion layout}}'),
      ),
      [],
      'no ungrouped-layout warning inside a region',
    );
  });
});
