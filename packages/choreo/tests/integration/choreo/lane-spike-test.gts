/**
 * SPIKE 1 — a lane: steps written in a PARENT that play in a CHILD region.
 *
 * The question the film graph hangs on (docs/film-graph/PLAN.md, spike 1):
 * can a parent contribute nodes to a child region's timeline so that the
 * child's queries resolve in the child's changeset, the child's run can
 * be driven from outside, and an unrelated re-render of the parent does
 * not replay the child's pass?
 *
 * The mechanism under test is one door on the region host —
 * `contribute(provider)` — and one lookup, `choreoHostById`. The `Lane`
 * below is a test-only component that walks through that door; the real
 * `f.Lane` would be the same thing with the film's clock behind it.
 */
import {
  Choreo,
  type ChoreoContext,
  choreoHostById,
  type ChoreoRun,
  type TimelineNode,
} from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/**
 * THE LANE. Rendered in the parent; addressed at a region by id; its
 * `node()` is pure and cheap (the composite contract), and the region it
 * names calls it on every pass. `@to` is the one handle, so the test can
 * EDIT the contributed node and watch the child replay.
 */
class Lane extends Component<{ Args: { in: string; to: number } }> {
  node(): TimelineNode {
    return {
      ease: 'linear',
      kind: 'tween',
      ms: 1000,
      name: 'lane',
      of: { id: 'box' },
      props: { x: [0, this.args.to] },
    };
  }

  attach = modifier((_el: Element, [region]: [string]) => {
    const host = choreoHostById(region);
    if (!host) {
      throw new Error(`lane: no region '${region}'`);
    }
    return host.contribute(this);
  });

  <template>
    <i hidden {{this.attach @in}}></i>
  </template>
}

let boardCtx: ChoreoContext | undefined;
const grabBoard = (c: ChoreoContext) => {
  boardCtx = c;
  return '';
};

class Stage extends Component<{ Args: { seize?: (self: Stage) => void } }> {
  /** the parent's own state, unrelated to the lane */
  @tracked tick = 0;
  /** the lane's one handle */
  @tracked to = 100;

  constructor(owner: unknown, args: { seize?: (self: Stage) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }

  <template>
    <div data-tick={{this.tick}}>
      {{! THE CHILD: a region with a participant and NO steps of its own }}
      <Choreo
        @id='board'
        style='position:relative;width:300px;height:100px'
        as |b|
      >
        {{grabBoard b}}
        <div
          id='box'
          style='position:absolute;top:10px;left:10px;width:40px;height:20px;background:#0af'
          {{motion id='box'}}
        ></div>
      </Choreo>
      {{! THE LANE, in the parent, addressed at the child }}
      <Lane @in='board' @to={{this.to}} />
    </div>
  </template>
}

const boxTransform = () =>
  (document.getElementById('box') as HTMLElement).style.transform;

const xOf = (transform: string): number => {
  const m = /translateX\((-?[\d.]+)px\)/.exec(transform);
  return m ? parseFloat(m[1]!) : 0;
};

module('Integration | choreo | lane spike', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('a parent contributes a step; the child compiles it, and its clock can be driven', async function (assert) {
    let stage: Stage | undefined;
    const seize = (self: Stage) => (stage = self);
    await render(<template><Stage @seize={{seize}} /></template>);
    await frames(2);

    // the first render of a region compiles no tree; the next render does
    stage!.tick += 1;
    await settled();
    await frames(2);

    const run: ChoreoRun | null = boardCtx?.run ?? null;
    assert.ok(run, 'the child region has a run');
    assert.ok(
      Math.abs(run!.duration - 1) < 0.02,
      `the run is the lane's tween — ${run!.duration.toFixed(2)}s`,
    );

    // DRIVEN, NOT PLAYED: pause the child's run and write its clock
    run!.pause();
    run!.time = 0.5;
    await frames(2);
    const half = xOf(boxTransform());
    assert.ok(
      Math.abs(half - 50) < 6,
      `at t=0.5 the box is halfway (${half.toFixed(1)}px)`,
    );
    run!.time = 1;
    await frames(2);
    const end = xOf(boxTransform());
    assert.ok(
      Math.abs(end - 100) < 2,
      `at t=1 the box is at the end (${end.toFixed(1)}px)`,
    );
    run!.time = 0.25;
    await frames(2);
    const back = xOf(boxTransform());
    assert.ok(
      Math.abs(back - 25) < 6,
      `back to t=0.25 reproduces the frame (${back.toFixed(1)}px)`,
    );
    // and a round trip lands on the same number: driven equals seeked
    run!.time = 0.8;
    await frames(2);
    run!.time = 0.25;
    await frames(2);
    assert.ok(
      Math.abs(xOf(boxTransform()) - back) < 0.5,
      `t=0.25 is the same frame after a detour (${xOf(boxTransform()).toFixed(1)}px)`,
    );

    // AN UNRELATED RE-RENDER OF THE PARENT keeps the child's run
    stage!.tick += 1;
    await settled();
    await frames(2);
    assert.strictEqual(
      boardCtx?.run,
      run,
      "a parent re-render that did not edit the lane's node keeps the child's run",
    );

    // AN EDIT TO THE LANE'S NODE replays the child's pass
    stage!.to = 200;
    await settled();
    await frames(2);
    const edited = boardCtx?.run ?? null;
    assert.notStrictEqual(
      edited,
      run,
      "editing the lane's node replays the child's pass",
    );
    edited!.pause();
    edited!.time = 1;
    await frames(2);
    const far = xOf(boxTransform());
    assert.ok(
      Math.abs(far - 200) < 2,
      `the edited lane drives the box to 200 (${far.toFixed(1)}px)`,
    );
    edited?.cancel();
  });
});
