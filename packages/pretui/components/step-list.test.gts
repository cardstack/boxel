// Pretui — StepList unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { StepList } from './step-list';
import type { StepItem } from './step-list';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/step-list', function (hooks) {
  setupCardTest(hooks);

  const STEPS: StepItem[] = [
    { label: 'Draft' },
    { label: 'Cupping' },
    { label: 'Publish' },
  ];

  test('StepList is an ordered list deriving each state from @current', async function (assert) {
    await render(<template><StepList @steps={{STEPS}} @current={{1}} /></template>);
    let list = q('[data-test-pretui-step-list-items]');
    assert.strictEqual(list.tagName, 'OL', 'the order is in the markup, not only the numerals');
    assert.strictEqual(list.getAttribute('aria-label'), 'Steps');
    assert.deepEqual(
      all('.pretui-step').map((s) => s.dataset['state']),
      ['complete', 'current', 'upcoming'],
    );
    assert.deepEqual(
      all('.pretui-step').map((s) => s.getAttribute('aria-current')),
      [null, 'step', null],
    );
  });

  test('StepList gives every step a text state, not only a coloured marker', async function (assert) {
    await render(<template><StepList @steps={{STEPS}} @current={{1}} /></template>);
    assert.deepEqual(
      all('.pretui-step .pretui-vh').map((s) => s.textContent?.trim()),
      ['Completed', 'Current', 'Not completed'],
    );
    assert.deepEqual(
      all('.pretui-step-marker').map((m) => m.getAttribute('aria-hidden')),
      Array(3).fill('true'),
      'the marker is decoration; the state text carries it',
    );
  });

  test('StepList lets an explicit state win over the @current derivation', async function (assert) {
    const MIXED: StepItem[] = [
      { label: 'Draft', state: 'complete' },
      { label: 'Cupping', state: 'blocked', detail: 'Panel unavailable' },
      { label: 'Publish' },
    ];
    await render(<template><StepList @steps={{MIXED}} @current={{0}} /></template>);
    assert.deepEqual(
      all('.pretui-step').map((s) => s.dataset['state']),
      ['complete', 'blocked', 'upcoming'],
    );
  });

  test('StepList reserves the detail slot on every step as soon as one has a detail', async function (assert) {
    const MIXED: StepItem[] = [
      { label: 'Draft' },
      { label: 'Cupping', detail: 'Panel unavailable' },
    ];
    await render(<template><StepList @steps={{MIXED}} /></template>);
    assert.deepEqual(
      all('[data-test-pretui-step-detail]').map((d) => d.textContent?.trim()),
      ['', 'Panel unavailable'],
      'a line arriving late must not re-flow the rail',
    );

    await render(<template><StepList @steps={{STEPS}} /></template>);
    assert.strictEqual(all('[data-test-pretui-step-detail]').length, 0, 'and no slot when nothing has one');
  });

  test('StepList derives its summary from the states and wires it to the list', async function (assert) {
    await render(<template><StepList @steps={{STEPS}} @current={{2}} @summary={{true}} /></template>);
    let summary = q('[data-test-pretui-step-list-summary]');
    assert.strictEqual(summary.textContent?.trim(), '2 of 3 complete');
    assert.strictEqual(
      q('[data-test-pretui-step-list-items]').getAttribute('aria-describedby'),
      summary.id,
      'never a decorative count the caller has to keep in sync',
    );
  });

  test('StepList takes the summary wording from the caller and omits it by default', async function (assert) {
    const wording = (done: number, total: number) => `${total - done} left`;
    await render(
      <template><StepList @steps={{STEPS}} @current={{2}} @summary={{true}} @summaryFormat={{wording}} /></template>,
    );
    assert.strictEqual(q('[data-test-pretui-step-list-summary]').textContent?.trim(), '1 left');

    await render(<template><StepList @steps={{STEPS}} @current={{2}} /></template>);
    assert.notOk(q('[data-test-pretui-step-list-summary]'));
    assert.strictEqual(q('[data-test-pretui-step-list-items]').getAttribute('aria-describedby'), null);
  });

  test('StepList renders the most urgent stage as live text, not merely the running one', async function (assert) {
    const TROUBLE: StepItem[] = [
      { label: 'Draft', state: 'complete' },
      { label: 'Cupping', state: 'in-progress' },
      { label: 'Publish', state: 'blocked', detail: 'Waiting on the panel' },
    ];
    await render(<template><StepList @steps={{TROUBLE}} /></template>);
    assert.strictEqual(
      q('[data-test-pretui-step-list-live]').textContent?.trim(),
      'Publish: Blocked. Waiting on the panel',
      'a blocked stage outranks the one that merely happens to be running',
    );
    const WORSE: StepItem[] = [
      { label: 'Draft', state: 'complete' },
      { label: 'Cupping', state: 'blocked' },
      { label: 'Publish', state: 'error' },
    ];
    await render(<template><StepList @steps={{WORSE}} /></template>);
    assert.true(
      q('[data-test-pretui-step-list-live]').textContent?.trim().startsWith('Publish: Error'),
      'and an error outranks blocked',
    );
  });

  test('StepList keeps an empty live region while nothing is active, and can be silenced', async function (assert) {
    const DONE: StepItem[] = [{ label: 'Draft', state: 'complete' }];
    await render(<template><StepList @steps={{DONE}} /></template>);
    let live = q('[data-test-pretui-step-list-live]');
    assert.ok(live, 'the region exists before there is anything to say');
    assert.strictEqual(live.getAttribute('role'), 'status');
    assert.strictEqual(live.textContent?.trim(), '', 'and says nothing yet');

    await render(<template><StepList @steps={{STEPS}} @current={{1}} @announce={{false}} /></template>);
    assert.notOk(q('[data-test-pretui-step-list-live]'), 'silenced, there is no region at all');
  });

  test('StepList writes a stage change into the live region that was already there', async function (assert) {
    class State {
      @tracked steps: StepItem[] = [
        { label: 'Draft', state: 'complete' },
        { label: 'Publish', state: 'upcoming' },
      ];
    }
    let state = new State();
    await render(<template><StepList @steps={{state.steps}} /></template>);
    let before = q('[data-test-pretui-step-list-live]');
    assert.strictEqual(before.textContent?.trim(), '');

    state.steps = [
      { label: 'Draft', state: 'complete' },
      { label: 'Publish', state: 'blocked', detail: 'Waiting on the panel' },
    ];
    await settled();
    let after = q('[data-test-pretui-step-list-live]');
    assert.strictEqual(after, before, 'the same region, not one mounted with its content');
    assert.strictEqual(after.textContent?.trim(), 'Publish: Blocked. Waiting on the panel');
  });

  test('StepList track variant drops the connectors and grows a bar per stage', async function (assert) {
    await render(<template><StepList @steps={{STEPS}} @current={{1}} @variant='track' /></template>);
    assert.strictEqual(q('[data-test-pretui-step-list-items]').dataset['variant'], 'track');
    assert.strictEqual(all('.pretui-step-bar').length, 3);
    assert.strictEqual(
      all('.pretui-step-connector').length,
      0,
      'the bars already show progress — a connector would be a second, redundant channel',
    );
  });

  test('StepList steps variant connects every step but the last', async function (assert) {
    await render(<template><StepList @steps={{STEPS}} @current={{1}} /></template>);
    assert.strictEqual(all('.pretui-step-connector').length, 2);
    assert.strictEqual(all('.pretui-step-bar').length, 0);
  });
});
