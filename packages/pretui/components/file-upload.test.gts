// Pretui — FileUpload unit tests: the rows, their status text, the named
// Retry and Remove, the summary line, and the limit on the drop target.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, settled, triggerEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { on } from '@ember/modifier';
import { FileUpload } from './file-upload';
import type { UploadFile } from './file-upload';

const FILES: UploadFile[] = [
  { id: 'a', name: 'lot-7-label.pdf', size: 204800, status: 'done' },
  { id: 'b', name: 'cupping-notes.docx', size: 51200, status: 'uploading', progress: 40 },
  { id: 'c', name: 'roast-curve.csv', size: 1024, status: 'error', error: 'The server refused the file.' },
];

class Files {
  @tracked files: UploadFile[] = FILES;
  retry = (f: UploadFile) => (this.files = this.files.map((x) => (x.id === f.id ? { ...x, status: 'uploading' as const, progress: 5, error: undefined } : x)));
  remove = (f: UploadFile) => (this.files = this.files.filter((x) => x.id !== f.id));
}

function row(id: string): HTMLElement {
  return document.querySelector(`[data-test-pretui-upload-row="${id}"]`) as HTMLElement;
}

module('Pretui | components/file-upload', function (hooks) {
  setupCardTest(hooks);

  test('each file is a row with its name, size and a status in words', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} @label='Lot documents' data-lot='7' /></template>);
    assert.strictEqual((document.querySelector('[data-test-pretui-file-upload]') as HTMLElement).getAttribute('data-lot'), '7');
    let list = document.querySelector('[data-test-pretui-file-upload-list]') as HTMLElement;
    assert.strictEqual(list.tagName, 'UL');
    assert.strictEqual(list.getAttribute('aria-label'), 'Lot documents');
    assert.ok(row('a').textContent?.includes('lot-7-label.pdf'));
    assert.strictEqual(row('a').querySelector('[data-test-pretui-upload-status]')?.textContent?.trim(), 'Uploaded');
    assert.strictEqual(row('b').querySelector('[data-test-pretui-upload-status]')?.textContent?.trim(), 'Uploading');
    assert.strictEqual(row('c').querySelector('[data-test-pretui-upload-status]')?.textContent?.trim(), 'Failed');
  });

  test('an uploading row has a labelled progress bar; a failed row says why', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} /></template>);
    assert.ok(row('b').querySelector('[data-test-pretui-progress-bar], [role="progressbar"], progress'), 'a progress bar while uploading');
    assert.ok(row('b').textContent?.includes('cupping-notes.docx upload progress'), 'named for its file');
    assert.notOk(row('a').querySelector('[role="progressbar"], progress'), 'none once done');
    assert.strictEqual(row('c').querySelector('[data-test-pretui-upload-error]')?.textContent?.trim(), 'The server refused the file.');
  });

  test('Retry shows on failed rows only, and Retry and Remove are named for their file', async function (assert) {
    let retried: string[] = [];
    let removed: string[] = [];
    let retry = (f: UploadFile) => retried.push(f.id);
    let remove = (f: UploadFile) => removed.push(f.id);
    await render(<template><FileUpload @files={{FILES}} @onRetry={{retry}} @onRemove={{remove}} /></template>);
    assert.notOk(document.querySelector('[data-test-pretui-upload-retry="a"]'));
    let retryBtn = document.querySelector('[data-test-pretui-upload-retry="c"]') as HTMLButtonElement;
    assert.strictEqual(retryBtn.getAttribute('aria-label'), 'Retry roast-curve.csv');
    await click(retryBtn);
    assert.deepEqual(retried, ['c']);
    let removeBtn = document.querySelector('[data-test-pretui-upload-remove="a"]') as HTMLButtonElement;
    assert.strictEqual(removeBtn.getAttribute('aria-label'), 'Remove lot-7-label.pdf');
    await click(removeBtn);
    assert.deepEqual(removed, ['a']);
  });

  test('no handlers, no buttons', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} /></template>);
    assert.notOk(document.querySelector('[data-test-pretui-upload-retry], [data-test-pretui-upload-remove]'));
  });

  test('Retry keeps focus on its row when the button goes away', async function (assert) {
    let state = new Files();
    await render(<template><FileUpload @files={{state.files}} @onRetry={{state.retry}} @onRemove={{state.remove}} /></template>);
    let retryBtn = document.querySelector('[data-test-pretui-upload-retry="c"]') as HTMLButtonElement;
    retryBtn.focus();
    await click(retryBtn);
    await settled();
    assert.notOk(document.querySelector('[data-test-pretui-upload-retry="c"]'), 'the button is gone');
    assert.strictEqual(document.activeElement, row('c'), 'focus is on the row, not the page');
  });

  test('Remove moves focus to the next row’s Remove', async function (assert) {
    let state = new Files();
    await render(<template><FileUpload @files={{state.files}} @onRemove={{state.remove}} /></template>);
    let removeA = document.querySelector('[data-test-pretui-upload-remove="a"]') as HTMLButtonElement;
    removeA.focus();
    await click(removeA);
    await settled();
    assert.strictEqual(document.activeElement, document.querySelector('[data-test-pretui-upload-remove="b"]'));
  });

  test('the trigger block is handed add and the room left', async function (assert) {
    let added: string[][] = [];
    let onAdd = (files: File[]) => added.push(files.map((f) => f.name));
    let one: UploadFile[] = [{ id: 'a', name: 'a.pdf', status: 'done' }];
    let pick = (api: { add: (files: File[]) => void }) => () => api.add([new File(['x'], 'b.pdf'), new File(['y'], 'c.pdf')]);
    await render(<template>
      <FileUpload @files={{one}} @max={{2}} @onAdd={{onAdd}}>
        <:trigger as |api|>
          <span class='t-room'>{{api.remaining}}</span>
          <button type='button' class='t-pick' {{on 'click' (pick api)}}>Attach</button>
        </:trigger>
      </FileUpload>
    </template>);
    assert.strictEqual(document.querySelector('.t-room')?.textContent?.trim(), '1');
    await click('.t-pick');
    assert.deepEqual(added, [['b.pdf']], 'add cuts to the room left');
  });

  test('the summary says when the limit is reached', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} @max={{3}} /></template>);
    assert.strictEqual(document.querySelector('[data-test-pretui-file-upload-summary]')?.textContent?.trim(), '1 of 3 uploaded, 1 failed, limit reached');
  });

  test('one polite line sums up the list', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} /></template>);
    let summary = document.querySelector('[data-test-pretui-file-upload-summary]') as HTMLElement;
    assert.strictEqual(summary.getAttribute('role'), 'status');
    assert.strictEqual(summary.textContent?.trim(), '1 of 3 uploaded, 1 failed');
  });

  test('picked files go to @onAdd, cut to the room left under @max', async function (assert) {
    let added: string[][] = [];
    let onAdd = (files: File[]) => added.push(files.map((f) => f.name));
    let one: UploadFile[] = [{ id: 'a', name: 'a.pdf', status: 'done' }];
    await render(<template><FileUpload @files={{one}} @max={{2}} @onAdd={{onAdd}} /></template>);
    let input = document.querySelector('[data-test-pretui-file-upload] input[type="file"]') as HTMLInputElement;
    await triggerEvent(input, 'change', { files: [new File(['x'], 'b.pdf'), new File(['y'], 'c.pdf')] });
    assert.deepEqual(added, [['b.pdf']], 'only one more fits');
  });

  test('at @max the drop target goes away', async function (assert) {
    await render(<template><FileUpload @files={{FILES}} @max={{3}} /></template>);
    assert.notOk(document.querySelector('[data-test-pretui-dropzone]'));
  });

  test('the trigger block replaces the drop target', async function (assert) {
    let none: UploadFile[] = [];
    await render(<template>
      <FileUpload @files={{none}}>
        <:trigger><button type='button' class='t-pick'>Attach</button></:trigger>
      </FileUpload>
    </template>);
    assert.ok(document.querySelector('.t-pick'));
    assert.notOk(document.querySelector('[data-test-pretui-dropzone]'));
    assert.notOk(document.querySelector('[data-test-pretui-file-upload-list]'), 'no empty list');
  });
});
