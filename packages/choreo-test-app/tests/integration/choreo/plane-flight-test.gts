/**
 * A sprite between planes when the planes disagree about zoom
 * (docs/planes-and-cameras.md, build-order step 2).
 *
 * Far matching hands the receiver the sender's PAGE box — the only space
 * two regions share — but the receiver's flight is written in ITS plane's
 * local space, under its plane's camera. The law: the pin must be
 * page-true (the receiver paints exactly where the sender stood, whatever
 * the receiving plane's zoom), and the landing must be clean (no stranded
 * transform, no orphan, the element resting in its natural box).
 */
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import {
  orphanCount,
  strandedTransforms,
} from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const rectOf = (sel: string) => {
  const b = (find(sel) as HTMLElement).getBoundingClientRect();
  return { h: b.height, w: b.width, x: b.x, y: b.y };
};

module('Integration | choreo | plane flight', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a flight into a zoomed plane pins page-true and lands clean', async function (assert) {
    class App extends Component<{
      Args: { seize?: (self: App) => void };
    }> {
      @tracked take = 0;
      @tracked home = true;
      constructor(owner: unknown, args: { seize?: (self: App) => void }) {
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
              {{! a plane with no participants makes no pass — this resident
                  gives B a changeset so its camera can stand up }}
              <div
                data-anchor
                style="position:absolute;top:170px;left:270px;width:10px;height:10px;background:#555"
                {{motion id="b-anchor" role="anchor"}}
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
              <b.Camera @zoom={{2}} @duration={{0.01}} />
              <b.Move @of={{b.received "piece"}} @duration={{0.1}} />
            </b.Sequence>
          </Choreo>
        </div>
      </template>
    }
    const array = (...xs: number[]) => xs;
    let ctxB: ChoreoContext | undefined;
    const grabB = (c: ChoreoContext) => {
      ctxB = c;
      return '';
    };
    let app: App | undefined;
    const seize = (self: App) => (app = self);
    await render(<template><App @seize={{seize}} /></template>);
    await animationsSettled();
    // the first render plays nothing; this pass stands plane B at zoom 2
    app!.take = 1;
    await animationsSettled();
    const planeB = find('[data-plane="b"]') as HTMLElement;
    assert.true(
      planeB.style.transform.includes('scale(2)'),
      `plane B holds zoom 2 (tf="${planeB.style.transform}" run=${String(ctxB?.run?.duration)} t=${String(ctxB?.run?.time)} zoom=${String(ctxB?.camera.zoom)})`
    );

    // the sender's box, page space, the frame before the move
    const sent = rectOf('[data-piece="a"]');

    // ONE state flip: A loses the piece, B gains it, the barrier pairs them
    app!.home = false;
    await frames(1);
    const pinned = rectOf('[data-piece="b"]');
    assert.true(
      Math.abs(pinned.x - sent.x) < 1.5 &&
        Math.abs(pinned.y - sent.y) < 1.5 &&
        Math.abs(pinned.w - sent.w) < 1.5,
      `the receiver pins page-true where the sender stood ` +
        `(sent ${String(sent.x)},${String(sent.y)} ${String(sent.w)}w — ` +
        `pinned ${String(pinned.x)},${String(pinned.y)} ${String(pinned.w)}w)`
    );

    // and the landing is the receiver's own rest, nothing stranded
    await animationsSettled();
    const landed = rectOf('[data-piece="b"]');
    const bBox = planeB.getBoundingClientRect();
    // plane B is zoomed 2 about its origin: local (20, 40, 60×30) paints
    // at origin + (40, 80), size ×2
    assert.true(
      Math.abs(landed.x - (bBox.x + 40)) < 1.5 &&
        Math.abs(landed.y - (bBox.y + 80)) < 1.5 &&
        Math.abs(landed.w - 120) < 1.5,
      `the landing is the zoomed rest box ` +
        `(landed ${String(landed.x)},${String(landed.y)} ${String(landed.w)}w, ` +
        `plane at ${String(bBox.x)},${String(bBox.y)})`
    );
    assert.strictEqual(orphanCount(), 0, 'no leaver stranded');
    assert.deepEqual(strandedTransforms(), [], 'no element kept a transform');
  });
});
