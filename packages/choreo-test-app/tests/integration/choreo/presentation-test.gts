/**
 * Presentation — gates as presenter mode (docs/choreo-constructs.md §8.1).
 * A three-build slide: auto kicker, click-through mid-path, then the pulse.
 */
import { click, render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import type { ChoreoRun } from 'glimmer-motion';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Presentation } from 'test-app/components/examples/presentation';

import { nextFrame } from '../../helpers/motion';

function host():
  | (HTMLElement & {
      presentation?: { c: { run: ChoreoRun | null } | null };
    })
  | null {
  return document.querySelector('.pres-slide');
}

function run(): ChoreoRun | null {
  return host()?.presentation?.c?.run ?? null;
}

const opacityOf = (sel: string) =>
  parseFloat(getComputedStyle(document.querySelector(sel)!).opacity);

module('Integration | choreo | presentation', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the kicker writes itself, then a mash completes the path', async function (assert) {
    await render(<template><Presentation /></template>);
    await waitUntil(() => run() != null, { timeout: 4000 });

    // first park is the delay gate after the title; wait until the auto-open
    // has played the kicker and we sit at the presenter gate
    await waitUntil(
      () => {
        const r = run();
        return Boolean(r?.parked && r.segment === 1);
      },
      { timeout: 4000 }
    );
    assert.ok(opacityOf('.pres-title') > 0.9, 'title landed without a click');
    assert.ok(
      opacityOf('.pres-kicker') > 0.9,
      'kicker wrote itself on the @delay gate'
    );
    assert.ok(
      opacityOf('.pres-stamp') < 0.1,
      'stamp has not started — the next beat is still gated'
    );

    // start the path, then mash mid-flight: click-through, not skip
    await click('.pres-slide');
    await nextFrame();
    await nextFrame();
    const r = run()!;
    assert.false(r.parked, 'path is in flight');
    r.advance();
    assert.true(r.parked, 'mash parks at the next gate');
    assert.strictEqual(r.segment, 2, 'the path segment completed, not skipped');
    assert.ok(
      opacityOf('.pres-hull') > 0.9,
      'the hull landed — click-through finishes the beat'
    );
    assert.ok(
      opacityOf('.pres-stamp') < 0.1,
      'the stamp still waits behind the gate'
    );

    await click('.pres-slide');
    await animationsSettled();
    assert.ok(opacityOf('.pres-stamp') > 0.9, 'the last beat pulses in');
    assert.true(run()!.isDone(), 'the cursor only moved forward');
  });
});
