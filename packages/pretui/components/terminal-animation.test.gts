// Pretui — TerminalAnimation unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TerminalAnimation } from './terminal-animation';
import type { TerminalLine } from './terminal-animation';

const LINES: TerminalLine[] = [
  { id: 'a', kind: 'command', text: 'ls' },
  { id: 'b', text: 'foo' },
  { id: 'c', kind: 'error', text: 'no such file' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-terminal-animation]') as HTMLElement;
}
function lines(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-term-line')) as HTMLElement[];
}

module('Pretui | components/terminal-animation', function (hooks) {
  setupCardTest(hooks);

  test('the visual is decoration; the whole session is mirrored at once for a screen reader', async function (assert) {
    await render(<template><TerminalAnimation @lines={{LINES}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-term-title')?.textContent?.trim(), 'Terminal');
    assert.strictEqual(root().querySelector('figcaption')?.textContent?.trim(), 'Terminal session');
    assert.strictEqual(root().querySelector('.pretui-term-visual')?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(root().querySelector('figure > .pretui-sr:last-child')?.textContent, '$ ls\nfoo\nno such file', 'a reader gets the transcript, not text that appears to still be arriving');
    assert.deepEqual(lines().map((l) => l.dataset['kind']), ['command', 'output', 'error']);
  });

  test('schedules each line from the one before, and types commands character by character', async function (assert) {
    await render(<template><TerminalAnimation @lines={{LINES}} @charRate={{10}} /></template>);
    assert.deepEqual(lines().map((l) => l.getAttribute('style')), ['--pretui-term-at: 0.200s', '--pretui-term-at: 0.850s', '--pretui-term-at: 1.300s'], 'start 0.2, then 0.2s of typing + 0.45s hold, then 0.45s hold');
    let typed = lines()[0]?.querySelector('.pretui-term-type') as HTMLElement;
    assert.strictEqual(lines()[0]?.querySelector('.pretui-term-prompt')?.textContent, '$');
    assert.true(typed.getAttribute('style')?.includes('--pretui-term-dur: 0.200s'), 'two characters at ten per second');
    assert.true(typed.getAttribute('style')?.includes('--pretui-term-ch: 2ch'));
    assert.true(typed.getAttribute('style')?.includes('steps(2, end)'));
    assert.strictEqual(lines()[1]?.querySelector('.pretui-term-type'), null, 'output lines appear whole');
    assert.ok(lines()[2]?.querySelector('.pretui-term-caret'), 'the caret sits after the last line');
    assert.strictEqual(lines()[0]?.querySelector('.pretui-term-caret'), null);
  });

  test('typing, caret, delays, prompt and title are all knobs', async function (assert) {
    const PS: TerminalLine[] = [{ id: 'a', kind: 'command', text: 'pwd', prompt: '>' }];
    await render(<template><TerminalAnimation @lines={{PS}} @typing={{false}} @caret={{false}} @startDelay={{1}} @title='boxel' @label='Deploy log' /></template>);
    assert.strictEqual(lines()[0]?.getAttribute('style'), '--pretui-term-at: 1.000s');
    assert.strictEqual(lines()[0]?.querySelector('.pretui-term-type'), null, 'no typing animation');
    assert.strictEqual(lines()[0]?.querySelector('.pretui-term-caret'), null);
    assert.strictEqual(lines()[0]?.querySelector('.pretui-term-prompt')?.textContent, '>');
    assert.strictEqual(root().querySelector('.pretui-term-title')?.textContent?.trim(), 'boxel');
    assert.strictEqual(root().querySelector('figcaption')?.textContent?.trim(), 'Deploy log');
    assert.strictEqual(root().querySelector('figure > .pretui-sr:last-child')?.textContent, '> pwd');
  });
});
