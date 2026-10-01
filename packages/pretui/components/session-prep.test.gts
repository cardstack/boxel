// Pretui — SessionPrep unit tests. Imports from ../agentic-work; when SessionPrep moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SessionPrep } from './session-prep';
import type { SessionPrepStep } from './session-prep';

const STEPS: SessionPrepStep[] = [
  { id: 's1', label: 'Load the workspace', state: 'complete' },
  { id: 's2', label: 'Scan recent messages', state: 'running' },
  { id: 's3', label: 'Warm the model' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-session-prep]') as HTMLElement;
}
function steps(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-step')) as HTMLElement[];
}

module('Pretui | components/session-prep', function (hooks) {
  setupCardTest(hooks);

  test('frames a StepList with its own states mapped onto the rail, and a derived summary', async function (assert) {
    await render(<template><SessionPrep @steps={{STEPS}} @note='Indexing the realm takes a moment.' /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Preparing your session');
    assert.strictEqual(root().querySelector('.pretui-prep-title')?.textContent?.trim(), 'Preparing your session');
    assert.strictEqual(root().querySelector('.pretui-prep-note')?.textContent?.trim(), 'Indexing the realm takes a moment.');
    assert.deepEqual(steps().map((s) => s.dataset['state']), ['complete', 'current', 'upcoming'], 'running becomes the current step');
    assert.strictEqual(root().querySelector('[data-test-pretui-step-list-summary]')?.textContent?.trim(), '1 of 3 complete');
    assert.strictEqual(root().dataset['done'], undefined);
    assert.strictEqual(root().querySelector('[data-test-pretui-session-prep-skip]'), null, 'no skip without a handler');
  });

  test('marks itself done once every step settled, mapping failed to error', async function (assert) {
    const DONE: SessionPrepStep[] = [
      { id: 's1', label: 'a', state: 'complete' },
      { id: 's2', label: 'b', state: 'failed' },
    ];
    await render(<template><SessionPrep @steps={{DONE}} /></template>);
    assert.strictEqual(root().dataset['done'], 'true');
    assert.deepEqual(steps().map((s) => s.dataset['state']), ['complete', 'error']);
  });

  test('offers the escape hatch only when given one, and takes titles, variant and a block', async function (assert) {
    let skips = 0;
    const onSkip = () => (skips += 1);
    await render(
      <template>
        <SessionPrep @steps={{STEPS}} @title='Warming up' @skipLabel='Just start' @variant='track' @onSkip={{onSkip}}>
          <span data-test-extra>model picker</span>
        </SessionPrep>
      </template>,
    );
    assert.strictEqual(root().getAttribute('aria-label'), 'Warming up');
    let skip = root().querySelector('[data-test-pretui-session-prep-skip]') as HTMLButtonElement;
    assert.strictEqual(skip.textContent?.trim(), 'Just start');
    await click(skip);
    assert.strictEqual(skips, 1);
    assert.strictEqual((root().querySelector('[data-test-pretui-step-list-items]') as HTMLElement).dataset['variant'], 'track');
    assert.ok(root().querySelector('[data-test-extra]'));
  });
});
