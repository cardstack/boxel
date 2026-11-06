import { click, render, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { Select } from '@cardstack/pretui/components/select';

// Labels far wider than any window, so the list's max-content floor would run
// past the window's edge.
const OPTIONS = [
  { value: 'a', label: 'Personal notes', meta: 'x'.repeat(4000) },
  { value: 'b', label: 'Personal notes', meta: 'y'.repeat(4000) },
];

// Pret UI's Select as the key pages use it, with the styles the secure origin
// builds: an open list wider than the room right of where it opens is held to
// that room, so it never runs past the window.
module('Integration | Pret UI Select in the window', function (hooks) {
  setupRenderingTest(hooks);

  test('an open list wider than the window is held inside it', async function (assert) {
    await render(
      <template>
        <Select @options={{OPTIONS}} @searchEnabled={{true}} />
      </template>,
    );
    await click('[data-test-pretui-select-trigger]');
    let list = document.querySelector<HTMLElement>('.pretui-select-dropdown')!;
    assert.ok(list, 'the list is open');
    await waitUntil(() => list.style.getPropertyValue('max-width') !== '');
    let { right } = list.getBoundingClientRect();
    assert.true(
      right <= document.documentElement.clientWidth,
      `the list ends inside the window (${Math.round(right)} of ${document.documentElement.clientWidth}px)`,
    );
  });
});
