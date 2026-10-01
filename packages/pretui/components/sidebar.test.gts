// Pretui — Sidebar unit tests for the drawer's own state, the pinned rail
// and the shortcut's routing between several sidebars.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render, settled, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Sidebar } from './sidebar';

function shells(): HTMLElement[] {
  return [...document.querySelectorAll('[data-test-pretui-sidebar]')] as HTMLElement[];
}

module('Pretui | components/sidebar', function (hooks) {
  setupCardTest(hooks);

  test('in mobile mode the drawer starts closed', async function (assert) {
    await render(<template><Sidebar @mobile={{true}} @label='Library'><:nav>Lots</:nav></Sidebar></template>);
    assert.notOk(document.querySelector('[data-test-pretui-sidebar] dialog[open]'), 'no modal opens on the first render');
  });

  test('a pinned rail stays open: the shortcut does nothing', async function (assert) {
    await render(<template><Sidebar @collapsible='none' @label='Library'><:nav>Lots</:nav></Sidebar></template>);
    let before = shells()[0]?.dataset['state'];
    await triggerKeyEvent(document.body, 'keydown', 'B', { metaKey: true });
    await settled();
    assert.strictEqual(shells()[0]?.dataset['state'], before, 'the state did not flip');
  });

  test('with two sidebars, one press toggles the one that holds focus', async function (assert) {
    await render(<template>
      <Sidebar @label='Shell'><:nav><button type='button' class='t-outer'>Outer</button></:nav></Sidebar>
      <Sidebar @label='Inspector'><:nav><button type='button' class='t-inner'>Inner</button></:nav></Sidebar>
    </template>);
    let [outer, inner] = shells();
    let outerBefore = outer?.dataset['state'];
    let innerBefore = inner?.dataset['state'];
    (document.querySelector('.t-inner') as HTMLElement).focus();
    await triggerKeyEvent(document.querySelector('.t-inner') as HTMLElement, 'keydown', 'B', { metaKey: true });
    await settled();
    assert.strictEqual(outer?.dataset['state'], outerBefore, 'the other rail is untouched');
    assert.notStrictEqual(inner?.dataset['state'], innerBefore, 'the focused one toggled');
  });

  test('with focus in neither, one press toggles exactly one', async function (assert) {
    await render(<template>
      <Sidebar @label='A'><:nav>A</:nav></Sidebar>
      <Sidebar @label='B'><:nav>B</:nav></Sidebar>
    </template>);
    let before = shells().map((s) => s.dataset['state']);
    await triggerKeyEvent(document.body, 'keydown', 'B', { metaKey: true });
    await settled();
    let after = shells().map((s) => s.dataset['state']);
    let changed = after.filter((state, i) => state !== before[i]).length;
    assert.strictEqual(changed, 1);
  });
});
