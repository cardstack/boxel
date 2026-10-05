/**
 * The world dock: a far-match flight received into a camera'd world whose
 * score is mid-flight (docs/planes-and-cameras.md, the open case).
 *
 * The receiving plane is not a held pose here — it is a WORLD: a region
 * with its own running score whose camera is in force when the dock
 * arrives, replaced at the boundary pass by a recompiled run that an
 * external transport re-adopts (pause + seek), exactly as the compositor
 * does. The laws: the world's camera pose must survive the replacement
 * truthfully, the receiver must pin page-true where the sender stood, and
 * the landing must be the camera'd rest box.
 *
 * The trap the relative case guards: a replacement run compiled from the
 * SAME score is a re-execution of the same timeline — its camera fold
 * origin must be the timeline's origin, not the pose already in force.
 * Folding the score's prefix from a pose that prefix already produced
 * applies every relative cue twice.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import {
  orphanCount,
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const until = (cond: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const started = performance.now();
    const step = () => {
      if (cond()) {
        resolve();
      } else if (performance.now() - started > 4000) {
        reject(new Error('until: condition never held'));
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });

const rectOf = (sel: string) => {
  const b = (find(sel) as HTMLElement).getBoundingClientRect();
  return { h: b.height, w: b.width, x: b.x, y: b.y };
};

const zoomOf = (transform: string): number => {
  const m = /scale\(([\d.]+)\)/.exec(transform);
  return m ? parseFloat(m[1]!) : 1;
};

let ctxB: ChoreoContext | undefined;
const grabB = (c: ChoreoContext) => {
  ctxB = c;
  return '';
};

/**
 * Region A holds the piece while `home`; region B is the world — a
 * resident subject and a 1s score: a camera move over 0–0.2 (absolute
 * `Camera @zoom 2` or relative `SlowZoom @by 2`, per test), a wait, the
 * dock flight at 0.5–0.7, and a closing wait the pose holds through.
 */
class DockApp extends Component<{
  Args: { relative?: boolean; seize?: (self: DockApp) => void };
}> {
  @tracked home = true;
  @tracked take = 0;
  constructor(
    owner: unknown,
    args: { relative?: boolean; seize?: (self: DockApp) => void }
  ) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  <template>
    <div style="display:flex; gap:20px;">
      <Choreo
        class="stage"
        data-plane="a"
        style="position:relative;width:300px;height:200px;overflow:visible"
        as |a|
      >
        <div data-take={{this.take}}>
          {{#if this.home}}
            <div
              data-piece="a"
              style="position:absolute;top:10px;left:10px;width:60px;height:30px;background:#0af"
              {{motion id="piece" role="piece"}}
            ></div>
          {{/if}}
        </div>
        <a.Sequence>
          <a.Tween
            @of={{a.removed "piece"}}
            @opacity={{array 1 0}}
            @duration={{0.05}}
          />
        </a.Sequence>
      </Choreo>
      <Choreo
        class="stage"
        data-plane="b"
        style="position:relative;width:300px;height:200px;overflow:visible"
        as |b|
      >
        {{grabB b}}
        <div data-take={{this.take}}>
          <div
            data-subject
            style="position:absolute;top:170px;left:270px;width:10px;height:10px;background:#555"
            {{motion id="b-subject" role="subject"}}
          ></div>
          {{#unless this.home}}
            <div
              data-piece="b"
              style="position:absolute;top:40px;left:20px;width:60px;height:30px;background:#fa0"
              {{motion id="piece" role="piece"}}
            ></div>
          {{/unless}}
        </div>
        <b.Sequence>
          {{#if @relative}}
            <b.SlowZoom @by={{2}} @duration={{0.2}} />
          {{else}}
            <b.Camera @zoom={{2}} @duration={{0.2}} />
          {{/if}}
          <b.Wait @duration={{0.3}} />
          <b.Move @of={{b.received "piece"}} @duration={{0.2}} />
          <b.Wait @duration={{0.3}} />
        </b.Sequence>
      </Choreo>
    </div>
  </template>
}

const array = (...xs: number[]) => xs;

module('Integration | choreo | world dock', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test("a dock into a camera'd world under an external clock pins page-true and lands camera'd", async function (assert) {
    let app: DockApp | undefined;
    const seize = (self: DockApp) => (app = self);
    await render(<template><DockApp @seize={{seize}} /></template>);
    await animationsSettled();
    // stand the world's score up, then own its clock at once — the
    // recorder's posture: no landing ever plays on the wall clock
    app!.take = 1;
    await frames(2);
    const run = ctxB!.run!;
    run.pause();
    run.time = 0.4;
    await frames(2);
    const planeB = find('[data-plane="b"]') as HTMLElement;
    assert.strictEqual(
      zoomOf(planeB.style.transform),
      2,
      `the world holds its shot before the dock (tf="${planeB.style.transform}")`
    );

    const sent = rectOf('[data-piece="a"]');

    // the dock: ONE state flip mid-score; the boundary pass replaces the
    // world's run, and the transport re-adopts it exactly as the
    // compositor's renderAt transaction does
    app!.home = false;
    await frames(2);
    const replacement = ctxB!.run!;
    replacement.pause();
    replacement.time = 0.5;
    await frames(2);
    assert.strictEqual(
      zoomOf(planeB.style.transform),
      2,
      `the replacement run repaints the same shot (tf="${planeB.style.transform}")`
    );
    const pinned = rectOf('[data-piece="b"]');
    assert.true(
      Math.abs(pinned.x - sent.x) < 1.5 &&
        Math.abs(pinned.y - sent.y) < 1.5 &&
        Math.abs(pinned.w - sent.w) < 1.5,
      `the receiver pins page-true where the sender stood ` +
        `(sent ${String(sent.x)},${String(sent.y)} ${String(sent.w)}w — ` +
        `pinned ${String(pinned.x)},${String(pinned.y)} ${String(pinned.w)}w)`
    );

    replacement.time = 1;
    await frames(2);
    const landed = rectOf('[data-piece="b"]');
    // transform-origin is 0 0, so the transformed root's own rect already
    // carries the camera translate: landing = root + local × zoom
    const bBox = planeB.getBoundingClientRect();
    assert.true(
      Math.abs(landed.x - (bBox.x + 40)) < 1.5 &&
        Math.abs(landed.y - (bBox.y + 80)) < 1.5 &&
        Math.abs(landed.w - 120) < 1.5,
      `the landing is the camera'd rest box ` +
        `(landed ${String(landed.x)},${String(landed.y)} ${String(landed.w)}w, ` +
        `plane at ${String(bBox.x)},${String(bBox.y)})`
    );
    assert.strictEqual(orphanCount(), 0, 'no leaver stranded');
  });

  test('a replacement run keeps the camera fold origin: relative cues never double', async function (assert) {
    let app: DockApp | undefined;
    const seize = (self: DockApp) => (app = self);
    const relative = true;
    await render(
      <template><DockApp @relative={{relative}} @seize={{seize}} /></template>
    );
    await animationsSettled();
    // the preview posture: the score PLAYS, so the zoom cue lands on the
    // wall clock and folds into the region's resting camera
    app!.take = 1;
    await until(() => (ctxB!.run?.time ?? 0) > 0.25);
    const run = ctxB!.run!;
    run.pause();
    run.time = 0.4;
    await frames(2);
    const planeB = find('[data-plane="b"]') as HTMLElement;
    assert.strictEqual(
      zoomOf(planeB.style.transform),
      2,
      `the world holds the relative shot before the dock (tf="${planeB.style.transform}")`
    );

    app!.home = false;
    await frames(2);
    const replacement = ctxB!.run!;
    replacement.pause();
    replacement.time = 0.55;
    await frames(2);
    // the same score re-executed must fold from the TIMELINE's origin: a
    // fold from the pose in force applies SlowZoom ×2 on top of the ×2 it
    // already produced, and the world doubles to scale(4)
    assert.strictEqual(
      zoomOf(planeB.style.transform),
      2,
      `the replacement folds relative cues once (tf="${planeB.style.transform}")`
    );

    // and the preview plays on to a clean camera'd landing
    replacement.play();
    await animationsSettled();
    const landed = rectOf('[data-piece="b"]');
    const bBox = planeB.getBoundingClientRect();
    assert.strictEqual(
      zoomOf(planeB.style.transform),
      2,
      `the pose is still true at rest (tf="${planeB.style.transform}")`
    );
    assert.true(
      Math.abs(landed.x - (bBox.x + 40)) < 1.5 &&
        Math.abs(landed.y - (bBox.y + 80)) < 1.5 &&
        Math.abs(landed.w - 120) < 1.5,
      `the landing is the camera'd rest box ` +
        `(landed ${String(landed.x)},${String(landed.y)} ${String(landed.w)}w, ` +
        `plane at ${String(bBox.x)},${String(bBox.y)})`
    );
    assert.strictEqual(orphanCount(), 0, 'no leaver stranded');
    assert.deepEqual(strandedTransforms(), [], 'no element kept a transform');
  });
});
