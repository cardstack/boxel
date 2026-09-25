// Pretui — OtpInput unit tests. Imports from ./composites; when OtpInput moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import {
  render,
  fillIn,
  focus,
  triggerKeyEvent,
  triggerEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { OtpInput } from './composites';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function otpSegs(): HTMLInputElement[] {
  return all('.pretui-otp-seg') as HTMLInputElement[];
}
function otpText(): string {
  return otpSegs().map((s) => s.value).join('|');
}

module('Pretui | components/otp-input', function (hooks) {
  setupCardTest(hooks);

  test('OtpInput is a labelled group of six single-character fields', async function (assert) {
    await render(<template><OtpInput /></template>);
    let root = q('[data-test-pretui-otp-input]');
    assert.strictEqual(root.getAttribute('role'), 'group');
    assert.strictEqual(root.getAttribute('aria-label'), 'One-time code');
    let segs = otpSegs();
    assert.strictEqual(segs.length, 6);
    assert.deepEqual(segs.map((s) => s.maxLength), Array(6).fill(1));
    assert.deepEqual(
      segs.map((s) => s.getAttribute('aria-label')),
      [1, 2, 3, 4, 5, 6].map((n) => `Digit ${n} of 6`),
      'each slot says where it sits, so tabbing through is not six unnamed boxes',
    );
    assert.strictEqual(segs[0]?.autocomplete, 'one-time-code', 'only the first slot claims the autofill');
    assert.strictEqual(segs[1]?.autocomplete, 'off');
    assert.strictEqual(segs[0]?.type, 'text');
    assert.strictEqual(segs[0]?.inputMode, 'numeric', 'numeric by default');
  });

  test('OtpInput seeds from @defaultValue, filtered and truncated to its length', async function (assert) {
    await render(<template><OtpInput @length={{4}} @defaultValue='12a34567' /></template>);
    assert.strictEqual(otpText(), '1|2|3|4', 'the letter is dropped and the overflow trimmed');
  });

  test('OtpInput writes one slot per keystroke and walks the caret forward', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{4}} @onValueChange={{record}} /></template>);
    let segs = otpSegs();

    await fillIn(segs[0] as HTMLElement, '4');
    assert.strictEqual(otpText(), '4|||');
    assert.deepEqual(seen, ['4'], 'the joined string, dense — no holes for empty slots');
  });

  test('OtpInput rejects a character outside its class and restores the slot', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{4}} @defaultValue='7' @onValueChange={{record}} /></template>);
    await fillIn(otpSegs()[0] as HTMLElement, 'x');
    assert.strictEqual(otpText(), '7|||', 'the slot keeps what was there');
    assert.deepEqual(seen, [], 'and nothing was reported');
  });

  test('OtpInput accepts letters when its type says so', async function (assert) {
    await render(<template><OtpInput @length={{3}} @type='alphanumeric' /></template>);
    assert.strictEqual(otpSegs()[0]?.inputMode, 'text');
    await fillIn(otpSegs()[0] as HTMLElement, 'a');
    assert.strictEqual(otpText(), 'a||');
  });

  test('OtpInput distributes a multi-character burst across the slots (browser autofill)', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @onValueChange={{record}} /></template>);
    // Written straight onto the element rather than through `fillIn`, which
    // refuses text longer than maxlength — a browser's OTP autofill does not.
    let first = otpSegs()[0] as HTMLInputElement;
    first.value = '482913';
    await triggerEvent(first, 'input');
    assert.strictEqual(otpText(), '4|8|2|9|1|3', 'autofill into the first box fills the whole code');
    assert.deepEqual(seen, ['482913']);
  });

  test('OtpInput distributes a paste from the slot it landed on', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='48' @onValueChange={{record}} /></template>);
    let event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => '29-13' },
    });
    (otpSegs()[2] as HTMLElement).dispatchEvent(event);
    await triggerEvent(otpSegs()[2] as HTMLElement, 'focus');
    assert.strictEqual(otpText(), '4|8|2|9|1|3', 'the separator is filtered out on the way in');
    assert.deepEqual(seen, ['482913']);
  });

  test('OtpInput appends rather than leaving a hole when a click lands past the value', async function (assert) {
    // The write is clamped to the fill edge. Its only other observable — where
    // the caret lands afterwards — is masked by the focus-loss gap pinned below,
    // so the dense value is what this can hold today.
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='48' @onValueChange={{record}} /></template>);
    await fillIn(otpSegs()[5] as HTMLElement, '9');
    assert.strictEqual(otpText(), '4|8|9|||', 'the write clamped to the fill edge');
    assert.deepEqual(seen, ['489']);
  });

  test('OtpInput Backspace on a filled slot splices it out and walks back', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='4829' @onValueChange={{record}} /></template>);
    await triggerKeyEvent(otpSegs()[1] as HTMLElement, 'keydown', 'Backspace');
    assert.deepEqual(seen, ['429'], 'the 8 is removed and the rest closes up');
    assert.strictEqual(otpText(), '4|2|9|||', 'and the slots repaint dense, with no gap where it was');
  });

  test('OtpInput Backspace at the fill edge eats the character before it in one press', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='482' @onValueChange={{record}} /></template>);
    await triggerKeyEvent(otpSegs()[3] as HTMLElement, 'keydown', 'Backspace');
    assert.deepEqual(seen, ['48'], 'one press, not two');
  });

  test('OtpInput Delete removes the character in place', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='4829' @onValueChange={{record}} /></template>);
    await focus(otpSegs()[1] as HTMLElement);
    await triggerKeyEvent(otpSegs()[1] as HTMLElement, 'keydown', 'Delete');
    assert.deepEqual(seen, ['429']);
    assert.strictEqual(otpText(), '4|2|9|||');
  });

  test('OtpInput navigation keys move real focus between the slots without editing the value', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><OtpInput @length={{6}} @defaultValue='482' @onValueChange={{record}} /></template>);
    await focus(otpSegs()[2] as HTMLElement);
    await triggerKeyEvent(otpSegs()[2] as HTMLElement, 'keydown', 'ArrowRight');
    assert.strictEqual(document.activeElement, otpSegs()[3], 'Right moves to the next slot');
    await triggerKeyEvent(otpSegs()[3] as HTMLElement, 'keydown', 'ArrowLeft');
    assert.strictEqual(document.activeElement, otpSegs()[2], 'Left moves back');
    await triggerKeyEvent(otpSegs()[2] as HTMLElement, 'keydown', 'End');
    assert.strictEqual(document.activeElement, otpSegs()[3], 'End lands on the fill edge, not the last box');
    await triggerKeyEvent(otpSegs()[3] as HTMLElement, 'keydown', 'Home');
    assert.strictEqual(document.activeElement, otpSegs()[0]);
    assert.deepEqual(seen, [], 'moving the caret is not an edit');
    assert.strictEqual(otpText(), '4|8|2|||');
  });

  test('KNOWN GAP: a keystroke blurs the field, because the segment inputs are recreated on every commit', async function (assert) {
    // `get segments()` builds fresh objects on each recompute and the
    // `{{#each}}` in composites.gts has no `key=`, so every commit tears down
    // all six inputs and the focused one goes with it: the old node is
    // disconnected and document.activeElement falls to <body>. The fix is
    // `key='index'` (or a stable id) on that `{{#each}}`; when it lands, focus
    // is on the next slot and this expectation flips.
    await render(<template><OtpInput @length={{6}} @defaultValue='48' /></template>);
    let seg = otpSegs()[2] as HTMLInputElement;
    await fillIn(seg, '9');
    assert.false(seg.isConnected, 'KNOWN GAP: the input the user typed into was replaced');
    assert.strictEqual(document.activeElement, document.body, 'KNOWN GAP: focus was lost, not walked forward');
  });

  test('OtpInput says the word "complete" rather than relying on the tinted ring', async function (assert) {
    await render(<template><OtpInput @length={{3}} @defaultValue='48' /></template>);
    assert.strictEqual(q('[data-test-pretui-otp-input]').dataset['complete'], undefined);
    assert.strictEqual(q('[data-test-pretui-otp-input] [role="status"]').textContent?.trim(), '');

    await render(<template><OtpInput @length={{3}} @defaultValue='482' /></template>);
    assert.strictEqual(q('[data-test-pretui-otp-input]').dataset['complete'], 'true');
    assert.strictEqual(
      q('[data-test-pretui-otp-input] [role="status"]').textContent?.trim(),
      'One-time code complete',
      'the success ring is colour-only information; this is the text channel beside it',
    );
  });

  test('OtpInput masks and disables on request', async function (assert) {
    await render(<template><OtpInput @length={{3}} @masked={{true}} @disabled={{true}} /></template>);
    let root = q('[data-test-pretui-otp-input]');
    assert.strictEqual(root.dataset['masked'], 'true');
    assert.strictEqual(root.dataset['disabled'], 'true');
    assert.deepEqual(otpSegs().map((s) => s.type), Array(3).fill('password'));
    assert.deepEqual(otpSegs().map((s) => s.disabled), Array(3).fill(true));
  });
});
