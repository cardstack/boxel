import { click, render, settled, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { Select } from '@cardstack/pretui/components/select';

// Two workspaces with the same name, told apart by their addresses, as the
// key pages' workspace picker lists them.
const OPTIONS = [
  {
    value: 'https://realm-server.test/example-user/personal-notes/',
    label: 'Personal notes',
    meta: 'realm-server.test/example-user/personal-notes/',
  },
  {
    value: 'https://realm-server.test/example-team-name/personal-notes/',
    label: 'Personal notes',
    meta: 'realm-server.test/example-team-name/personal-notes/',
  },
];

function nextFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

// Pret UI's Select as the key pages use it, with the shell's page-wide rules
// and the styles the secure origin builds, laid out in the page's own flow: a
// narrow picker at the window's right edge. The list's max-content floor is
// wider than the room right of where it opens, so without the hold it would
// run past the window, and focusing its search box would scroll the page
// sideways.
module('Integration | Pret UI Select in the window', function (hooks) {
  setupRenderingTest(hooks);

  let saved: [HTMLElement, string][] = [];
  hooks.beforeEach(function () {
    // ember-qunit's container is a fixed, scaled box; the key pages are laid
    // out in the page itself.
    saved = ['ember-testing-container', 'ember-testing'].map((id) => {
      let element = document.getElementById(id)!;
      let css = element.style.cssText;
      for (let [property, value] of [
        ['position', 'static'],
        ['width', 'auto'],
        ['height', 'auto'],
        ['overflow', 'visible'],
        ['transform', 'none'],
        ['zoom', '1'],
      ]) {
        element.style.setProperty(property!, value!, 'important');
      }
      return [element, css];
    });
  });
  hooks.afterEach(function () {
    for (let [element, css] of saved) {
      element.style.cssText = css;
    }
    window.scrollTo(0, 0);
  });

  test('a narrow picker at the window’s right edge opens its list inside the window, and the page stays put', async function (assert) {
    await render(
      <template>
        <div data-test-column>
          <Select @options={{OPTIONS}} @searchEnabled={{true}} />
        </div>
      </template>,
    );
    let column = document.querySelector<HTMLElement>('[data-test-column]')!;
    column.style.setProperty('width', '12rem');
    column.style.setProperty('margin-inline-start', 'auto');
    window.scrollTo(0, 0);
    let trigger = '[data-test-pretui-select-trigger]';
    let before = document.querySelector(trigger)!.getBoundingClientRect();

    await click(trigger);
    let list = document.querySelector<HTMLElement>('.pretui-select-dropdown')!;
    assert.ok(list, 'the list is open');
    await waitUntil(() =>
      document.activeElement?.matches('input[type=search]'),
    );
    await nextFrames();
    await settled();

    let after = document.querySelector(trigger)!.getBoundingClientRect();
    let { right } = list.getBoundingClientRect();
    let edge = document.documentElement.clientWidth;
    assert.true(
      right <= edge,
      `the list ends inside the window (${Math.round(right)} of ${edge}px)`,
    );
    assert.strictEqual(window.scrollX, 0, 'the page hasn’t scrolled sideways');
    assert.strictEqual(
      Math.round(after.left),
      Math.round(before.left),
      'the trigger hasn’t moved',
    );
  });
});
