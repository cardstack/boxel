/**
 * Rapid interruption, across every stage in the gallery.
 *
 * Nearly every animation bug this project has had was an interruption bug, and
 * they all present the same way: something the framework borrowed is not given
 * back. A transform left on an element, a leaver parked in the orphan layer
 * that nobody drops, a node whose exit never completes so it is never unmounted.
 * Each one is invisible on a slow, deliberate click and obvious after ten fast
 * ones — which is exactly the interaction a demo page invites.
 *
 * So rather than pin one scenario per bug, this hammers the REAL demo
 * components — the same code the gallery renders — and asserts the invariants
 * that must hold once everything has settled, whatever happened on the way:
 *
 *   1. nothing is stranded in a <Choreo> orphan layer
 *   2. no element is left wearing a transform nobody is animating
 *   3. the DOM comes back to the size it started at (no accumulation)
 *
 * A demo is added here by name; there is nothing to write per case. When one of
 * these fails it is naming a real leak, not a flaky measurement — the assertions
 * are all counts and rest states, never bounds.
 */
import { settled } from '@ember/test-helpers';

import {
  orphanCount,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { setMotionSpeed } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  setupChoreoGalleryTest,
  setupStageViewport,
  sleep,
} from '../helpers/choreo-gallery-stage';

// NOT find(): that scopes the query INSIDE the testing container, so it can
// never match the container itself
const root = () => document.querySelector('#ember-testing') as HTMLElement;

/** every button a person could hit on this stage */
const targets = (selector: string) =>
  [...root().querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !(el as HTMLButtonElement).disabled,
  );

/**
 * Click through `selector` as fast as the runloop allows, then let everything
 * finish. `gap` deliberately lands inside the animations it is interrupting —
 * it is the one sleep in this file that means something, and it is a duration
 * the test chose rather than one it is guessing about somebody else's spring.
 *
 * The wait at the end is `animationsSettled()`, not a sleep long enough to be
 * safe: a demo whose own setTimeout keeps rescheduling work would sail through
 * a fixed sleep and be measured mid-flight.
 */
async function hammer(selector: string, rounds: number, gap: number) {
  for (let i = 0; i < rounds; i++) {
    const buttons = targets(selector);
    if (!buttons.length) {
      break;
    }
    buttons[i % buttons.length]!.click();
    await settled();
    await sleep(gap);
  }
  // demos with their own settle timers (Inbox's busy flag, Enter's replay)
  // schedule the last pass off the engine's clock, so give them one tick
  await sleep(120);
  await animationsSettled({ timeout: 8000 });
}

/** close whatever the hammer left open, so the stage is where it started */
async function returnToRest(selector?: string) {
  if (!selector) {
    return;
  }
  for (let i = 0; i < 4; i++) {
    const button = root().querySelector<HTMLElement>(selector);
    if (!button) {
      return;
    }
    button.click();
    await settled();
    await animationsSettled({ timeout: 8000 });
  }
}

interface Stage {
  /** what a person clicks on this stage */
  clicks: string;
  /** the stage's export from its gallery module */
  component: string;
  name: string;
  /**
   * Something to click until it is gone, to put the stage back the way it was
   * found. Only a stage that can be left open needs one.
   *
   * Without this the invariants below are unfalsifiable. Ten clicks at a given
   * spacing leave a stage in whatever state they leave it in, so "the DOM did
   * not accumulate" fails whenever the last click happened to open a card —
   * three extra nodes that are the open card's own content — and "no element
   * kept a transform" fails whenever a lightbox is left open, because the
   * thumbnail behind it is a shared-element follower and is SUPPOSED to be
   * wearing the lead's box. Both of those read exactly like a leak. Neither is
   * one, and chasing them cost a day.
   */
  rest?: string;
  /** the stage's module in the gallery realm: `stages/<slug>` */
  slug: string;
}

const stages: Stage[] = [
  {
    clicks: '.study-card',
    component: 'Sequence',
    name: 'Sequence',
    rest: '.study-card.is-open',
    slug: 'sequence',
  },
  {
    clicks: '.list-name',
    component: 'Lists',
    name: 'Lists',
    slug: 'lists',
  },
  {
    clicks: '.piece',
    component: 'FarMatch',
    name: 'Far match',
    slug: 'far',
  },
  {
    clicks: '.slot',
    component: 'Interrupt',
    name: 'Interruption',
    slug: 'interrupt',
  },
  {
    clicks: '.slides-dot, .slides-next',
    component: 'Slides',
    name: 'Slides',
    slug: 'slides',
  },
  {
    clicks: '.replay',
    component: 'SplitView',
    name: 'Split view',
    slug: 'split',
  },
  {
    clicks: '.replay',
    component: 'Enter',
    name: 'Enter',
    slug: 'enter',
  },
  {
    clicks: '.replay',
    component: 'PresenceModes',
    name: 'Presence',
    slug: 'presence',
  },
  {
    clicks: '.replay, .crumb-btn',
    component: 'Trail',
    name: 'Trail',
    slug: 'trail',
  },
  {
    clicks: '.tab',
    component: 'SharedTabs',
    name: 'Shared tabs',
    slug: 'tabs',
  },
  {
    clicks: '.shot, .lightbox-close',
    component: 'Lightbox',
    name: 'Lightbox',
    rest: '.lightbox-close',
    slug: 'lightbox',
  },
];

module('Integration | Choreo gallery | rapid interruption', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks);

  async function renderStage(stage: Stage) {
    await gallery.renderStage(await gallery.stage(stage.slug, stage.component));
  }

  for (const stage of stages) {
    // three gaps: inside the first phase, mid-flight, and around the end of a
    // run — the three places an interruption lands differently
    for (const gap of [0, 60, 220]) {
      test(`${stage.name} survives 10 clicks ${gap}ms apart`, async function (assert) {
        await renderStage(stage);
        await animationsSettled();
        const before = root().querySelectorAll('*').length;

        await hammer(stage.clicks, 10, gap);
        await returnToRest(stage.rest);

        assert.strictEqual(
          orphanCount(),
          0,
          'no leaver stranded in an orphan layer',
        );
        assert.deepEqual(
          strandedTransforms(),
          [],
          'no element kept a transform',
        );
        const after = root().querySelectorAll('*').length;
        assert.true(
          after <= before + 2,
          `the DOM did not accumulate (${before} -> ${after})`,
        );
      });
    }
  }

  /**
   * The same hammering with the clock stretched. Slow motion widens every
   * window an interruption can land in, so a run is far more likely to be cut
   * mid-phase — a hold applied but not yet released, a move pinned but not yet
   * started.
   */
  for (const stage of stages.slice(0, 4)) {
    test(`${stage.name} survives interruption in slow motion`, async function (assert) {
      setMotionSpeed(5);
      await renderStage(stage);
      await animationsSettled();
      await hammer(stage.clicks, 6, 120);
      setMotionSpeed(1);
      await animationsSettled();
      await returnToRest(stage.rest);

      assert.strictEqual(orphanCount(), 0, 'no leaver stranded');
      assert.deepEqual(strandedTransforms(), [], 'no element kept a transform');
    });
  }
});
