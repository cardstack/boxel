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

  test("@display 'collapsed' opens when tabbed to", async function (assert) {
    await render(<template><SearchInput @display='collapsed' /></template>);
    await focus(toggle() as HTMLElement);
    assert.strictEqual(document.activeElement, input());
    assert.strictEqual(toggle(), null);
  });
});
