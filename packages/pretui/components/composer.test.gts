// Pretui — Composer unit tests. Imports from ../agentic-chat; when Composer moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-composer]') as HTMLElement;
}
function field(): HTMLTextAreaElement {
  return root().querySelector('[data-test-pretui-composer-field]') as HTMLTextAreaElement;
}
function send(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-composer-send]');
}
function hint(): string | undefined {
  return root().querySelector('.pretui-composer-hint')?.textContent?.trim();
}
function modeRadios(): HTMLInputElement[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-composer-modes] input[type="radio"]')) as HTMLInputElement[];
}

module('Pretui | components/composer', function (hooks) {
  setupCardTest(hooks);

  test('names the field permanently and carries the hint beside it, not as a placeholder', async function (assert) {
    await render(<template><Composer /></template>);
    assert.strictEqual(field().getAttribute('aria-label'), 'Message the agent');
    assert.strictEqual(field().placeholder, '', 'a placeholder would become the accessible name and vanish on typing');
    assert.strictEqual(hint(), 'Ask about this card…', 'the Ask mode hint');
    assert.strictEqual(root().querySelector('.pretui-composer-hint')?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(field().rows, 2);
    assert.true(send()?.disabled, 'nothing to send yet');
  });

  test('describes the field by the active mode note, which is a live region', async function (assert) {
    await render(<template><Composer /></template>);
    let noteId = field().getAttribute('aria-describedby') as string;
    let note = document.getElementById(noteId) as HTMLElement;
    assert.strictEqual(note.textContent?.trim(), 'Ask reads only — it never edits.');
    assert.strictEqual(note.getAttribute('role'), 'status', 'switching mode announces its consequence');
  });

  test('switching mode changes the note and the hint, and reports the mode', async function (assert) {
    let seen: string[] = [];
    const record = (m: string) => seen.push(m);
    await render(<template><Composer @onModeChange={{record}} /></template>);
    assert.strictEqual(modeRadios().length, 2, 'Ask and Act');
    await click(modeRadios()[1] as HTMLElement);
    assert.deepEqual(seen, ['act']);
    assert.strictEqual(hint(), 'Tell the agent what to change…');
    assert.strictEqual(document.getElementById(field().getAttribute('aria-describedby') as string)?.textContent?.trim(), 'Act may propose changes for your approval.');
  });

  test('typing reports every keystroke and Enter sends the trimmed draft with the mode, then clears', async function (assert) {
    let inputs: string[] = [];
    let sent: [string, string][] = [];
    const onInput = (v: string) => inputs.push(v);
    const onSend = (t: string, m: string) => sent.push([t, m]);
    await render(<template><Composer @onInput={{onInput}} @onSend={{onSend}} /></template>);
    await fillIn(field(), '  Check the Anxi lot  ');
    assert.deepEqual(inputs.at(-1), '  Check the Anxi lot  ');
    assert.false(send()?.disabled);

    await triggerKeyEvent(field(), 'keydown', 'Enter');
    assert.deepEqual(sent, [['Check the Anxi lot', 'ask']]);
    assert.strictEqual(field().value, '', 'the draft clears');
    assert.true(send()?.disabled);
  });

  test('Shift+Enter inserts a newline instead of sending; Mod+Enter always sends', async function (assert) {
    let sent: string[] = [];
    const onSend = (t: string) => sent.push(t);
    await render(<template><Composer @onSend={{onSend}} @submitOnEnter={{false}} /></template>);
    await fillIn(field(), 'draft');
    await triggerKeyEvent(field(), 'keydown', 'Enter');
    assert.deepEqual(sent, [], 'plain Enter is a newline when the caller says so');
    await triggerKeyEvent(field(), 'keydown', 'Enter', { shiftKey: true });
    assert.deepEqual(sent, []);
    await triggerKeyEvent(field(), 'keydown', 'Enter', { ctrlKey: true });
    assert.deepEqual(sent, ['draft'], 'the escape hatch every chat surface has');

    // The modifier check itself, under the default where plain Enter DOES send.
    sent.length = 0;
    await render(<template><Composer @onSend={{onSend}} /></template>);
    await fillIn(field(), 'draft');
    await triggerKeyEvent(field(), 'keydown', 'Enter', { shiftKey: true });
    assert.deepEqual(sent, [], 'Shift+Enter is a newline even when Enter sends');
    await triggerKeyEvent(field(), 'keydown', 'Enter', { altKey: true });
    assert.deepEqual(sent, [], 'so is Alt+Enter');
    await triggerKeyEvent(field(), 'keydown', 'Enter');
    assert.deepEqual(sent, ['draft'], 'and plain Enter sends');
  });

  test('a whitespace-only draft cannot be sent', async function (assert) {
    let sent: string[] = [];
    const onSend = (t: string) => sent.push(t);
    await render(<template><Composer @onSend={{onSend}} /></template>);
    await fillIn(field(), '   ');
    assert.true(send()?.disabled, 'whitespace is not a message');
    await triggerKeyEvent(field(), 'keydown', 'Enter');
    assert.deepEqual(sent, [], 'and Enter does not slip past the disabled button');
  });

  test('a queue rewrites the hint so an unseen queue is not mistaken for a sent message', async function (assert) {
    await render(<template><Composer @queueCount={{1}} /></template>);
    assert.strictEqual(hint(), 'Type now to queue behind 1 message…');
    await render(<template><Composer @queueCount={{3}} /></template>);
    assert.strictEqual(hint(), 'Type now to queue behind 3 messages…');
    await render(<template><Composer @queueCount={{3}} @placeholder='Say anything' /></template>);
    assert.strictEqual(hint(), 'Say anything', 'a caller placeholder overrides every derivation');
  });

  test('busy swaps Send for Stop and marks the surface', async function (assert) {
    let stops = 0;
    const onStop = () => (stops += 1);
    await render(<template><Composer @busy={{true}} @onStop={{onStop}} @stopLabel='Halt' /></template>);
    assert.strictEqual(root().dataset['busy'], 'true');
    assert.strictEqual(send(), null);
    let stop = root().querySelector('[data-test-pretui-composer-stop]') as HTMLButtonElement;
    assert.strictEqual(stop.textContent?.trim(), 'Halt');
    await click(stop);
    assert.strictEqual(stops, 1);
  });

  test('attachments show their provenance, with Pin only for auto-attached and Remove only for pinned', async function (assert) {
    const ATTACHMENTS: ComposerAttachment[] = [
      { id: 'a', label: 'Wuyi Origins · Account', auto: true },
      { id: 'b', label: 'Spring cupping notes' },
    ];
    let pinned: string[] = [];
    let removed: string[] = [];
    const onPin = (a: ComposerAttachment) => pinned.push(a.id);
    const onRemove = (a: ComposerAttachment) => removed.push(a.id);
    await render(<template><Composer @attachments={{ATTACHMENTS}} @onPin={{onPin}} @onRemove={{onRemove}} /></template>);
    let list = root().querySelector('.pretui-composer-attachments') as HTMLElement;
    assert.strictEqual(list.getAttribute('aria-label'), 'Attached context');
    assert.deepEqual(Array.from(list.querySelectorAll('.pretui-attach-tag')).map((t) => t.textContent?.trim()), ['Viewing', 'Attached']);
    await click(list.querySelector('[aria-label="Pin Wuyi Origins · Account"]') as HTMLElement);
    await click(list.querySelector('[aria-label="Remove Spring cupping notes"]') as HTMLElement);
    assert.deepEqual(pinned, ['a']);
    assert.deepEqual(removed, ['b']);
    assert.strictEqual(list.querySelector('[aria-label="Remove Wuyi Origins · Account"]'), null, 'an auto attachment is pinned, not removed');
  });

  test('controlled value and mode hold still and report; disabled deadens the surface', async function (assert) {
    let inputs: string[] = [];
    const onInput = (v: string) => inputs.push(v);
    await render(<template><Composer @value='held' @mode='act' @onInput={{onInput}} /></template>);
    assert.strictEqual(field().value, 'held');
    assert.true(modeRadios()[1]?.checked);
    await fillIn(field(), 'typed');
    assert.deepEqual(inputs, ['typed'], 'the owner is told');
    // KNOWN GAP: `value={{this.value}}` is a property binding, and in
    // controlled mode the getter does not change on a keystroke — so nothing
    // re-renders and the textarea keeps what the user typed, disagreeing with
    // @value. Same mechanism as RadioGroup/SegmentedControl. The grow-sizer
    // reads the same getter, so the field's height is computed from the stale
    // string too; and the controlled @mode radios drift the same way (pinned
    // below). Pinned so the day this is fixed the expectations fail and get
    // flipped.
    assert.strictEqual(field().value, 'typed', 'KNOWN GAP: the DOM drifted away from @value');
    assert.strictEqual(
      (root().querySelector('.pretui-composer-grow') as HTMLElement).dataset['value'],
      'held ',
      'the sizer still holds @value, so the textarea is sized for a string it no longer shows',
    );
    const ignoreMode = () => {};
    await render(<template><Composer @mode='ask' @onModeChange={{ignoreMode}} /></template>);
    await click(modeRadios()[1] as HTMLElement);
    assert.deepEqual(modeRadios().map((r) => r.checked), [false, true], 'KNOWN GAP: the mode radio drifted away from @mode');
    assert.true(hint()?.startsWith('Ask'), 'while the hint still describes the owner-held mode');

    await render(<template><Composer @disabled={{true}} @defaultValue='x' @rows={{4}} @label='Ask the concierge' @sendLabel='Go' /></template>);
    assert.true(field().disabled);
    assert.true(send()?.disabled, 'a draft cannot be sent from a disabled surface');
    assert.strictEqual(field().rows, 4);
    assert.strictEqual(field().getAttribute('aria-label'), 'Ask the concierge');
    assert.strictEqual(send()?.textContent?.trim(), 'Go');
  });

  test('renders the tools block in the action bar', async function (assert) {
    await render(<template><Composer><:tools><button type='button' data-test-tool>Model</button></:tools></Composer></template>);
    assert.ok(root().querySelector('.pretui-composer-bar [data-test-tool]'));
  });
});
