/**
 * Presentation — gates as presenter mode (docs/choreo-constructs.md §8.1).
 * A three-build slide: auto kicker, click-through mid-path, then the pulse.
 */
import { click, focus, triggerKeyEvent, waitUntil } from '@ember/test-helpers';

import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  frames,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';

import type { ChoreoRun } from '@cardstack/choreo';

import type { ComponentLike } from '@glint/template';

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

module('Integration | Choreo gallery | presentation', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  let Presentation: ComponentLike;

  hooks.beforeEach(async function () {
    Presentation = await gallery.stage('presentation', 'Presentation');
  });

  test('the kicker writes itself, then a mash completes the path', async function (assert) {
    await gallery.renderStage(Presentation);
    await waitUntil(() => run() != null, { timeout: 4000 });

    // first park is the delay gate after the title; wait until the auto-open
    // has played the kicker and we sit at the presenter gate
    await waitUntil(
      () => {
        const r = run();
        return Boolean(r?.parked && r.segment === 1);
      },
      { timeout: 4000 },
    );
    assert.ok(opacityOf('.pres-title') > 0.9, 'title landed without a click');
    assert.ok(
      opacityOf('.pres-kicker') > 0.9,
      'kicker wrote itself on the @delay gate',
    );
    assert.ok(
      opacityOf('[data-test-pres-title-b]') < 0.1,
      'the second word waits — the title slide is type, and you ask for it',
    );
    assert.ok(
      opacityOf('.pres-stamp') < 0.1,
      'stamp has not started — the next beat is still gated',
    );

    // start the path, then mash mid-flight: click-through, not skip
    await click('.pres-slide');
    await frames(1);
    const r = run()!;
    assert.false(r.parked, 'path is in flight');
    r.advance();
    assert.true(r.parked, 'mash parks at the next gate');
    assert.strictEqual(r.segment, 2, 'the path segment completed, not skipped');
    assert.ok(
      opacityOf('[data-test-pres-title-b]') > 0.9,
      'the second word landed — click-through finishes the beat',
    );
    assert.ok(
      opacityOf('.pres-stamp') < 0.1,
      'the stamp still waits behind the last gate',
    );
    // the rule wipes out on the SAME beat as the word now — the deck is ten
    // clicks end to end, so it is not a gate of its own
    assert.ok(
      opacityOf('.pres-swipe') > 0.9,
      'the rule came with the word, not on another click',
    );

    await click('.pres-slide');
    await animationsSettled();
    assert.ok(opacityOf('.pres-stamp') > 0.9, 'the last beat pulses in');
    assert.true(run()!.isDone(), 'the cursor only moved forward');
  });

  test('keys work once the deck is focused: Space builds, > steps, < goes back', async function (assert) {
    await gallery.renderStage(Presentation);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await waitUntil(
      () => {
        const r = run();
        return Boolean(r?.parked && r.segment === 1);
      },
      { timeout: 4000 },
    );

    const deck = document.querySelector('[data-test-pres]')!;
    await focus(deck);
    assert.strictEqual(document.activeElement, deck, 'the deck took focus');

    await triggerKeyEvent(deck, 'keydown', ' ');
    await frames(1);
    assert.false(run()!.parked, 'Space is a click — the path is in flight');
    await animationsSettled();
    const built = run()!.segment;
    assert.strictEqual(
      built,
      2,
      'Space opened the gate and parked at the next',
    );

    // '<' walks BUILDS, not slides: one press undoes one beat, in place
    await triggerKeyEvent(deck, 'keydown', '<');
    await animationsSettled();
    assert.strictEqual(run()!.segment, built - 1, '< stepped one build back');
    assert.strictEqual(
      document
        .querySelector('.pres-leaf:not(.is-leaving) .pres-slide')
        ?.getAttribute('data-slide'),
      '0',
      'stepping back a build does NOT turn the page',
    );

    // '>' walks forward the same way. Not an exact segment count: this slide
    // opens with an auto @delay gate, and scrubbing back across it re-arms it,
    // so a forward step here can legitimately carry the auto beat with it.
    // The contract is "forward, in place", and that is what is asserted.
    const backAt = run()!.segment;
    await triggerKeyEvent(deck, 'keydown', '>');
    await animationsSettled();
    assert.ok(run()!.segment > backAt, '> stepped the build back in');

    // step until the page turns rather than a fixed count: how many builds a
    // slide has is the score's business, and the contract under test is that
    // stepping past the LAST of them is what turns the page
    const slideNow = () =>
      document
        .querySelector('.pres-leaf:not(.is-leaving) .pres-slide')
        ?.getAttribute('data-slide');
    let steps = 0;
    while (slideNow() === '0' && steps < 10) {
      await triggerKeyEvent(deck, 'keydown', '>');
      await animationsSettled();
      steps++;
    }
    assert.strictEqual(
      slideNow(),
      '1',
      'stepping past the last build turns the page, and only one page',
    );
    assert.strictEqual(
      document.querySelectorAll('.pres-slide').length,
      1,
      'the title plate finished its exit — one slide in the tree',
    );
  });

  test('slides 02 and 04 nest a second Choreo; a click opens an inner gate', async function (assert) {
    await gallery.renderStage(Presentation);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await waitUntil(
      () => {
        const r = run();
        return Boolean(r?.parked && r.segment === 1);
      },
      { timeout: 4000 },
    );

    // the segment rail jumps slides; the arrows now walk builds, so this
    // reaches the verse without stepping through the title's beats
    await click('[data-test-pres-seg="1"]');
    await waitUntil(() => document.querySelector('[data-test-pres-verse]'), {
      timeout: 4000,
    });
    await waitUntil(
      () => {
        const tick = document.querySelector(
          '[data-test-pres-verse] .pres-tick',
        );
        return Boolean(
          tick && parseFloat(getComputedStyle(tick).opacity) > 0.9,
        );
      },
      { timeout: 4000 },
    );
    await animationsSettled();
    assert.strictEqual(
      document.querySelectorAll('.pres-slide').length,
      1,
      'Presence released the leaver',
    );

    const tickAt = (i: number) =>
      document.querySelectorAll('[data-test-pres-verse] .pres-tick')[
        i
      ] as HTMLElement;
    assert.ok(
      parseFloat(getComputedStyle(tickAt(1)).opacity) < 0.15,
      'the second verse waits behind a nested gate',
    );

    await click('[data-slide="1"]');
    await animationsSettled();
    assert.ok(
      parseFloat(getComputedStyle(tickAt(1)).opacity) > 0.9,
      'the click belonged to the inner region',
    );
  });

  test('a segment jumps to that slide, already built when going back', async function (assert) {
    await gallery.renderStage(Presentation);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await waitUntil(
      () => {
        const r = run();
        return Boolean(r?.parked && r.segment === 1);
      },
      { timeout: 4000 },
    );

    await click('[data-test-pres-seg="2"]');
    await animationsSettled();
    assert.strictEqual(
      document
        .querySelector('.pres-leaf:not(.is-leaving) .pres-slide')
        ?.getAttribute('data-slide'),
      '2',
      'the segment is a slide, not a build',
    );

    await click('[data-test-pres-seg="0"]');
    await animationsSettled();
    const title = document.querySelector('[data-slide="0"]');
    assert.strictEqual(title?.getAttribute('data-arrive'), 'back');
    assert.ok(
      opacityOf('.pres-title') > 0.9,
      'back shows the title slide already built',
    );
  });
});
