// Pretui — proof for the file-intake foundation (Dropzone, FileTrigger).
//
// Two halves:
//
//  1. **The screening rules**, asserted without a DOM. `screenFiles` is the
//     one place in the kit that decides whether a file may be taken, and the
//     interesting cases — an extension with no MIME type, the ORDER the
//     rules run in, the count cap not being consumed by files that were
//     going to be refused anyway — are all pure arithmetic over records.
//  2. **Render proof** for the accessibility floor, which is the part a
//     clean index says nothing about: that a real `<input type=file>` exists
//     behind the drop target, that a keyboard-reachable button sits inside
//     it, and that acceptances and refusals reach a live region with a
//     reason attached.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Dropzone } from './components/dropzone';
import { FileTrigger } from './components/file-trigger';
import { matchesAccept, screenFiles, screeningMessage } from './internal/file-intake';
import type { ScreenableFile } from './internal/file-intake';

function fixture(name: string, type: string, size: number): ScreenableFile {
  return { name, type, size };
}

const PNG = fixture('lot-b1181.png', 'image/png', 120000);
const JPEG = fixture('wuyishan.jpeg', 'image/jpeg', 90000);
const PDF = fixture('invoice.pdf', 'application/pdf', 40000);
const HUGE = fixture('scan.png', 'image/png', 9000000);
// The case a MIME-only matcher gets wrong: browsers report an empty type for
// plenty of real files, and the reader can plainly see what it is.
const MARKDOWN = fixture('notes.md', '', 3000);

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

module('Pretui | controls-files | accept matching', function () {
  test('an empty list accepts everything, exactly as a bare input does', function (assert) {
    assert.true(matchesAccept(PDF, undefined), 'no list');
    assert.true(matchesAccept(PDF, ''), 'empty list');
    assert.true(matchesAccept(PDF, '   '), 'whitespace list');
  });

  test('the three spec token forms, and nothing else', function (assert) {
    assert.true(matchesAccept(PNG, 'image/*'), 'group wildcard');
    assert.false(matchesAccept(PDF, 'image/*'), 'group wildcard excludes');
    assert.true(matchesAccept(PNG, 'image/png'), 'exact mime');
    assert.false(matchesAccept(JPEG, 'image/png'), 'exact mime excludes');
    assert.true(matchesAccept(MARKDOWN, '.md'), 'extension token');
    assert.false(matchesAccept(MARKDOWN, '.txt'), 'extension token excludes');
  });

  test('a file with no MIME type is still matched by its extension', function (assert) {
    assert.false(
      matchesAccept(MARKDOWN, 'text/markdown'),
      'the browser gave us no type, so a MIME rule cannot match',
    );
    assert.true(
      matchesAccept(MARKDOWN, 'text/markdown, .md'),
      'and the extension token is what rescues it',
    );
  });

  test('an empty type never satisfies a wildcard by accident', function (assert) {
    assert.false(
      matchesAccept(MARKDOWN, 'image/*'),
      'an empty string must not be treated as prefix-matching everything',
    );
  });

  test('tokens are trimmed and case-insensitive', function (assert) {
    assert.true(matchesAccept(PNG, '  IMAGE/PNG  '), 'case and padding');
    assert.true(
      matchesAccept(fixture('A.MD', '', 10), '.md'),
      'the extension is lowercased on both sides',
    );
  });
});

module('Pretui | controls-files | screening', function () {
  test('with no rules, everything is accepted', function (assert) {
    let out = screenFiles([PNG, PDF, HUGE]);
    assert.strictEqual(out.accepted.length, 3);
    assert.strictEqual(out.rejected.length, 0);
  });

  test('type, then size — the reason is the first thing actually wrong', function (assert) {
    let out = screenFiles([PDF], { accept: 'image/*', maxSize: 10 });
    assert.strictEqual(out.rejected.length, 1);
    assert.strictEqual(
      out.rejected[0]?.reason,
      'type',
      'a PDF that is also too big is refused for being a PDF',
    );
  });

  test('the size message names the limit, not just the fact', function (assert) {
    let out = screenFiles([HUGE], { maxSize: 2097152 });
    assert.strictEqual(out.rejected[0]?.reason, 'size');
    assert.true(
      (out.rejected[0]?.detail ?? '').indexOf('2.0 MB') !== -1,
      'the limit is stated in units a reader can act on: ' + out.rejected[0]?.detail,
    );
  });

  test('the count cap is not consumed by files that were refused anyway', function (assert) {
    let out = screenFiles([PDF, PDF, PNG, JPEG], {
      accept: 'image/*',
      maxFiles: 2,
    });
    assert.deepEqual(
      out.accepted.map((f) => f.name),
      [PNG.name, JPEG.name],
      'two PDFs did not eat the two available slots',
    );
    assert.strictEqual(out.rejected.length, 2, 'both PDFs refused, nothing else');
  });

  test('multiple:false caps the batch at one whatever maxFiles says', function (assert) {
    let out = screenFiles([PNG, JPEG], { multiple: false, maxFiles: 5 });
    assert.strictEqual(out.accepted.length, 1);
    assert.strictEqual(out.rejected[0]?.reason, 'count');
    assert.strictEqual(out.rejected[0]?.detail, 'only one file at a time');
  });

  test('the input array is never mutated', function (assert) {
    let batch = [PNG, PDF];
    screenFiles(batch, { accept: 'image/*' });
    assert.deepEqual(batch, [PNG, PDF], 'screening is a pure read');
  });
});

module('Pretui | controls-files | announcement copy', function () {
  test('acceptances and refusals both reach the sentence, with reasons', function (assert) {
    let out = screenFiles([PNG, PDF], { accept: 'image/*' });
    let said = screeningMessage(out);
    assert.true(said.indexOf('1 file added') !== -1, 'singular is not "1 files"');
    assert.true(said.indexOf(PNG.name) !== -1, 'the accepted file is named');
    assert.true(said.indexOf(PDF.name) !== -1, 'the refused file is named too');
    assert.true(
      said.indexOf('wrong file type') !== -1,
      'and the reason travels with it — a silently vanishing file is the worst failure a drop target has',
    );
  });

  test('a batch where nothing survived still says something', function (assert) {
    assert.strictEqual(
      screeningMessage({ accepted: [], rejected: [] }),
      'No files were added.',
      'silence is not an acceptable response to a drop',
    );
  });

  test('plurals', function (assert) {
    let said = screeningMessage({ accepted: [PNG, JPEG], rejected: [] });
    assert.true(said.indexOf('2 files added') !== -1);
  });
});

module('Pretui | controls-files | render', function (hooks) {
  setupCardTest(hooks);
  // A hang here would take the whole suite down with it (QUnit never reaches
  // runEnd), which hides everyone else's failures. A per-test deadline turns
  // any hang into an ordinary failure.
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('FileTrigger renders a REAL file input behind its button', async function (assert) {
    await render(
      <template><FileTrigger @label='Choose lots' @accept='image/*' @multiple={{true}} /></template>,
    );
    let input = root().querySelector('input[type="file"]') as HTMLInputElement;
    assert.ok(input, 'the input exists rather than being implied');
    assert.strictEqual(
      input.getAttribute('aria-label'),
      'Choose lots',
      'and it carries an accessible name',
    );
    assert.strictEqual(input.accept, 'image/*', 'accept reaches the input');
    assert.true(
      input.multiple,
      'multiple is bound as true — Glimmer assigns dynamic attributes through the PROPERTY, so an empty string here would silently do nothing',
    );
    let button = root().querySelector('button') as HTMLButtonElement;
    assert.ok(button, 'a keyboard-reachable trigger sits beside it');
    assert.strictEqual(button.tabIndex, 0, 'and it is in the tab order');
    assert.strictEqual(input.tabIndex, -1, 'while the input itself is not');
  });

  test('FileTrigger yields an open function so the button is a slot, not a string', async function (assert) {
    await render(
      <template>
        <FileTrigger @label='Pick' as |api|>
          <button type='button' data-custom {{! template-lint-disable no-invalid-interactive }}>{{if api.disabled 'off' 'on'}}</button>
        </FileTrigger>
      </template>,
    );
    assert.ok(root().querySelector('[data-custom]'), 'the caller block replaced the button');
    assert.strictEqual(
      root().querySelectorAll('button').length,
      1,
      'and the default button is gone rather than doubled',
    );
  });

  test('Dropzone contains its own browse button — drag is never the only path', async function (assert) {
    await render(
      <template><Dropzone @label='Drop lots' @hint='PNG only' @accept='image/png' /></template>,
    );
    let zone = root().querySelector('[data-test-pretui-dropzone]') as HTMLElement;
    assert.ok(zone, 'the zone rendered');
    assert.ok(
      zone.querySelector('input[type="file"]'),
      'with a real input inside it',
    );
    assert.ok(
      zone.querySelector('button'),
      'and a keyboard-reachable button — react-spectrum leaves this to the caller, which is how pointer-only dropzones happen',
    );
    assert.ok(
      zone.querySelector('[role="status"][aria-live="polite"]'),
      'plus a polite live region for the verdict',
    );
    assert.true(
      zone.textContent?.indexOf('Drop lots') !== -1,
      'the label renders',
    );
    assert.true(zone.textContent?.indexOf('PNG only') !== -1, 'and the hint');
  });

  test('a screened batch announces what was taken and what was refused, with the reason', async function (assert) {
    // Driving `take` directly is the honest way to test this: a synthetic
    // DataTransfer is not constructible in every engine, and the drop path
    // and the picker path converge on this same method by design.
    let zone: Dropzone | undefined;
    class Probe extends Dropzone {
      constructor(owner: unknown, args: never) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test seam
        super(owner as any, args as any);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        zone = this;
      }
    }
    await render(
      <template><Probe @accept='image/png' @maxFiles={{1}} /></template>,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching the
    // component's own handler, which is what both real paths call.
    (zone as any).take([PNG, PDF]);
    await settled();
    let said = (
      root().querySelector('[role="status"]') as HTMLElement
    ).textContent?.trim();
    assert.true((said ?? '').indexOf(PNG.name) !== -1, 'the accepted file is named');
    assert.true(
      (said ?? '').indexOf('wrong file type') !== -1,
      'and the refusal reason is spoken: ' + said,
    );
  });

  test('a disabled Dropzone dims and disables its input', async function (assert) {
    await render(<template><Dropzone @disabled={{true}} /></template>);
    let input = root().querySelector('input[type="file"]') as HTMLInputElement;
    assert.true(input.disabled, 'the input is inert');
    assert.strictEqual(
      (root().querySelector('[data-test-pretui-dropzone]') as HTMLElement).getAttribute(
        'data-disabled',
      ),
      'true',
      'and the zone says so in a still frame',
    );
  });
});
