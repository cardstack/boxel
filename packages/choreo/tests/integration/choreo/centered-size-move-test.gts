/**
 * A size-animating Move on an element whose layout position depends on its
 * own size. Each card is `position: absolute` with no `left`, in a
 * `display: flex; justify-content: center` region, so its static position
 * is centered and its x is a function of its width.
 *
 * A card inserted over another at one size grows to another in a later
 * pass, sometimes while its entrance scale is still in flight and with
 * further renders landing mid-flight; the card under it shrinks. Every box
 * either card ever has lies inside the stage, so no frame shows either card
 * outside it, both land centered at their final widths, and no transform
 * is left behind.
 */
import { Choreo } from '@cardstack/choreo';
import {
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const STAGE = 1000;

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

interface Card {
  id: string;
  width: number;
}

const styleFor = (card: Card, index: number) => ({
  '--card-width': `${card.width}px`,
  zIndex: index + 1,
});

class Stack extends Component<{ Args: { seize: (self: Stack) => void } }> {
  @tracked cards: Card[] = [{ id: 'a', width: 970 }];
  @tracked tick = 0;
  constructor(owner: unknown, args: { seize: (self: Stack) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <style>
      .stack-card {
        position: absolute;
        height: 300px;
        width: var(--card-width);
        background: #0af;
      }
    </style>
    <Choreo
      style='display:flex;justify-content:center;position:relative;width:1000px;height:400px'
      as |c|
    >
      {{#each this.cards key='id' as |card index|}}
        <div
          class='stack-card'
          data-card={{card.id}}
          data-tick={{this.tick}}
          {{motion id=card.id role='card' style=(styleFor card index)}}
        ></div>
      {{/each}}
      <c.Parallel>
        <c.Tween
          @of={{c.inserted 'card'}}
          @scale={{array 0.96 1}}
          @opacity={{array 0 1}}
          @duration={{0.4}}
        />
        <c.Move @of={{c.moved 'card'}} @duration={{0.4}} />
      </c.Parallel>
    </Choreo>
  </template>
}

const array = (...v: number[]) => v;

interface Frame {
  t: number;
  transform: string;
  width: number;
  x: number;
}

function record(selector: string) {
  const seen: Frame[] = [];
  const t0 = performance.now();
  let on = true;
  const tick = () => {
    if (!on) {
      return;
    }
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      seen.push({
        t: Math.round(performance.now() - t0),
        x: Math.round(r.x),
        width: Math.round(r.width),
        transform: getComputedStyle(el).transform,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    seen,
    stop() {
      on = false;
    },
  };
}

const offStage = (f: Frame) => f.x < -1 || f.x + f.width > STAGE + 1;

module('Integration | choreo | centered size move', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: STAGE });
  setupChoreo(hooks);

  for (const [growAfter, rerenders] of [
    [0, 0],
    [1, 0],
    [4, 0],
    [1, 8],
  ] as const) {
    test(`a card opened over another, grown ${growAfter} frames later, re-rendered ${rerenders} times, stays on stage`, async function (assert) {
      let stack: Stack | undefined;
      const seize = (self: Stack) => (stack = self);
      await render(<template><Stack @seize={{seize}} /></template>);
      await animationsSettled();

      const top = record('[data-card="b"]');
      const under = record('[data-card="a"]');
      // the open: the new card at its loading size, the old one covered
      stack!.cards = [
        { id: 'a', width: 667 },
        { id: 'b', width: 768 },
      ];
      if (growAfter) {
        await frames(growAfter);
      }
      // the load: the new card takes its full width
      stack!.cards = [
        { id: 'a', width: 667 },
        { id: 'b', width: 960 },
      ];
      for (let i = 0; i < rerenders; i++) {
        await frames(1);
        stack!.tick++;
      }
      await animationsSettled();
      await frames(2);
      top.stop();
      under.stop();

      const show = (fs: Frame[]) =>
        fs
          .map((f) => `${f.t}ms x=${f.x} w=${f.width} ${f.transform}`)
          .join('\n');
      assert.deepEqual(
        top.seen.filter(offStage),
        [],
        `the opened card never leaves the stage:\n${show(top.seen)}`,
      );
      assert.deepEqual(
        under.seen.filter(offStage),
        [],
        `the covered card never leaves the stage:\n${show(under.seen)}`,
      );
      const last = top.seen[top.seen.length - 1]!;
      assert.deepEqual(
        [last.x, last.width],
        [20, 960],
        'the opened card lands centered at its full width',
      );
      const lastUnder = under.seen[under.seen.length - 1]!;
      assert.deepEqual(
        [lastUnder.x, lastUnder.width],
        [167, 667],
        'the covered card lands centered at its covered width',
      );
      assert.deepEqual(
        strandedTransforms(),
        [],
        'no card is left wearing the entrance it was given',
      );
    });
  }
});
