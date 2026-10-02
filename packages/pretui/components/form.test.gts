// Pretui — Form unit tests: the commit gate, dirty tracking, and what the
// yielded Field / Summary / Section do differently when a Form owns them.
//
//
// Focus routing on a refused submit is asserted directly: document.activeElement
// lands on the first invalid control (focus does stick in this harness). The
// section's own forcedOpen path is asserted separately with
// @focusOnInvalid='none', because focus routing also reveals the section and
// would otherwise mask it.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, settled, triggerEvent } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Form } from './form';
import type { FormIssue } from '../internal/forms-core';

const TOTAL_ERR: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Total exceeds the budget.' };
const TOTAL_WARN: FormIssue = { targetPath: 'Total', severity: 'warning', message: 'Unusually high.' };
const ORPHAN: FormIssue = { targetPath: '"Approver Email"', severity: 'error', message: 'Add an approver.' };
const NONE: FormIssue[] = [];

function form(): HTMLFormElement {
  return document.querySelector('[data-test-pretui-form]') as HTMLFormElement;
}
function field(): HTMLElement {
  return document.querySelector('[data-test-pretui-form-field]') as HTMLElement;
}
function summary(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-error-summary]') as HTMLElement | null;
}
function errors(): number {
  return document.querySelectorAll('[data-test-pretui-field-error]').length;
}

module('Pretui | components/form', function (hooks) {
  setupCardTest(hooks);

  test('is a real <form> that owns validation messaging and is quiet at rest', async function (assert) {
    await render(<template><Form @label='Budget'>body</Form></template>);
    let el = form();
    assert.strictEqual(el.tagName, 'FORM');
    assert.strictEqual(el.getAttribute('novalidate'), 'novalidate', 'the browser must not pop its own bubbles over our fields');
    assert.strictEqual(el.getAttribute('aria-label'), 'Budget');
    assert.strictEqual(el.dataset['mode'], 'submit');
    assert.strictEqual(el.dataset['dirty'], undefined);
    assert.strictEqual(el.dataset['submitted'], undefined);
    assert.strictEqual(el.getAttribute('aria-busy'), null);
  });

  test('leaves native constraint validation on when asked, and names itself by an existing heading', async function (assert) {
    await render(
      <template>
        <h2 id='budget-h'>Budget</h2>
        <Form @validationBehavior='native' @labelledBy='budget-h'>body</Form>
      </template>,
    );
    assert.strictEqual(form().getAttribute('novalidate'), null);
    assert.strictEqual(form().getAttribute('aria-labelledby'), 'budget-h');
  });

  test('lets a clean submit through and marks the attempt', async function (assert) {
    let submits = 0;
    let refused = 0;
    const onSubmit = () => (submits += 1);
    const onInvalid = () => (refused += 1);
    await render(
      <template>
        <Form @issues={{NONE}} @onSubmit={{onSubmit}} @onInvalidSubmit={{onInvalid}}>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    await click('[data-test-go]');
    assert.strictEqual(submits, 1);
    assert.strictEqual(refused, 0);
    assert.strictEqual(form().dataset['submitted'], 'true');
  });

  test('refuses a submit with a blocking issue and hands the caller exactly what blocked', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_WARN, TOTAL_ERR];
    let submits = 0;
    let refusedWith: FormIssue[] | undefined;
    const onSubmit = () => (submits += 1);
    const onInvalid = (issues: FormIssue[]) => (refusedWith = issues);
    await render(
      <template>
        <Form @issues={{ISSUES}} @onSubmit={{onSubmit}} @onInvalidSubmit={{onInvalid}} as |f|>
          <f.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} /></:control></f.Field>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    await click('[data-test-go]');
    assert.strictEqual(submits, 0, 'the gate held');
    assert.deepEqual(refusedWith, [TOTAL_ERR], 'blocking issues only — the warning is advice');
    assert.strictEqual(form().dataset['submitted'], 'true');
  });

  test('a field holds its errors until the first refused submit, but never its advisories', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_WARN, TOTAL_ERR];
    await render(
      <template>
        <Form @issues={{ISSUES}} as |f|>
          <f.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} aria-invalid={{if c.invalid 'true'}} data-test-control /></:control></f.Field>
          <f.Summary />
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    assert.strictEqual(errors(), 1, 'the warning shows straight away');
    assert.strictEqual(field().dataset['invalid'], undefined, 'a fresh form is not a wall of red');
    assert.strictEqual(summary(), null, 'and no summary before anyone has tried');

    await click('[data-test-go]');
    assert.strictEqual(errors(), 2, 'now the error joins it');
    assert.strictEqual(field().dataset['invalid'], 'true');
    assert.ok(summary(), 'the summary appears once a commit was refused');
  });

  test('live mode never gates and never withholds', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_ERR];
    let submits = 0;
    const onSubmit = () => (submits += 1);
    await render(
      <template>
        <Form @mode='live' @issues={{ISSUES}} @onSubmit={{onSubmit}} as |f|>
          <f.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} /></:control></f.Field>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    assert.strictEqual(field().dataset['invalid'], 'true', 'issues are advice in live mode and show at once');
    await click('[data-test-go]');
    assert.strictEqual(submits, 1, 'refusing a commit would contradict per-field autosave');
  });

  test('a busy form blocks re-submission and says so', async function (assert) {
    let submits = 0;
    const onSubmit = () => (submits += 1);
    await render(
      <template>
        <Form @busy={{true}} @issues={{NONE}} @onSubmit={{onSubmit}}>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    assert.strictEqual(form().getAttribute('aria-busy'), 'true');
    assert.strictEqual(form().dataset['busy'], 'true');
    await click('[data-test-go]');
    assert.strictEqual(submits, 0);
  });

  test('tracks dirtiness off bubbled input events and resets to pristine', async function (assert) {
    let resets = 0;
    const onReset = () => (resets += 1);
    await render(
      <template>
        <Form @issues={{NONE}} @onReset={{onReset}} as |f|>
          <f.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} data-test-control /></:control></f.Field>
          <span data-test-flags>{{if f.dirty 'dirty' 'pristine'}}/{{if f.submitted 'submitted' 'fresh'}}</span>
          <button type='submit' data-test-go>Save</button>
          <button type='reset' data-test-reset>Reset</button>
        </Form>
      </template>,
    );
    assert.strictEqual(document.querySelector('[data-test-flags]')?.textContent, 'pristine/fresh');

    await fillIn('[data-test-control]', '12');
    assert.strictEqual(form().dataset['dirty'], 'true', 'no control had to call markDirty');
    await click('[data-test-go]');
    assert.strictEqual(document.querySelector('[data-test-flags]')?.textContent, 'dirty/submitted');

    await click('[data-test-reset]');
    assert.strictEqual(form().dataset['dirty'], undefined);
    assert.strictEqual(form().dataset['submitted'], undefined, 'reset also forgets the refused attempt');
    assert.strictEqual(document.querySelector('[data-test-flags]')?.textContent, 'pristine/fresh');
    assert.strictEqual(resets, 1);
  });

  test('exposes programmatic submit and reset through the yielded api', async function (assert) {
    let submits = 0;
    const onSubmit = () => (submits += 1);
    await render(
      <template>
        <Form @issues={{NONE}} @onSubmit={{onSubmit}} as |f|>
          <button type='button' data-test-go {{on 'click' f.submit}}>Save</button>
        </Form>
      </template>,
    );
    await click('[data-test-go]');
    assert.strictEqual(submits, 1);
    assert.strictEqual(form().dataset['submitted'], 'true');
  });

  test('the summary links routed issues to their field and badges the ones no field claimed', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_ERR, ORPHAN];
    await render(
      <template>
        <Form @issues={{ISSUES}} as |f|>
          <f.Summary />
          <f.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} /></:control></f.Field>
          <span data-test-unrouted>{{f.unroutedIssues.length}}</span>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    await click('[data-test-go]');
    await settled();
    let rows = Array.from(document.querySelectorAll('.pretui-error-summary-row')) as HTMLElement[];
    assert.strictEqual(rows.length, 2);
    assert.ok(rows[0]?.querySelector('button'), 'Total has a field — the row is a link to it');
    assert.strictEqual(rows[1]?.querySelector('button'), null, 'the approver issue has no field on this form');
    assert.strictEqual(
      rows[1]?.querySelector('.pretui-error-summary-badge')?.textContent?.trim(),
      'no field on this form',
      'NEVER dropped — an issue the user cannot see is the one they most need told about',
    );
    assert.strictEqual(document.querySelector('[data-test-unrouted]')?.textContent, '1');
  });

  test('a refused submit forces open a collapsed section holding a blocking issue', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_ERR];
    await render(
      <template>
        <Form @issues={{ISSUES}} as |f|>
          <f.Section @title='Money' @collapsible={{true}} @defaultOpen={{false}} as |S|>
            <S.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} /></:control></S.Field>
          </f.Section>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    await settled();
    let section = document.querySelector('[data-test-pretui-form-section]') as HTMLElement;
    assert.strictEqual(section.dataset['open'], 'false');
    assert.strictEqual(section.querySelector('.pretui-formsection-badge'), null, 'a pristine submit-mode form has no section shouting yet');

    await click('[data-test-go]');
    assert.strictEqual(section.dataset['open'], 'true', 'a blocking issue must never sit behind a shut disclosure');
    assert.strictEqual(section.querySelector('.pretui-formsection-badge')?.textContent?.trim(), '1 error');
    assert.strictEqual(document.activeElement, section.querySelector('input'), 'focus is routed to the invalid control inside the section');
  });

  test('the section forces itself open even when focus routing is off', async function (assert) {
    // With @focusOnInvalid='none' nothing calls reveal(), so only
    // FormSection.forcedOpen can open the section.
    const ISSUES: FormIssue[] = [TOTAL_ERR];
    await render(
      <template>
        <Form @issues={{ISSUES}} @focusOnInvalid='none' as |f|>
          <f.Section @title='Money' @collapsible={{true}} @defaultOpen={{false}} as |S|>
            <S.Field @label='Total' @path='Total'><:control as |c|><input id={{c.id}} /></:control></S.Field>
          </f.Section>
          <button type='submit' data-test-go>Save</button>
        </Form>
      </template>,
    );
    await settled();
    let section = document.querySelector('[data-test-pretui-form-section]') as HTMLElement;
    assert.strictEqual(section.dataset['open'], 'false');
    await click('[data-test-go]');
    assert.strictEqual(section.dataset['open'], 'true', 'forcedOpen, not focus routing, opened it');
    assert.notStrictEqual(document.activeElement, section.querySelector('input'), 'and focus was indeed left alone');
  });

  test('disables every field through the context and docks the footer only in record mode', async function (assert) {
    await render(
      <template>
        <Form @disabled={{true}}>
          <:default as |f|>
            <f.Field @label='Total'><:control as |c|><input id={{c.id}} disabled={{c.disabled}} data-test-control /></:control></f.Field>
          </:default>
          <:footer><button type='submit'>Save</button></:footer>
        </Form>
      </template>,
    );
    assert.true((document.querySelector('[data-test-control]') as HTMLInputElement).disabled);
    assert.strictEqual((document.querySelector('.pretui-form-footer') as HTMLElement).dataset['docked'], undefined);

    await render(
      <template>
        <Form @mode='record'>
          <:default>body</:default>
          <:footer><button type='submit'>Save</button></:footer>
        </Form>
      </template>,
    );
    assert.strictEqual((document.querySelector('.pretui-form-footer') as HTMLElement).dataset['docked'], 'true');
  });

  test('a native submit event on the form itself is the same gate', async function (assert) {
    const ISSUES: FormIssue[] = [TOTAL_ERR];
    let refused = 0;
    const onInvalid = () => (refused += 1);
    await render(<template><Form @issues={{ISSUES}} @onInvalidSubmit={{onInvalid}}>body</Form></template>);
    await triggerEvent(form(), 'submit');
    assert.strictEqual(refused, 1);
  });
});
