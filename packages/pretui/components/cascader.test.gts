// Pretui — Cascader unit tests: columns open level by level, leaves commit a
// path, the keyboard walks the columns, focus lands and returns.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, settled, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Cascader } from './cascader';
import type { CascaderOption } from './cascader';

const PLACES: CascaderOption[] = [
  {
    value: 'asia',
    label: 'Asia',
    children: [
      { value: 'japan', label: 'Japan', children: [{ value: 'kyoto', label: 'Kyoto' }, { value: 'osaka', label: 'Osaka' }] },
      { value: 'china', label: 'China', children: [{ value: 'fujian', label: 'Fujian' }] },
    ],
  },
  { value: 'africa', label: 'Africa', children: [{ value: 'kenya', label: 'Kenya' }] },
  { value: 'antarctica', label: 'Antarctica', disabled: true },
];

const TRIGGER = '[data-test-pretui-cascader-trigger]';
const POPUP = '[data-test-pretui-cascader-popup]';

function trigger(): HTMLButtonElement {
  return document.querySelector(TRIGGER) as HTMLButtonElement;
}
function columns(): number {
  return document.querySelectorAll('[data-test-pretui-cascader-col]').length;
}
function focusedValue(): string | null {
  return (document.activeElement as HTMLElement | null)?.getAttribute('data-test-pretui-cascader-option') ?? null;
}

module('Pretui | components/cascader', function (hooks) {
  setupCardTest(hooks);

  test('the trigger is a closed listbox disclosure showing the placeholder', async function (assert) {
    await render(<template><Cascader @options={{PLACES}} @label='Origin' @placeholder='Pick a region' data-field='origin' /></template>);
    assert.strictEqual((document.querySelector('[data-test-pretui-cascader]') as HTMLElement).getAttribute('data-field'), 'origin');
    assert.strictEqual(trigger().getAttribute('aria-haspopup'), 'listbox');
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Origin');
    assert.ok(trigger().textContent?.includes('Pick a region'));
    assert.notOk(document.querySelector(POPUP));
  });

  test('clicking through branches opens a column per level; a leaf commits the path and closes', async function (assert) {
    let seen: [string[], string[]][] = [];
    let change = (path: string[], labels: string[]) => seen.push([path, labels]);
    await render(<template><Cascader @options={{PLACES}} @label='Origin' @onChange={{change}} /></template>);
    await click(TRIGGER);
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(columns(), 1);
    await click('[data-test-pretui-cascader-option="asia"]');
    assert.strictEqual(columns(), 2, 'a branch opens the next column');
    await click('[data-test-pretui-cascader-option="japan"]');
    assert.strictEqual(columns(), 3);
    assert.deepEqual(seen, [], 'nothing commits on a branch by default');
    await click('[data-test-pretui-cascader-option="kyoto"]');
    assert.deepEqual(seen, [[['asia', 'japan', 'kyoto'], ['Asia', 'Japan', 'Kyoto']]]);
    assert.notOk(document.querySelector(POPUP), 'closed');
    assert.strictEqual(document.querySelector('[data-test-pretui-cascader-value]')?.textContent?.trim(), 'Asia / Japan / Kyoto');
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Origin: Asia / Japan / Kyoto');
    assert.strictEqual(document.activeElement, trigger(), 'focus returns to the trigger');
  });

  test('@changeOnSelect commits a branch too, and keeps the popup open', async function (assert) {
    let seen: string[][] = [];
    let change = (path: string[]) => seen.push(path);
    await render(<template><Cascader @options={{PLACES}} @changeOnSelect={{true}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await click('[data-test-pretui-cascader-option="africa"]');
    assert.deepEqual(seen, [['africa']]);
    assert.ok(document.querySelector(POPUP));
  });

  test('a disabled option is marked and cannot be chosen', async function (assert) {
    let seen: string[][] = [];
    let change = (path: string[]) => seen.push(path);
    await render(<template><Cascader @options={{PLACES}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    let off = document.querySelector('[data-test-pretui-cascader-option="antarctica"]') as HTMLElement;
    assert.strictEqual(off.getAttribute('aria-disabled'), 'true');
    await click(off);
    assert.deepEqual(seen, []);
  });

  test('the keyboard walks the columns: down, right into a branch, left back out, Enter on a leaf', async function (assert) {
    let seen: string[][] = [];
    let change = (path: string[]) => seen.push(path);
    await render(<template><Cascader @options={{PLACES}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await settled();
    assert.strictEqual(focusedValue(), 'asia', 'focus lands on the first option');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowDown');
    assert.strictEqual(focusedValue(), 'africa');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowDown');
    assert.strictEqual(focusedValue(), 'asia', 'the disabled option is skipped and the column wraps');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowRight');
    assert.strictEqual(focusedValue(), 'japan', 'into the branch, on its first child');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowRight');
    assert.strictEqual(focusedValue(), 'kyoto');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowLeft');
    assert.strictEqual(focusedValue(), 'japan', 'back out');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowDown');
    await triggerKeyEvent(POPUP, 'keydown', 'Enter');
    assert.strictEqual(focusedValue(), 'fujian', 'Enter on a branch goes in');
    await triggerKeyEvent(POPUP, 'keydown', 'Enter');
    assert.deepEqual(seen, [['asia', 'china', 'fujian']]);
    assert.strictEqual(document.activeElement, trigger());
  });

  test('opening lands on the committed path; Escape closes and returns focus', async function (assert) {
    let value = ['asia', 'japan', 'osaka'];
    await render(<template><Cascader @options={{PLACES}} @value={{value}} /></template>);
    await click(TRIGGER);
    await settled();
    assert.strictEqual(columns(), 3, 'the path is expanded');
    assert.strictEqual(focusedValue(), 'osaka', 'focus on the deepest committed option');
    await triggerKeyEvent(POPUP, 'keydown', 'Escape');
    assert.notOk(document.querySelector(POPUP));
    assert.strictEqual(document.activeElement, trigger());
  });

  test('a pointer press outside closes it', async function (assert) {
    await render(<template><p class='t-out'>Elsewhere</p><Cascader @options={{PLACES}} /></template>);
    await click(TRIGGER);
    await triggerEvent('.t-out', 'pointerdown');
    assert.notOk(document.querySelector(POPUP));
  });

  test('Space on a branch opens it and commits nothing; each column is named for its parent', async function (assert) {
    let seen: string[][] = [];
    let change = (path: string[]) => seen.push(path);
    await render(<template><Cascader @options={{PLACES}} @label='Origin' @onChange={{change}} /></template>);
    await click(TRIGGER);
    await settled();
    await triggerKeyEvent(POPUP, 'keydown', ' ');
    assert.deepEqual(seen, [], 'no branch commit without @changeOnSelect');
    assert.strictEqual(focusedValue(), 'japan', 'Space went into Asia');
    let cols = [...document.querySelectorAll('[data-test-pretui-cascader-col]')].map((c) => c.getAttribute('aria-label'));
    assert.deepEqual(cols, ['Origin', 'Asia', 'Japan']);
    assert.notOk(document.querySelector('[role="option"][aria-haspopup]'), 'no aria-haspopup on an option');
    await triggerKeyEvent(POPUP, 'keydown', 'ArrowUp');
    assert.strictEqual(focusedValue(), 'china', 'ArrowUp wraps within the column');
    await triggerKeyEvent(POPUP, 'keydown', 'Tab');
    assert.notOk(document.querySelector(POPUP), 'Tab closes');
  });

  test('a stale value opens on the part that still resolves, with an option focusable', async function (assert) {
    let value = ['asia', 'japan', 'nara'];
    await render(<template><Cascader @options={{PLACES}} @value={{value}} /></template>);
    await click(TRIGGER);
    await settled();
    assert.strictEqual(focusedValue(), 'japan', 'focus on the deepest option that exists');
  });
});
