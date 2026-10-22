// Pretui — ErrorSummary unit tests, stand-alone (no Form). Its Form-driven
// behaviour (hidden until submit, unrouted badges, focus routing) is asserted
// in form.test.gts.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ErrorSummary } from './error-summary';
import type { FormIssue } from '../internal/forms-core';

const ERR: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Total exceeds the budget.' };
const ERR2: FormIssue = { targetPath: '"Approver Email"', severity: 'error', message: 'Add an approver.' };
const WARN: FormIssue = { targetPath: 'Total', severity: 'warning', message: 'Unusually high.' };

function summary(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-error-summary]') as HTMLElement | null;
}
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.pretui-error-summary-row')) as HTMLElement[];
}

module('Pretui | components/error-summary', function (hooks) {
  setupCardTest(hooks);

  test('renders nothing at all when there is nothing to fix', async function (assert) {
    const NONE: FormIssue[] = [];
    await render(<template><ErrorSummary @issues={{NONE}} /></template>);
    assert.strictEqual(summary(), null, 'no empty box with a zero count');
  });

  test('counts the blocking issues in its heading and lists each one', async function (assert) {
    const TWO: FormIssue[] = [ERR, ERR2];
    await render(<template><ErrorSummary @issues={{TWO}} /></template>);
    let heading = summary()?.querySelector('[role="heading"]') as HTMLElement;
    assert.strictEqual(heading.textContent?.trim(), 'There are 2 issues to fix');
    assert.strictEqual(heading.getAttribute('aria-level'), '3', 'a card does not know its host outline, so level is a knob');
    assert.deepEqual(rows().map((r) => r.textContent?.trim()), ['Total exceeds the budget.', 'Add an approver.']);
    assert.strictEqual(summary()?.getAttribute('tabindex'), '-1', 'focusable by script so a refused submit can land here');
  });

  test('uses the singular for one issue and honours a caller title and heading level', async function (assert) {
    const ONE: FormIssue[] = [ERR];
    await render(<template><ErrorSummary @issues={{ONE}} /></template>);
    assert.strictEqual(summary()?.querySelector('[role="heading"]')?.textContent?.trim(), 'There is 1 issue to fix');

    await render(<template><ErrorSummary @issues={{ONE}} @title='Before you submit' @headingLevel={{2}} /></template>);
    let heading = summary()?.querySelector('[role="heading"]') as HTMLElement;
    assert.strictEqual(heading.textContent?.trim(), 'Before you submit');
    assert.strictEqual(heading.getAttribute('aria-level'), '2');
  });

  test('leaves advisories out unless asked, and sorts errors first when they are in', async function (assert) {
    const MIXED: FormIssue[] = [WARN, ERR];
    await render(<template><ErrorSummary @issues={{MIXED}} /></template>);
    assert.deepEqual(rows().map((r) => r.dataset['severity']), ['error'], 'a summary is about what blocks');

    await render(<template><ErrorSummary @issues={{MIXED}} @showAdvisory={{true}} /></template>);
    assert.deepEqual(rows().map((r) => r.dataset['severity']), ['error', 'warning']);
    assert.strictEqual(summary()?.querySelector('[role="heading"]')?.textContent?.trim(), 'There are 2 issues to fix');
  });

  test('is not a live region by default and becomes one on request', async function (assert) {
    const ONE: FormIssue[] = [ERR];
    await render(<template><ErrorSummary @issues={{ONE}} /></template>);
    assert.strictEqual(summary()?.getAttribute('role'), null, 'it announces by taking focus; a live region would double-speak');

    await render(<template><ErrorSummary @issues={{ONE}} @announce={{true}} /></template>);
    assert.strictEqual(summary()?.getAttribute('role'), 'alert');
  });

  test('stand-alone rows are plain text — there is no form to route them into, and no badge claiming otherwise', async function (assert) {
    const ONE: FormIssue[] = [ERR];
    await render(<template><ErrorSummary @issues={{ONE}} /></template>);
    assert.strictEqual(rows()[0]?.querySelector('button'), null, 'no link with nowhere to go');
    assert.strictEqual(rows()[0]?.querySelector('.pretui-error-summary-badge'), null, '"no field on this form" needs a form');
  });

  test('renders an intro block under the heading', async function (assert) {
    const ONE: FormIssue[] = [ERR];
    await render(<template><ErrorSummary @issues={{ONE}}>Fix these to continue.</ErrorSummary></template>);
    assert.strictEqual(summary()?.querySelector('.pretui-error-summary-intro')?.textContent?.trim(), 'Fix these to continue.');
  });
});
