// Pretui — FormFooter unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FormFooter } from './form-footer';
import type { FormIssue } from '../internal/forms-core';

const ERR: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Over budget.' };
const WARN: FormIssue = { targetPath: 'Total', severity: 'warning', message: 'High.' };

function footer(): HTMLElement {
  return document.querySelector('[data-test-pretui-form-footer]') as HTMLElement;
}
function status(): HTMLElement {
  return document.querySelector('[data-test-pretui-form-footer-status]') as HTMLElement;
}
function save(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-form-footer-save]') as HTMLButtonElement;
}
function cancel(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-form-footer-cancel]') as HTMLButtonElement;
}

module('Pretui | components/form-footer', function (hooks) {
  setupCardTest(hooks);

  test('at rest it reports no changes, disables Save, and docks', async function (assert) {
    await render(<template><FormFooter /></template>);
    assert.strictEqual(status().textContent?.trim(), 'No unsaved changes');
    assert.strictEqual(status().getAttribute('role'), 'status');
    assert.strictEqual(status().getAttribute('aria-live'), 'polite', 'the count changes as the user edits; it is narrated, not shouted');
    assert.true(save().disabled, 'nothing to save');
    assert.false(cancel().disabled);
    assert.strictEqual(footer().dataset['state'], 'clean');
    assert.strictEqual(footer().dataset['dock'], 'sticky');
    assert.strictEqual(save().getAttribute('aria-describedby'), status().id, 'Save is described by the reason it is or is not available');
  });

  test('counts unsaved changes with the right plural and enables Save', async function (assert) {
    await render(<template><FormFooter @count={{1}} /></template>);
    assert.strictEqual(status().textContent?.trim(), '1 unsaved change');
    assert.false(save().disabled);
    assert.strictEqual(footer().dataset['state'], 'dirty');

    await render(<template><FormFooter @count={{3}} /></template>);
    assert.strictEqual(status().textContent?.trim(), '3 unsaved changes');
  });

  test('blocking issues lock Save and take over the status line; advisories do not', async function (assert) {
    const BLOCK: FormIssue[] = [ERR, WARN];
    await render(<template><FormFooter @count={{2}} @issues={{BLOCK}} /></template>);
    assert.true(status().textContent?.includes('1 error to resolve before saving'), 'the warning is not counted');
    assert.true(save().disabled);
    assert.strictEqual(footer().dataset['state'], 'error');

    const ADVICE: FormIssue[] = [WARN];
    await render(<template><FormFooter @count={{2}} @issues={{ADVICE}} /></template>);
    assert.strictEqual(status().textContent?.trim(), '2 unsaved changes');
    assert.false(save().disabled);
  });

  test('saving locks both actions and marks Save busy', async function (assert) {
    await render(<template><FormFooter @count={{2}} @saving={{true}} /></template>);
    assert.true(save().disabled);
    assert.true(cancel().disabled, 'discarding a batch mid-save would race the write');
    assert.strictEqual(save().getAttribute('aria-busy'), 'true');
  });

  test('a hard @disabled wins over a dirty count', async function (assert) {
    await render(<template><FormFooter @count={{2}} @disabled={{true}} /></template>);
    assert.true(save().disabled, 'a permission gate, say');
  });

  test('fires save and cancel, with caller labels', async function (assert) {
    let saves = 0;
    let cancels = 0;
    const onSave = () => (saves += 1);
    const onCancel = () => (cancels += 1);
    await render(
      <template><FormFooter @count={{1}} @saveLabel='Commit' @cancelLabel='Discard' @onSave={{onSave}} @onCancel={{onCancel}} /></template>,
    );
    assert.strictEqual(save().textContent?.trim(), 'Commit');
    assert.strictEqual(cancel().textContent?.trim(), 'Discard');
    await click(save());
    await click(cancel());
    assert.deepEqual([saves, cancels], [1, 1]);
  });

  test('a status block replaces the sentence and extra actions sit before Cancel', async function (assert) {
    await render(
      <template>
        <FormFooter @count={{1}} @dock='static'>
          <:status><span data-test-custom>Two rows changed</span></:status>
          <:actions><button type='button' data-test-extra>Save & New</button></:actions>
        </FormFooter>
      </template>,
    );
    assert.ok(status().querySelector('[data-test-custom]'));
    assert.notOk(status().textContent?.includes('unsaved'));
    let actions = Array.from(footer().querySelectorAll('.pretui-formfooter-actions button'));
    assert.ok(actions[0]?.hasAttribute('data-test-extra'), 'before Cancel and Save');
    assert.strictEqual(footer().dataset['dock'], 'static');
  });
});
