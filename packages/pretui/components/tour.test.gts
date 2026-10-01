// Pretui — Tour unit tests: a labelled non-modal dialog per step, the step
// buttons, Escape, focus moving to Next and returning when it closes.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { click, render, settled, triggerKeyEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Tour } from './tour';
import type { TourStep } from './tour';

const STEPS: TourStep[] = [
  { id: 'search', title: 'Search lots', body: 'Type a farm or a region.', target: '.t-search' },
  { id: 'roast', title: 'Start a roast', body: 'Pick a profile, then press Start.', target: '.t-roast', placement: 'top' },
  { id: 'done', title: 'That is it', body: 'You can replay this from Help.' },
];

class State {
  @tracked open = false;
  show = () => (this.open = true);
  set = (v: boolean) => (this.open = v);
}

function card(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-tour-card]');
}

module('Pretui | components/tour', function (hooks) {
  setupCardTest(hooks);

  test('each step is a non-modal dialog labelled by its title and described by its body', async function (assert) {
    await render(<template>
      <input class='t-search' aria-label='Search' />
      <Tour @steps={{STEPS}} @defaultOpen={{true}} />
    </template>);
    let el = card() as HTMLElement;
    assert.strictEqual(el.getAttribute('role'), 'dialog');
    assert.notOk(el.hasAttribute('aria-modal'), 'not modal: the page stays usable');
    assert.strictEqual(document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim(), 'Search lots');
    assert.strictEqual(document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent?.trim(), 'Type a farm or a region.');
    assert.strictEqual(document.querySelector('[data-test-pretui-tour-progress]')?.textContent?.trim(), 'Step 1 of 3');
    assert.strictEqual(el.dataset['anchored'], 'true', 'placed against the target');
    assert.strictEqual(document.querySelector('[data-test-pretui-tour-ring]')?.getAttribute('aria-hidden'), 'true');
  });

  test('Next and Back move through the steps, and focus follows the primary button', async function (assert) {
    let seen: number[] = [];
    let change = (i: number) => seen.push(i);
    await render(<template>
      <input class='t-search' aria-label='Search' /><button type='button' class='t-roast'>Start</button>
      <Tour @steps={{STEPS}} @defaultOpen={{true}} @onIndexChange={{change}} />
    </template>);
    await settled();
    let next = () => document.querySelector('[data-test-pretui-tour-next]') as HTMLElement;
    assert.strictEqual(document.activeElement, next(), 'focus starts on Next');
    assert.notOk(document.querySelector('[data-test-pretui-tour-back]'), 'no Back on the first step');
    await click(next());
    assert.deepEqual(seen, [1]);
    assert.strictEqual(document.querySelector('[data-test-pretui-tour-title]')?.textContent?.trim(), 'Start a roast');
    assert.strictEqual(document.activeElement, next(), 'and moves to it again');
    await click('[data-test-pretui-tour-back]');
    assert.deepEqual(seen, [1, 0]);
  });

  test('Done on the last step finishes; a step with no target is centred', async function (assert) {
    let finished = 0;
    let finish = () => finished++;
    await render(<template><Tour @steps={{STEPS}} @defaultOpen={{true}} @index={{2}} @onFinish={{finish}} /></template>);
    assert.strictEqual(card()?.dataset['anchored'], 'false');
    let done = document.querySelector('[data-test-pretui-tour-next]') as HTMLElement;
    assert.strictEqual(done.textContent?.trim(), 'Done');
    await click(done);
    assert.strictEqual(finished, 1);
    assert.notOk(card(), 'closed');
  });

  test('Escape skips, and focus returns to where it was', async function (assert) {
    let state = new State();
    let skipped = 0;
    let skip = () => skipped++;
    await render(<template>
      <button type='button' class='t-start' {{on 'click' state.show}}>Take the tour</button>
      <Tour @steps={{STEPS}} @open={{state.open}} @onOpenChange={{state.set}} @onSkip={{skip}} />
    </template>);
    let start = document.querySelector('.t-start') as HTMLElement;
    start.focus();
    await click(start);
    assert.ok(card());
    await triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', 'Escape');
    assert.strictEqual(skipped, 1);
    assert.notOk(card());
    assert.strictEqual(document.activeElement, start, 'focus is back on the button that opened it');
  });

  test('the close button skips; @modal draws a scrim around the target', async function (assert) {
    let skipped = 0;
    let skip = () => skipped++;
    await render(<template>
      <input class='t-search' aria-label='Search' />
      <Tour @steps={{STEPS}} @defaultOpen={{true}} @modal={{true}} @onSkip={{skip}} />
    </template>);
    assert.strictEqual(document.querySelectorAll('.pretui-tour-scrim').length, 4, 'four rects around the target');

    assert.strictEqual(document.querySelector('[data-test-pretui-tour-close]')?.getAttribute('aria-label'), 'Skip tour');
    await click('[data-test-pretui-tour-close]');
    assert.strictEqual(skipped, 1);
  });

  test('non-modal: Escape in another control is that control’s, not the tour’s', async function (assert) {
    let skipped = 0;
    let skip = () => skipped++;
    let heard = 0;
    let hear = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') heard++;
    };
    await render(<template>
      <input class='t-other' aria-label='Other' {{on 'keydown' hear}} />
      <Tour @steps={{STEPS}} @defaultOpen={{true}} @onSkip={{skip}} />
    </template>);
    let other = document.querySelector('.t-other') as HTMLElement;
    other.focus();
    await triggerKeyEvent(other, 'keydown', 'Escape');
    assert.strictEqual(heard, 1, 'the control heard its Escape');
    assert.strictEqual(skipped, 0, 'and the tour stayed');
    assert.ok(card());
  });

  test('an invalid selector centres the card instead of breaking the tour', async function (assert) {
    await render(<template><Tour @steps={{BAD}} @defaultOpen={{true}} /></template>);
    assert.strictEqual(card()?.dataset['anchored'], 'false');
  });

  test('a controlled close returns focus, and the next open returns to its own opener', async function (assert) {
    let state = new State();
    await render(<template>
      <button type='button' class='t-a' {{on 'click' state.show}}>A</button>
      <button type='button' class='t-b' {{on 'click' state.show}}>B</button>
      <Tour @steps={{STEPS}} @open={{state.open}} @onOpenChange={{state.set}} />
    </template>);
    let a = document.querySelector('.t-a') as HTMLElement;
    let b = document.querySelector('.t-b') as HTMLElement;
    a.focus();
    await click(a);
    state.open = false;
    await settled();
    assert.strictEqual(document.activeElement, a, 'closed from outside, focus is back on A');
    b.focus();
    await click(b);
    await click('[data-test-pretui-tour-skip]');
    assert.strictEqual(document.activeElement, b, 'and the second open returns to B, not A');
  });
});

const BAD: TourStep[] = [{ id: 'x', title: 'X', body: 'Bad selector.', target: '#1st-step' }];
