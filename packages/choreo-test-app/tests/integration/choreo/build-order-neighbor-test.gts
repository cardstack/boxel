/**
 * The gallery, distilled: a neighbouring demo that writes tracked state
 * every frame (the Playhead demo does exactly this while it plays). Every
 * app render re-runs each region's render detector — so without care, the
 * neighbour's 60fps writes replay Build Order's pass 60 times a second,
 * cancelling and re-pinning the run it shares a page with: the scrubbed
 * still paints PINS, and parts of the logo simply go missing.
 *
 * The contract: an all-kept pass whose compiled score matches the
 * in-flight run KEEPS that run. Unrelated renders must not restart a
 * region's clock.
 */
import { render, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import type { ChoreoRun } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { BuildOrder } from 'test-app/components/examples/build-order';

class Noise extends Component {
  @tracked n = 0;
  raf = 0;
  constructor(owner: object, args: object) {
    super(owner as never, args as never);
    const tick = () => {
      this.n++;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  willDestroy() {
    super.willDestroy();
    cancelAnimationFrame(this.raf);
  }
  <template>
    <span data-noise>{{this.n}}</span>
  </template>
}

function run(): ChoreoRun | null {
  const stage = document.querySelector('.bo-stage') as HTMLElement & {
    buildOrder?: { c?: { run: ChoreoRun | null } };
  };
  return stage.buildOrder?.c?.run ?? null;
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Integration | choreo | build-order neighbours', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a per-frame tracked neighbour does not restart the run', async function (assert) {
    await render(<template><Noise /><BuildOrder /></template>);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await frames(10);

    // the run must SURVIVE the neighbour's render noise
    const before = run()!;
    await frames(30);
    assert.strictEqual(
      run(),
      before,
      'thirty noisy frames later, the region still plays the same run'
    );

    // and a scrubbed still must hold its finals through the noise
    const range = document.querySelector<HTMLInputElement>('.bo-range')!;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    range.value = '1.05';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await frames(30);
    const plate =
      document.querySelector('.bo-plate')?.getAttribute('style') ?? '';
    assert.true(
      plate.includes('opacity: 1'),
      `the plate holds its finals under render noise — got '${plate}'`
    );
    run()?.cancel();
  });
});
