// Pretui — Onboarding unit tests. Imports from ../agentic-shelf; when Onboarding moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Onboarding } from './onboarding';
import type { OnboardingStep } from './onboarding';

const STEPS: OnboardingStep[] = [
  { id: 's1', title: 'Welcome to the cupping room', body: 'Three steps and you are in.', caption: 'Welcome' },
  { id: 's2', title: 'Connect a supplier' },
  { id: 's3', title: 'Log your first lot', body: 'It takes a minute.' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-onboarding]') as HTMLElement;
}
function next(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-onboarding-next]') as HTMLButtonElement;
}
function back(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-onboarding-back]') as HTMLButtonElement;
}
function title(): string | undefined {
  return root().querySelector('.pretui-onb-title')?.textContent?.trim();
}
function railCurrent(): string | undefined {
  return root().querySelector('[data-test-pretui-step-list-items] [aria-current="step"]')?.textContent?.trim();
}
function position(): string | undefined {
  // `:scope >` pins the scene's own region as a direct child of the root
  return root().querySelector(':scope > .pretui-sr')?.textContent?.trim();
}

module('Pretui | components/onboarding', function (hooks) {
  setupCardTest(hooks);

  test('opens on the first step with a track rail, its position announced, Back disabled', async function (assert) {
    await render(<template><Onboarding @steps={{STEPS}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Getting started');
    assert.strictEqual(title(), 'Welcome to the cupping room');
    assert.strictEqual(root().querySelector('.pretui-onb-body')?.textContent?.trim(), 'Three steps and you are in.');
    assert.strictEqual(position(), 'Step 1 of 3 — Welcome to the cupping room');
    assert.true(back().disabled);
    assert.strictEqual(next().textContent?.trim(), 'Next');
    assert.strictEqual((root().querySelector('[data-test-pretui-step-list-items]') as HTMLElement).dataset['variant'], 'track');
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-step-name')).map((n) => n.textContent?.trim()), ['Welcome', 'Connect a supplier', 'Log your first lot'], 'the rail uses the caption where one is given');
    assert.true(railCurrent()?.includes('Welcome'), 'the rail marks the first step current');
    assert.strictEqual(root().querySelector('[data-test-pretui-onboarding-skip]'), null, 'no skip without a handler');
  });

  test('Next walks forward and reports; the last step turns Next into the done action', async function (assert) {
    let seen: number[] = [];
    let done = 0;
    const onStepChange = (i: number) => seen.push(i);
    const onDone = () => (done += 1);
    await render(<template><Onboarding @steps={{STEPS}} @onStepChange={{onStepChange}} @onDone={{onDone}} @doneLabel='Start cupping' /></template>);
    await click(next());
    assert.strictEqual(title(), 'Connect a supplier');
    assert.true(railCurrent()?.includes('Connect a supplier'), 'the rail hand-off follows the scene');
    assert.strictEqual(root().querySelector('.pretui-onb-body'), null, 'no empty body');
    assert.false(back().disabled);
    await click(next());
    assert.strictEqual(next().textContent?.trim(), 'Start cupping');
    assert.strictEqual(position(), 'Step 3 of 3 — Log your first lot');
    await click(next());
    assert.strictEqual(done, 1, 'the last Next finishes rather than overrunning');
    assert.deepEqual(seen, [1, 2]);
    await click(back());
    assert.strictEqual(title(), 'Connect a supplier');
  });

  test('a controlled @current holds still and reports; out-of-range values clamp', async function (assert) {
    let seen: number[] = [];
    const onStepChange = (i: number) => seen.push(i);
    await render(<template><Onboarding @steps={{STEPS}} @current={{1}} @onStepChange={{onStepChange}} /></template>);
    assert.strictEqual(title(), 'Connect a supplier');
    await click(next());
    assert.deepEqual(seen, [2]);
    assert.strictEqual(title(), 'Connect a supplier', 'the owner decides');

    await render(<template><Onboarding @steps={{STEPS}} @defaultCurrent={{9}} /></template>);
    assert.strictEqual(title(), 'Log your first lot', 'clamped to the last step');
  });

  test('offers skip only with a handler, and hands the media block the step', async function (assert) {
    let skips = 0;
    const onSkip = () => (skips += 1);
    await render(
      <template>
        <Onboarding @steps={{STEPS}} @onSkip={{onSkip}} @skipLabel='Not now' @label='Tour' @variant='steps'>
          <:media as |step index|><img data-test-media alt={{step.title}} data-index={{index}} /></:media>
        </Onboarding>
      </template>,
    );
    assert.strictEqual(root().getAttribute('aria-label'), 'Tour');
    let skip = root().querySelector('[data-test-pretui-onboarding-skip]') as HTMLButtonElement;
    assert.strictEqual(skip.textContent?.trim(), 'Not now');
    await click(skip);
    assert.strictEqual(skips, 1);
    assert.strictEqual((root().querySelector('[data-test-media]') as HTMLElement).dataset['index'], '0');
    assert.strictEqual((root().querySelector('[data-test-pretui-step-list-items]') as HTMLElement).dataset['variant'], 'steps');
  });

  test('an empty walkthrough shows an EmptyState and a disabled Next', async function (assert) {
    const NONE: OnboardingStep[] = [];
    await render(<template><Onboarding @steps={{NONE}} /></template>);
    assert.ok(root().querySelector('[data-test-pretui-empty]'));
    assert.true(next().disabled);
    assert.strictEqual(position(), '');
  });
});
