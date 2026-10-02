// Pretui — TagsInput unit tests. TagsInput is TokenInput under the Mantine
// spellings, so these pin the mapping — it is TokenInput's row, duplicates
// and separators reach it, both notify spellings fire — and the IME guard
// both share. TokenInput's own behaviour is tested in design-tools.test.gts.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { fillIn, render, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TagsInput } from './tags-input';

const ENTRY = '[data-test-pretui-token-entry]';
const SEMI = [';'];

function tags(): string[] {
  return [...document.querySelectorAll('[data-test-pretui-token-remove]')].map(
    (el) => el.getAttribute('data-test-pretui-token-remove') ?? '',
  );
}
function status(): string | undefined {
  return document.querySelector('[data-test-pretui-token-status]')?.textContent?.trim();
}

module('Pretui | components/tags-input', function (hooks) {
  setupCardTest(hooks);

  test('it is the TokenInput row, with attributes on it', async function (assert) {
    let start = ['Washed'];
    await render(<template><TagsInput @label='Lot tags' @defaultValue={{start}} data-form='lot' /></template>);
    let root = document.querySelector('[data-test-pretui-tags-input]') as HTMLElement;
    assert.ok(root.hasAttribute('data-test-pretui-token-input'), 'the same element TokenInput renders');
    assert.strictEqual(root.getAttribute('data-form'), 'lot');
    assert.deepEqual(tags(), ['Washed']);
    assert.strictEqual(
      document.querySelector('[data-test-pretui-token-remove="Washed"]')?.getAttribute('aria-label'),
      'Remove Washed',
      'the chip is TokenInput’s, named for its tag',
    );
  });

  test('Enter commits; both notify spellings fire with the same list', async function (assert) {
    let a: string[][] = [];
    let b: string[][] = [];
    let onChange = (next: string[]) => a.push(next);
    let onValueChange = (next: string[]) => b.push(next);
    await render(<template><TagsInput @label='Regions' @onChange={{onChange}} @onValueChange={{onValueChange}} /></template>);
    await fillIn(ENTRY, 'East');
    await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
    assert.deepEqual(a, [['East']]);
    assert.deepEqual(b, [['East']]);
  });

  test('a duplicate is refused and announced, case-insensitively, unless @duplicates', async function (assert) {
    let start = ['East'];
    await render(<template>
      <div class='t-a'><TagsInput @label='A' @defaultValue={{start}} /></div>
    </template>);
    let entry = document.querySelector('.t-a [data-test-pretui-token-entry]') as HTMLInputElement;
    await fillIn(entry, 'east');
    await triggerKeyEvent(entry, 'keydown', 'Enter');
    assert.deepEqual(tags(), ['East']);
    assert.strictEqual(status(), 'east is already in the list');
  });

  test('@duplicates maps to allowDuplicates', async function (assert) {
    let start = ['East'];
    await render(<template><TagsInput @label='A' @defaultValue={{start}} @duplicates={{true}} /></template>);
    await fillIn(ENTRY, 'East');
    await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
    assert.deepEqual(tags(), ['East', 'East']);
  });

  test('@separators replaces the comma as the commit character', async function (assert) {
    await render(<template>
      <div class='t-a'><TagsInput @label='A' /></div>
      <div class='t-b'><TagsInput @label='B' @separators={{SEMI}} /></div>
    </template>);
    let a = document.querySelector('.t-a [data-test-pretui-token-entry]') as HTMLInputElement;
    let b = document.querySelector('.t-b [data-test-pretui-token-entry]') as HTMLInputElement;
    await fillIn(a, 'North,');
    assert.deepEqual(
      [...document.querySelectorAll('.t-a [data-test-pretui-token-remove]')].map((e) => e.getAttribute('data-test-pretui-token-remove')),
      ['North'],
      'a comma commits by default',
    );
    await fillIn(b, 'Lot 7, washed;');
    assert.deepEqual(
      [...document.querySelectorAll('.t-b [data-test-pretui-token-remove]')].map((e) => e.getAttribute('data-test-pretui-token-remove')),
      ['Lot 7, washed'],
      'with ; as the separator, a comma is just text',
    );
  });

  test('the Enter that confirms an IME composition commits nothing', async function (assert) {
    await render(<template><TagsInput @label='A' /></template>);
    await fillIn(ENTRY, 'とう');
    await triggerEvent(ENTRY, 'keydown', { key: 'Enter', isComposing: true });
    assert.deepEqual(tags(), [], 'still composing');
    await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
    assert.deepEqual(tags(), ['とう'], 'the next Enter commits');
  });
});

