import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { click, render, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';

import { LayoutGroup, motion, Presence } from 'glimmer-motion';
import { whatIsBusy } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  setupChoreoGalleryTest,
  setupStageViewport,
  sleep,
  stageWellStyle,
} from '../helpers/choreo-gallery-stage';

import type { GalleryDemo } from '../../../choreo-gallery/realm/demo';
import type { ComponentLike } from '@glint/template';

const keyOf = (demo: GalleryDemo) => demo.slug;
const gone = { opacity: 0, scale: 0.96 };
const here = { opacity: 1, scale: 1 };
const leaves = { opacity: 0, scale: 0.96 };
const quick = {
  bounce: 0.12,
  type: 'spring',
  visualDuration: 0.42,
} as const;

/** the size of the grid's window onto the tiles, and of each tile's stage */
const VIEW = { width: 1000, height: 660 };
const tileWell = stageWellStyle({ width: 400, height: 400 });

class Shown {
  @tracked group: string | undefined;

  constructor(private catalog: GalleryDemo[]) {}

  /** the gallery's shape: a getter, so every read is a NEW array and
   *  <Presence> re-diffs on every render rather than only when items change */
  get demos(): GalleryDemo[] {
    return this.group
      ? this.catalog.filter((demo) => demo.group === this.group)
      : this.catalog.slice();
  }

  /** the gallery changes the filter from inside a click handler, not from a
   *  bare assignment: the runloop flush is not the same shape */
  narrow = () => {
    this.group = 'Drag';
  };
}

/**
 * Wait for the DOM to reach the shape under test, rather than sleeping and
 * hoping. The failure it falls through to names the stuck leavers, which is
 * the diagnostic this test exists to give.
 */
function until(count: number) {
  return waitUntil(
    () => document.querySelectorAll('[data-test-demo]').length === count,
    { timeout: 8000 },
  ).catch(() => {
    // fall through: the assertion below reports which ones are stuck
  });
}

/**
 * The grid lays every tile out at full size and draws the whole of it at a
 * quarter scale, so all of them are on screen at once. A demo that starts its
 * score once it is seen, and drives its run from a frame loop that stops when
 * it is scrolled away, only holds that run while it is visible, so the filter
 * has to fire with every tile in view.
 */
const gridStyle = htmlSafe(
  'position: relative; display: flex; flex-wrap: wrap; width: 4000px; transform: scale(0.25); transform-origin: 0 0;',
);

module('Integration | Choreo gallery | popLayout subtree', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks, VIEW);

  test('a leaver whose subtree is a whole demo is removed from the DOM', async function (assert) {
    let catalog = await gallery.demos();
    let state = new Shown(catalog);
    let { DemoStage } = await gallery.import<{
      DemoStage: ComponentLike<{ Args: { demo: GalleryDemo; face: 'tile' } }>;
    }>('shell/demo-stage');
    let { ChoreoRoot } = await gallery.import<{
      ChoreoRoot: ComponentLike<{
        Blocks: { default: [] };
        Element: HTMLDivElement;
      }>;
    }>('shell/choreo-root');

    await render(
      <template>
        <ChoreoRoot>
          <button type='button' data-test-narrow {{on 'click' state.narrow}}>
            Drag
          </button>
          <LayoutGroup>
            <div class='grid' style={{gridStyle}}>
              <Presence
                @items={{state.demos}}
                @key={{keyOf}}
                @mode='popLayout'
                @initial={{false}}
                as |demo h|
              >
                <article
                  data-test-demo={{demo.slug}}
                  {{motion
                    presence=h
                    layout=true
                    initial=gone
                    animate=here
                    exit=leaves
                    transition=quick
                  }}
                >
                  <div style={{tileWell}}>
                    <DemoStage @demo={{demo}} @face='tile' />
                  </div>
                </article>
              </Presence>
            </div>
          </LayoutGroup>
        </ChoreoRoot>
      </template>,
    );
    await until(catalog.length);
    assert.strictEqual(
      document.querySelectorAll('[data-test-demo]').length,
      catalog.length,
      'everything is up',
    );

    // the regression needs a leaver whose region holds a run that will not
    // finish in time: wait for the demos that start on sight to be holding one
    const heldRuns = () =>
      whatIsBusy().filter((reason) => reason.endsWith('run in flight'));
    await waitUntil(() => heldRuns().length > 0, { timeout: 8000 }).catch(
      () => {
        // fall through: the assertion below says the precondition never held
      },
    );
    assert.ok(
      heldRuns().length > 0,
      'some demo is holding a run when the filter fires',
    );

    let drag = catalog.filter((demo) => demo.group === 'Drag');
    await click('[data-test-narrow]');
    await until(drag.length);
    // a beat for the exits to actually finish once the count is right
    await sleep(300);

    let kept = new Set(drag.map(keyOf));
    let stuck = [...document.querySelectorAll<HTMLElement>('[data-test-demo]')]
      .map((el) => el.dataset['testDemo'])
      .filter((slug) => !kept.has(slug!));
    assert.deepEqual(stuck, [], 'every leaver has left the DOM');
  });
});
