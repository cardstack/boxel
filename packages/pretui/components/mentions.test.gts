// Pretui — Mentions unit tests: the trigger opens filtered suggestions, the
// keyboard moves and inserts, Escape dismisses for this query, and the text
// stays a plain string.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { fillIn, render, settled, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Mentions } from './mentions';
import type { MentionItem } from './mentions';

const PEOPLE: MentionItem[] = [
  { id: 'ana', label: 'Ana Ruiz' },
  { id: 'ben', label: 'Ben Okafor' },
  { id: 'cai', label: 'Cai Lin' },
];
const INPUT = '[data-test-pretui-mentions-input]';

class Items {
  @tracked items: MentionItem[] = PEOPLE;
}

function input(): HTMLTextAreaElement {
  return document.querySelector(INPUT) as HTMLTextAreaElement;
}
function options(): string[] {
  return [...document.querySelectorAll('[data-test-pretui-mention-option]')].map(
    (el) => el.getAttribute('data-test-pretui-mention-option') ?? '',
  );
}

module('Pretui | components/mentions', function (hooks) {
  setupCardTest(hooks);

  test('typing the trigger opens every suggestion; a query filters them', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} @label='Comment' /></template>);
    assert.strictEqual(input().getAttribute('aria-label'), 'Comment');
    assert.notOk(document.querySelector('[data-test-pretui-mentions-list]'), 'closed to start');
    await fillIn(INPUT, 'Hi @');
    assert.deepEqual(options(), ['ana', 'ben', 'cai']);
    await fillIn(INPUT, 'Hi @b');
    assert.deepEqual(options(), ['ben']);
    let list = document.querySelector('[data-test-pretui-mentions-list]') as HTMLElement;
    assert.strictEqual(list.getAttribute('role'), 'listbox');
    assert.strictEqual(input().getAttribute('aria-controls'), list.id);
  });

  test('a trigger inside a word is not a mention', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    await fillIn(INPUT, 'mail me at ana@');
    assert.deepEqual(options(), []);
  });

  test('arrows move the active option through aria-activedescendant, Enter inserts it', async function (assert) {
    let mentioned: string[] = [];
    let values: string[] = [];
    let onMention = (item: MentionItem) => mentioned.push(item.id);
    let onChange = (v: string) => values.push(v);
    await render(<template><Mentions @items={{PEOPLE}} @onMention={{onMention}} @onChange={{onChange}} /></template>);
    await fillIn(INPUT, 'Thanks @');
    let first = input().getAttribute('aria-activedescendant');
    assert.strictEqual(document.getElementById(first ?? '')?.getAttribute('aria-selected'), 'true', 'the first option is active');
    await triggerKeyEvent(INPUT, 'keydown', 'ArrowDown');
    let second = document.getElementById(input().getAttribute('aria-activedescendant') ?? '');
    assert.strictEqual(second?.getAttribute('data-test-pretui-mention-option'), 'ben');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.strictEqual(input().value, 'Thanks @Ben Okafor ');
    assert.deepEqual(mentioned, ['ben']);
    assert.strictEqual(values[values.length - 1], 'Thanks @Ben Okafor ');
    assert.deepEqual(options(), [], 'the list closes');
  });

  test('inserting replaces only the query, keeping the text after the caret', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    await fillIn(INPUT, 'ping @ca about lot 7');
    input().setSelectionRange(8, 8);
    await triggerEvent(INPUT, 'keyup');
    assert.deepEqual(options(), ['cai']);
    await triggerKeyEvent(INPUT, 'keydown', 'Tab');
    assert.strictEqual(input().value, 'ping @Cai Lin about lot 7', 'one space: the text already continues with one');
  });

  test('clicking an option inserts it, and the press before it cannot take focus', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    input().focus();
    await fillIn(INPUT, '@a');
    let option = document.querySelector('[data-test-pretui-mention-option="ana"]') as HTMLElement;
    let press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    option.dispatchEvent(press);
    assert.true(press.defaultPrevented, 'the press cannot move focus off the textarea');
    option.click();
    await settled();
    assert.strictEqual(input().value, '@Ana Ruiz ');
  });

  test('a controlled field shows @value until the owner takes the keystroke', async function (assert) {
    let seen: string[] = [];
    let onChange = (v: string) => seen.push(v);
    await render(<template><Mentions @items={{PEOPLE}} @value='hello' @onChange={{onChange}} /></template>);
    await fillIn(INPUT, 'hello!');
    assert.deepEqual(seen, ['hello!'], 'the owner is told');
    assert.strictEqual(input().value, 'hello', 'and the textarea did not drift');
  });

  test('a caret before a leading trigger is not a query', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    await fillIn(INPUT, '@x hi');
    input().setSelectionRange(0, 0);
    await triggerEvent(INPUT, 'keyup');
    assert.deepEqual(options(), [], 'nothing opens at caret 0');
  });

  test('the Enter that confirms an IME composition inserts nothing', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    await fillIn(INPUT, '@a');
    await triggerEvent(INPUT, 'keydown', { key: 'Enter', isComposing: true });
    assert.strictEqual(input().value, '@a');
    assert.deepEqual(options(), ['ana', 'ben', 'cai'], 'still open');
  });

  test('inserting goes through the editing stack, so undo takes it back', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    input().focus();
    await fillIn(INPUT, 'hi @a');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.strictEqual(input().value, 'hi @Ana Ruiz ');
    document.execCommand('undo');
    await settled();
    assert.strictEqual(input().value, 'hi @a', 'Ctrl+Z restores what was typed');
  });

  test('the active option is clamped when a remote list shrinks under it', async function (assert) {
    let state = new Items();
    let onQuery = () => {};
    await render(<template><Mentions @items={{state.items}} @onQuery={{onQuery}} /></template>);
    await fillIn(INPUT, '@');
    await triggerKeyEvent(INPUT, 'keydown', 'ArrowDown');
    await triggerKeyEvent(INPUT, 'keydown', 'ArrowDown');
    state.items = [{ id: 'ana', label: 'Ana Ruiz' }];
    await settled();
    let active = input().getAttribute('aria-activedescendant') ?? '';
    assert.ok(document.getElementById(active), 'the active descendant exists');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.strictEqual(input().value, '@Ana Ruiz ');
  });

  test('Escape closes the list for this query; a new trigger opens it again', async function (assert) {
    await render(<template><Mentions @items={{PEOPLE}} /></template>);
    await fillIn(INPUT, '@a');
    await triggerKeyEvent(INPUT, 'keydown', 'Escape');
    assert.deepEqual(options(), []);
    await fillIn(INPUT, '@an');
    assert.deepEqual(options(), [], 'still dismissed while typing the same query');
    await fillIn(INPUT, '@an @');
    assert.deepEqual(options(), ['ana', 'ben', 'cai'], 'a new trigger reopens');
  });

  test('@onQuery takes over filtering', async function (assert) {
    let queries: string[] = [];
    let onQuery = (q: string) => queries.push(q);
    await render(<template><Mentions @items={{PEOPLE}} @onQuery={{onQuery}} /></template>);
    await fillIn(INPUT, '@zz');
    assert.deepEqual(queries, ['zz']);
    assert.deepEqual(options(), ['ana', 'ben', 'cai'], 'the caller filters, so @items shows as given');
  });
});
