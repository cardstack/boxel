// Pretui — FieldError unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FieldError } from './field-error';
import type { FormIssue } from '../internal/forms-core';

const ERR: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Total exceeds the budget.', ruleId: 'R-12' };
const WARN: FormIssue = { targetPath: 'Total', severity: 'warning', message: 'Unusually high.' };
const INFO: FormIssue = { targetPath: 'Total', severity: 'info', message: 'Rounded to the nearest unit.' };
const ODD: FormIssue = { targetPath: 'Total', severity: 'CRITICAL', message: 'Unknown severity.' };

function el(): HTMLElement {
  return document.querySelector('[data-test-pretui-field-error]') as HTMLElement;
}
function all(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-field-error]')) as HTMLElement[];
}

module('Pretui | components/field-error', function (hooks) {
  setupCardTest(hooks);

  test('prints the rule-authored message verbatim behind a decorative glyph', async function (assert) {
    await render(<template><FieldError @issue={{ERR}} /></template>);
    assert.strictEqual(el().querySelector('.pretui-field-error-msg')?.textContent?.trim(), 'Total exceeds the budget.');
    assert.strictEqual(
      el().querySelector('.pretui-field-error-glyph')?.getAttribute('aria-hidden'),
      'true',
      'the glyph is colour-plus-shape; the text carries the meaning',
    );
    assert.strictEqual(el().dataset['severity'], 'error');
  });

  test('renders each severity, and fails closed on one it does not recognise', async function (assert) {
    await render(
      <template>
        <FieldError @issue={{ERR}} />
        <FieldError @issue={{WARN}} />
        <FieldError @issue={{INFO}} />
        <FieldError @issue={{ODD}} />
      </template>,
    );
    assert.deepEqual(
      all().map((e) => e.dataset['severity']),
      ['error', 'warning', 'info', 'error'],
      '"CRITICAL" is not a Pretui severity — an unknown one blocks rather than being waved through',
    );
  });

  test('is silent by default and a live alert only when asked', async function (assert) {
    await render(<template><FieldError @issue={{ERR}} /></template>);
    assert.strictEqual(el().getAttribute('role'), null, 'a per-keystroke revalidation must not narrate');

    await render(<template><FieldError @issue={{ERR}} @announce={{true}} /></template>);
    assert.strictEqual(el().getAttribute('role'), 'alert');
  });

  test('shows the rule id as a Token only on request', async function (assert) {
    await render(<template><FieldError @issue={{ERR}} /></template>);
    assert.notOk(el().querySelector('[data-test-pretui-token]'));

    await render(<template><FieldError @issue={{ERR}} @showRuleId={{true}} /></template>);
    assert.strictEqual(el().querySelector('[data-test-pretui-token]')?.textContent?.trim(), 'R-12', 'provenance for rule authors');
  });

  test('asks for the rule id but renders nothing when the issue has none', async function (assert) {
    await render(<template><FieldError @issue={{WARN}} @showRuleId={{true}} /></template>);
    assert.notOk(el().querySelector('[data-test-pretui-token]'), 'no empty token');
  });
});
