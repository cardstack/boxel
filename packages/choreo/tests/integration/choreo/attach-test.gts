/**
 * ATTACH — the driven run (docs/film-graph/CONSTRUCTS.md, construct 1).
 *
 * A parent region carries `<c.Attach @region @duration>` in its score; the
 * child region named by `@id` has a score of its own. While the window is
 * open the child's run is paused and told the parent's time, mapped
 * through `@in` and `@rate`; past it the end policy applies. These pin the
 * contract: driven equals seeked, the window is arithmetic, a detour lands
 * on the same frame, and an exact parent refuses a child that integrates.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/**
 * WAIT FOR THE READING, not for a frame count. Two frames is two frames
 * on this machine and something else entirely on a loaded CI runner,
 * where a box that settles in one frame here can still be moving in
 * three. The assertion afterwards is unchanged — this only stops it
 * being asked too early.
 */
const settles = async (ok: () => boolean, budget = 90) => {
  for (let i = 0; i < budget; i += 1) {
    if (ok()) {
      return;
    }
    await frames(1);
  }
};

let parentCtx: ChoreoContext | undefined;
let childCtx: ChoreoContext | undefined;
const grabParent = (c: ChoreoContext) => {
  parentCtx = c;
  return '';
};
const grabChild = (c: ChoreoContext) => {
  childCtx = c;
  return '';
};

/**
 * The child: a two-second linear tween of its own box, 0 → 200 px.
 * The parent: a one-second wait, then a one-second window over the child
 * mapped at rate 2 from `in` 0 — so the parent's second second is the
 * child's whole two seconds.
 */
class Stage extends Component<{
  Args: {
    end?: 'hold' | 'remove';
    exact?: boolean;
    seize?: (s: Stage) => void;
    spring?: boolean;
    /** two windows on the one child, the way a film's beats each name the plate */
    twice?: boolean;
  };
}> {
  @tracked take = 0;

  constructor(owner: unknown, args: Stage['args']) {
    super(owner as never, args as never);
    args.seize?.(this);
  }

  <template>
    <Choreo style='position:relative;width:300px;height:200px' as |c|>
      {{grabParent c}}
      <i data-take={{this.take}} {{motion id='rig'}}></i>
      <Choreo
        @id='child'
        style='position:relative;width:300px;height:100px'
        as |k|
      >
        {{grabChild k}}
        <div
          id='box'
          data-take={{this.take}}
          style='position:absolute;top:10px;left:10px;width:40px;height:20px;background:#0af'
          {{motion id='box'}}
        ></div>
        {{#if @spring}}
          <k.Spring @of={{k.id 'box'}} @x={{200}} />
        {{else}}
          <k.Tween
            @of={{k.id 'box'}}
            @x={{200}}
            @duration={{2}}
            @ease='linear'
          />
        {{/if}}
      </Choreo>
      <c.Sequence>
        <c.Wait @duration={{1}} />
        <c.Attach
          @region='child'
          @duration={{1}}
          @rate={{2}}
          @end={{@end}}
          @exact={{@exact}}
        />
        {{#if @twice}}
          <c.Attach @region='child' @duration={{1}} @in={{1}} @end='hold' />
        {{else}}
          <c.Wait @duration={{1}} />
        {{/if}}
      </c.Sequence>
    </Choreo>
  </template>
}

const xOf = (): number => {
  const m = /translateX\((-?[\d.]+)px\)/.exec(
    (document.getElementById('box') as HTMLElement).style.transform,
  );
  return m ? parseFloat(m[1]!) : 0;
};

async function mount(
  args: {
    end?: 'hold' | 'remove';
    exact?: boolean;
    spring?: boolean;
    twice?: boolean;
  } = {},
) {
  let stage: Stage | undefined;
  const seize = (s: Stage) => (stage = s);
  const { end, exact, spring, twice } = args;
  await render(
    <template>
      <Stage
        @seize={{seize}}
        @end={{end}}
        @exact={{exact}}
        @spring={{spring}}
        @twice={{twice}}
      />
    </template>,
  );
  await frames(2);
  // a region's first render compiles no tree: the next render does, for both
  stage!.take += 1;
  await settled();
  await frames(2);
  const parent = parentCtx!.run!;
  const child = childCtx!.run!;
  parent.pause();
  return { child, parent, stage: stage! };
}

module('Integration | choreo | attach', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('driven equals seeked: the child is a pure function of the parent clock', async function (assert) {
    const { child, parent } = await mount();
    assert.ok(
      Math.abs(parent.duration - 3) < 0.05,
      `the parent is 3 s (${parent.duration.toFixed(2)})`,
    );
    assert.ok(
      Math.abs(child.duration - 2) < 0.05,
      `the child is 2 s (${child.duration.toFixed(2)})`,
    );

    parent.time = 0.5; // before the window: the child stands at its head
    await frames(2);
    assert.ok(child.paused, 'the child is paused, not played');
    await settles(() => Math.abs(child.time) < 0.01);
    assert.ok(
      Math.abs(child.time) < 0.01,
      `before the window the child is at 0 (${child.time.toFixed(2)})`,
    );
    assert.ok(
      Math.abs(xOf()) < 2,
      `and its box is at rest (${xOf().toFixed(1)}px)`,
    );

    parent.time = 1.25; // a quarter into the window: child at 0.5 of 2 → 50 px
    await frames(2);
    assert.ok(
      Math.abs(child.time - 0.5) < 0.02,
      `t=1.25 → child 0.5 (${child.time.toFixed(2)})`,
    );
    assert.ok(Math.abs(xOf() - 50) < 4, `box at 50 (${xOf().toFixed(1)}px)`);

    parent.time = 1.75; // three quarters: child at 1.5 → 150 px
    await frames(2);
    await settles(() => Math.abs(child.time - 1.5) < 0.02);
    assert.ok(
      Math.abs(child.time - 1.5) < 0.02,
      `t=1.75 → child 1.5 (${child.time.toFixed(2)})`,
    );
    assert.ok(Math.abs(xOf() - 150) < 4, `box at 150 (${xOf().toFixed(1)}px)`);

    // a detour and back lands on the same frame
    parent.time = 2.5;
    await frames(2);
    parent.time = 1.25;
    await frames(2);
    assert.ok(
      Math.abs(xOf() - 50) < 4,
      `back to t=1.25 is the same frame (${xOf().toFixed(1)}px)`,
    );
    parent.cancel();
    child.cancel();
  });

  test('past the window, hold stands the child at its tail', async function (assert) {
    const { child, parent } = await mount({ end: 'hold' });
    parent.time = 2.5;
    await frames(2);
    await settles(() => Math.abs(child.time - 2) < 0.02);
    assert.ok(
      Math.abs(child.time - 2) < 0.02,
      `held at the tail (${child.time.toFixed(2)})`,
    );
    assert.ok(Math.abs(xOf() - 200) < 4, `box at 200 (${xOf().toFixed(1)}px)`);
    parent.cancel();
    child.cancel();
  });

  test('past the window, remove leaves the child alone', async function (assert) {
    const { child, parent } = await mount({ end: 'remove' });
    parent.time = 1.5;
    await frames(2);
    const mid = child.time;
    parent.time = 2.5;
    await frames(2);
    assert.ok(
      Math.abs(child.time - mid) < 0.02,
      `the child was not written past the window (${child.time.toFixed(2)})`,
    );
    parent.cancel();
    child.cancel();
  });

  test('an exact parent refuses a child that integrates', async function (assert) {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) =>
      errors.push(args.map(String).join(' '));
    try {
      const { child, parent } = await mount({ exact: true, spring: true });
      parent.time = 1.5;
      await frames(2);
      const refusals = errors.filter((e) =>
        /attached under an exact clock/.test(e),
      );
      assert.strictEqual(
        refusals.length,
        1,
        `a spring in the child is refused once, loudly (${errors.length} error(s) in all)`,
      );
      assert.ok(
        child.time < 0.5,
        `and the child is never driven (${child.time.toFixed(2)})`,
      );
      parent.cancel();
      child.cancel();
    } finally {
      console.error = original;
    }
  });

  test('several windows on one region: the one in force governs, then the latest holds', async function (assert) {
    // window A: 1–2 s, rate 2 from 0 (the child's 0–2); window B: 2–3 s at
    // rate 1 from `in` 1 (the child's 1–2), holding past its end
    const { child, parent } = await mount({ end: 'hold', twice: true });
    parent.time = 1.5;
    await frames(2);
    await settles(() => Math.abs(child.time - 1) < 0.02);
    assert.ok(
      Math.abs(child.time - 1) < 0.02,
      `inside A: child at 1 (${child.time.toFixed(2)}) — B, still future, does not stand it at its head`,
    );
    parent.time = 2.5;
    await frames(2);
    assert.ok(
      Math.abs(child.time - 1.5) < 0.02,
      `inside B: child at 1.5 (${child.time.toFixed(2)}) — A, past and holding, does not override`,
    );
    parent.time = 2.99;
    await frames(2);
    parent.time = 3.2;
    await frames(2);
    await settles(() => Math.abs(child.time - 2) < 0.02);
    assert.ok(
      Math.abs(child.time - 2) < 0.02,
      `past both: the latest window holds the tail (${child.time.toFixed(2)})`,
    );
    parent.time = 0.5;
    await frames(2);
    assert.ok(
      Math.abs(child.time) < 0.02,
      `before both: the earliest stands the child at its head (${child.time.toFixed(2)})`,
    );
    parent.cancel();
    child.cancel();
  });

  test('while the parent plays, the child plays natively and stays within a frame', async function (assert) {
    const { child, parent } = await mount({ end: 'hold' });
    parent.time = 1.1; // just inside the window
    await frames(2);
    parent.play();
    await new Promise((r) => setTimeout(r, 400));
    assert.false(
      child.paused,
      `the child is playing, not being seeked (parent paused=${parent.paused} time=${parent.time.toFixed(2)} done=${parent.isDone()}; child time=${child.time.toFixed(2)} done=${child.isDone()})`,
    );
    const expected = (parent.time - 1) * 2;
    await settles(() => Math.abs(child.time - expected) < 0.1);
    assert.ok(
      Math.abs(child.time - expected) < 0.1,
      `the child is within a frame of the parent's clock (${child.time.toFixed(2)} vs ${expected.toFixed(2)})`,
    );
    parent.pause();
    await frames(2);
    assert.true(child.paused, 'a paused parent holds the child');
    parent.cancel();
    child.cancel();
  });
});
