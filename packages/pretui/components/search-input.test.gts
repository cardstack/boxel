// Pretui — SearchInput unit tests: the collapsed display.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent, focus, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SearchInput } from './search-input';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-search-input]') as HTMLElement;
}
function toggle(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-search-toggle]');
}
function input(): HTMLInputElement | null {
  return root().querySelector('input');
}

module('Pretui | components/search-input', function (hooks) {
  setupCardTest(hooks);

  test('the default field has no toggle', async function (assert) {
    await render(<template><SearchInput @placeholder='Search tasks' /></template>);
    assert.ok(input());
    assert.notOk(toggle());
  });

  test("@display 'collapsed' opens on click, keeps the value, and Escape returns focus", async function (assert) {
    let seen: string[] = [];
    let onInput = (v: string) => seen.push(v);
    await render(
      <template><SearchInput @display='collapsed' @placeholder='Search tasks' @onInput={{onInput}} /></template>,
    );
    assert.notOk(input(), 'only the square shows');
    assert.strictEqual(toggle()?.getAttribute('aria-label'), 'Search tasks');

    await click(toggle() as HTMLElement);
    assert.strictEqual(document.activeElement, input(), 'the field opens focused');
    await fillIn(input() as HTMLInputElement, 'bug');
    assert.deepEqual(seen, ['bug']);

    await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
    await waitUntil(() => document.activeElement === toggle());
    assert.notOk(input(), 'Escape collapses it');
    assert.strictEqual(document.activeElement, toggle(), 'focus is back on the square');
    assert.strictEqual(toggle()?.getAttribute('aria-label'), 'Search tasks: bug', 'the name carries the value');

    await click(toggle() as HTMLElement);
    assert.strictEqual(input()?.value, 'bug', 'the value survives the round trip');
  });

  test("@display 'collapsed' stays closed when focused and opens on click only", async function (assert) {
    await render(<template><SearchInput @display='collapsed' /></template>);
    await focus(toggle() as HTMLElement);
    assert.strictEqual(input(), null, 'focus alone does not open it');
    await click(toggle() as HTMLElement);
    assert.ok(input(), 'a click does');
  });

  test('Escape does not bubble past the open field', async function (assert) {
    let seen = false;
    let spy = () => (seen = true);
    document.addEventListener('keydown', spy);
    try {
      await render(<template><SearchInput @display='collapsed' /></template>);
      await click(toggle() as HTMLElement);
      await triggerKeyEvent(input() as HTMLInputElement, 'keydown', 'Escape');
      assert.false(seen, 'the Escape stops at the field');
    } finally {
      document.removeEventListener('keydown', spy);
    }
  });

  test('clear keeps focus in the field', async function (assert) {
    await render(<template><SearchInput @value='bug' /></template>);
    await click('[data-test-pretui-search-clear]');
    assert.strictEqual(document.activeElement, input(), 'default field');
  });

  test('the input is named from its placeholder', async function (assert) {
    await render(<template><SearchInput @placeholder='Search tasks' /></template>);
    assert.strictEqual(input()?.getAttribute('aria-label'), 'Search tasks');
  });
});
