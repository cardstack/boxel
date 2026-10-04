// Pretui — RecordDetail unit tests: the per-field inline editor and the
// batched save that RecordDetail runs for every Field it yields.
//
// Focus travel is asserted where it lands on a real element: after
// Enter-to-commit, document.activeElement is back on the trigger. Opening the
// editor is the one path that lands on <body> in this harness, so open→control
// is asserted through the editor's state rather than activeElement.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, blur, triggerKeyEvent } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { RecordDetail } from './record-detail';
import type { FormIssue } from '../internal/forms-core';

const NAME_ERR: FormIssue = { targetPath: 'Account Name', severity: 'error', message: 'Name is taken.' };
const OWNER_WARN: FormIssue = { targetPath: 'Owner', severity: 'warning', message: 'Owner is on leave.' };

/** Binds a plain <input>'s keystrokes to the editor context's setter. */
const setFrom = (set: (v: unknown) => void) => (ev: Event) => set((ev.target as HTMLInputElement).value);

function fieldEl(path: string): HTMLElement {
  return document.querySelector(`[data-test-pretui-record-field="${path}"]`) as HTMLElement;
}
function trigger(path: string): HTMLButtonElement | null {
  return fieldEl(path).querySelector('[data-test-pretui-record-trigger]') as HTMLButtonElement | null;
}
function editorInput(): HTMLInputElement {
  return document.querySelector('[data-test-pretui-record-editor] input') as HTMLInputElement;
}
function undoBtn(path: string): HTMLButtonElement | null {
  return fieldEl(path).querySelector('[data-test-pretui-record-undo]') as HTMLButtonElement | null;
}
function footerStatus(): string | undefined {
  return document.querySelector('[data-test-pretui-form-footer-status]')?.textContent?.trim();
}
function saveBtn(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-form-footer-save]') as HTMLButtonElement;
}

module('Pretui | components/record-detail', function (hooks) {
  setupCardTest(hooks);

  test('renders each field static, with the value as a one-tab-stop button that names itself by label and value', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins' @required={{true}}>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    let root = document.querySelector('[data-test-pretui-record-detail]') as HTMLElement;
    assert.strictEqual(root.dataset['layout'], 'stacked');
    assert.strictEqual(root.dataset['cols'], '2');
    let t = trigger('Account Name') as HTMLButtonElement;
    assert.ok(t, 'the static value IS the button — not a value plus a separate pencil');
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'rest');
    let named = (t.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent?.trim());
    assert.true(named[0]?.startsWith('Account Name'), 'the screen reader hears the field name…');
    assert.strictEqual(named[1], 'Wuyi Origins', '…and its current value');
    assert.true(fieldEl('Account Name').textContent?.includes('(required)'), 'required is spoken, not only an asterisk');
    assert.true(
      document.getElementById((t.getAttribute('aria-describedby') ?? '').split(' ')[0] as string)?.textContent?.includes('Press Enter to edit'),
      'the hint tells the reader how to open it',
    );
  });

  test('opens the editor in place, commits on Enter, and marks the field edited with an undo', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'editing');
    assert.strictEqual(editorInput().value, 'Wuyi Origins', 'the editor opens on the saved value');
    assert.true(
      (document.querySelector(`label[for="${editorInput().id}"]`)?.textContent ?? '').trim().startsWith('Account Name'),
      'in edit mode the label becomes a real <label for>',
    );

    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    assert.strictEqual(footerStatus(), 'No unsaved changes', 'a keystroke never touches the batch');

    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'edited');
    assert.strictEqual(trigger('Account Name')?.textContent?.trim(), 'Wuyi Origins Ltd', 'the static row shows the pending edit');
    assert.ok(undoBtn('Account Name'), 'with a way back');
    assert.strictEqual(undoBtn('Account Name')?.getAttribute('aria-label'), 'Undo edit to Account Name');
    assert.strictEqual(footerStatus(), '1 unsaved change');
    assert.false(saveBtn().disabled);
  });

  test('Escape discards only the in-flight keystrokes', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'typo');
    await triggerKeyEvent(editorInput(), 'keydown', 'Escape');
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'rest', 'SLDS ships no cancel path at all; this one exists');
    assert.strictEqual(trigger('Account Name')?.textContent?.trim(), 'Wuyi Origins');
    assert.strictEqual(footerStatus(), 'No unsaved changes');
  });

  test('Escape after a committed edit keeps that edit — cancelling an edit is not cancelling the batch', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'garbage');
    await triggerKeyEvent(editorInput(), 'keydown', 'Escape');
    assert.strictEqual(trigger('Account Name')?.textContent?.trim(), 'Wuyi Origins Ltd', 'the committed draft survives');
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'edited');
  });

  test('the pointer discard control cancels too, and focus leaving the editor commits', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'typo');
    let discard = document.querySelector('[data-test-pretui-record-discard]') as HTMLButtonElement;
    assert.strictEqual(discard.getAttribute('aria-label'), 'Discard edit to Account Name', 'keyboard users get Escape; pointer users get this');
    await click(discard);
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'rest');

    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    await blur(editorInput());
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'edited', 'the Lightning behaviour: leaving commits');
  });

  test('undo reverts one field to its saved value and leaves the rest of the batch alone', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
          <R.Field @path='Owner' @label='Owner' @value='Mei'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    await click(trigger('Owner') as HTMLElement);
    await fillIn(editorInput(), 'Ada');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    assert.strictEqual(footerStatus(), '2 unsaved changes');

    await click(undoBtn('Account Name') as HTMLElement);
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'rest');
    assert.strictEqual(trigger('Account Name')?.textContent?.trim(), 'Wuyi Origins');
    assert.strictEqual(fieldEl('Owner').dataset['state'], 'edited', 'Owner keeps its edit');
    assert.strictEqual(footerStatus(), '1 unsaved change');
  });

  test('Save hands the host the batch as path → value and clears the draft optimistically', async function (assert) {
    let saved: Record<string, unknown> | undefined;
    const onSave = (changes: Record<string, unknown>) => (saved = changes);
    await render(
      <template>
        <RecordDetail @onSave={{onSave}} as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
          <R.Field @path='Owner' @label='Owner' @value='Mei'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    assert.strictEqual(document.activeElement, trigger('Account Name'), 'Enter commits and returns focus to the trigger');
    await click(trigger('Owner') as HTMLElement);
    await fillIn(editorInput(), 'Ada');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    await click(saveBtn());
    assert.deepEqual(
      saved,
      { 'Account Name': 'Wuyi Origins Ltd', Owner: 'Ada' },
      'both committed edits, keyed by BXL path — a batch, not the last write',
    );
    assert.strictEqual(footerStatus(), 'No unsaved changes');
    assert.strictEqual(fieldEl('Account Name').dataset['state'], 'rest', 'the host will hand back new @values');
  });

  test('Cancel discards the whole batch, including the editor that is open', async function (assert) {
    let cancels = 0;
    const onCancel = () => (cancels += 1);
    await render(
      <template>
        <RecordDetail @onCancel={{onCancel}} as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
          <R.Field @path='Owner' @label='Owner' @value='Mei'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'Wuyi Origins Ltd');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    await click(trigger('Owner') as HTMLElement);
    await fillIn(editorInput(), 'Ada');
    await click('[data-test-pretui-form-footer-cancel]');
    assert.strictEqual(cancels, 1);
    assert.strictEqual(trigger('Account Name')?.textContent?.trim(), 'Wuyi Origins');
    assert.strictEqual(trigger('Owner')?.textContent?.trim(), 'Mei');
    assert.strictEqual(footerStatus(), 'No unsaved changes');
  });

  test('routes issues to fields by whole-string path, dresses them, and summarises above the grid', async function (assert) {
    const ISSUES: FormIssue[] = [OWNER_WARN, NAME_ERR];
    await render(
      <template>
        <RecordDetail @issues={{ISSUES}} as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
          <R.Field @path='Owner' @label='Owner' @value='Mei' />
        </RecordDetail>
      </template>,
    );
    assert.strictEqual(fieldEl('Account Name').dataset['invalid'], 'true');
    assert.strictEqual(fieldEl('Owner').dataset['invalid'], undefined, 'a warning does not invalidate');
    assert.true(fieldEl('Account Name').querySelector('[data-test-pretui-record-issues]')?.textContent?.includes('Name is taken.'));
    assert.true(fieldEl('Owner').querySelector('[data-test-pretui-record-issues]')?.textContent?.includes('Owner is on leave.'));
    let summary = document.querySelector('[data-test-pretui-record-summary]') as HTMLElement;
    assert.true(summary.textContent?.includes('2 issues on this record'));
    assert.strictEqual(summary.getAttribute('role'), 'alert', 'the worst issue sets the tone — Alert reflects danger as role=alert');
    assert.true(saveBtn().disabled, 'a blocking issue locks the footer too');
  });

  test('without an editor block, or read-only, a field is honestly static — no button, no pencil', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Created' @label='Created' @value='2026-03-14' />
          <R.Field @path='Owner' @label='Owner' @value='Mei' @readOnly={{true}}>
            <:editor as |E|><input id={{E.controlId}} /></:editor>
          </R.Field>
        </RecordDetail>
      </template>,
    );
    assert.strictEqual(trigger('Created'), null);
    assert.strictEqual(trigger('Owner'), null);
    assert.true(fieldEl('Owner').textContent?.includes('Read only.'), 'and the read-only hint says so');
  });

  test('a field with no editor block is announced as read only', async function (assert) {
    await render(
      <template>
        <RecordDetail as |R|>
          <R.Field @path='Created' @label='Created' @value='2026-03-14' />
        </RecordDetail>
      </template>,
    );
    assert.strictEqual(trigger('Created'), null, 'nothing to press Enter on');
    assert.strictEqual(fieldEl('Created').querySelector('.pretui-rd-sr')?.textContent, 'Read only.', 'and the hint does not promise one');
  });

  test('renders booleans, lists and empties as readable text, and the record layout/column knobs clamp', async function (assert) {
    const TAGS = ['spring', 'wuyi'];
    await render(
      <template>
        <RecordDetail @layout='horizontal' @columns={{9}} @placeholder='none' as |R|>
          <R.Field @path='Active' @label='Active' @value={{true}} />
          <R.Field @path='Tags' @label='Tags' @value={{TAGS}} />
          <R.Field @path='Notes' @label='Notes' />
        </RecordDetail>
      </template>,
    );
    let root = document.querySelector('[data-test-pretui-record-detail]') as HTMLElement;
    assert.strictEqual(root.dataset['layout'], 'horizontal');
    assert.strictEqual(root.dataset['cols'], '4', 'clamped to the four the CSS knows');
    assert.strictEqual(fieldEl('Active').querySelector('.pretui-rd-value')?.textContent?.trim(), 'Yes');
    assert.strictEqual(fieldEl('Tags').querySelector('.pretui-rd-value')?.textContent?.trim(), 'spring, wuyi');
    assert.strictEqual(fieldEl('Notes').querySelector('.pretui-rd-value')?.textContent?.trim(), 'none');
    assert.strictEqual((fieldEl('Notes').querySelector('.pretui-rd-static') as HTMLElement).dataset['empty'], 'true');
  });

  test('exposes the batch state to the block and can hide its own footer', async function (assert) {
    await render(
      <template>
        <RecordDetail @hideFooter={{true}} as |R|>
          <R.Field @path='Account Name' @label='Account Name' @value='Wuyi Origins'>
            <:editor as |E|><input id={{E.controlId}} value={{E.value}} {{on 'input' (setFrom E.set)}} /></:editor>
          </R.Field>
          <span data-test-dirty>{{R.state.dirtyCount}}</span>
        </RecordDetail>
      </template>,
    );
    assert.strictEqual(document.querySelector('[data-test-pretui-form-footer]'), null);
    await click(trigger('Account Name') as HTMLElement);
    await fillIn(editorInput(), 'x');
    await triggerKeyEvent(editorInput(), 'keydown', 'Enter');
    assert.strictEqual(document.querySelector('[data-test-dirty]')?.textContent, '1', 'a caller can build its own footer off the state');
  });
});
