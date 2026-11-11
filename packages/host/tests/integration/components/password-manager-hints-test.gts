import { click, render } from '@ember/test-helpers';

import { ignoredByPasswordManagers as baseHints } from '@cardstack/base/components/password-managers';
import { ignoredByPasswordManagers as pretuiHints } from '@cardstack/pretui/password-managers';
import { module, test } from 'qunit';

import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

import { setupRenderingTest } from '../../helpers/setup';

// The hint list has three copies: Pret UI's modifier, base's own copy of it,
// and the attributes boxel-ui's Picker writes into its search field. Each hint
// is a data attribute, and these controls carry no other data attribute but
// test hooks and scoped-CSS markers.
function hintsOn(selector: string): Record<string, string> {
  let el = document.querySelector(selector);
  if (!el) {
    throw new Error(`no element matches ${selector}`);
  }
  let hints: Record<string, string> = {};
  for (let { name, value } of Array.from(el.attributes)) {
    if (
      name.startsWith('data-') &&
      !name.startsWith('data-test-') &&
      !name.startsWith('data-scopedcss-')
    ) {
      hints[name] = value;
    }
  }
  return hints;
}

const OPTIONS: PickerOption[] = [
  { id: 'all', label: 'All realms', type: 'select-all' },
  { id: 'one', label: 'One realm' },
];
const NO_SELECTION: PickerOption[] = [];
function noop() {}

module('Integration | password-manager hints', function (hooks) {
  setupRenderingTest(hooks);

  test('every copy of the hint list sets the same attributes', async function (assert) {
    await render(
      <template>
        <input aria-label='Pret UI' data-test-hinted='pretui' {{pretuiHints}} />
        <input aria-label='Base' data-test-hinted='base' {{baseHints}} />
        <Picker
          @options={{OPTIONS}}
          @selected={{NO_SELECTION}}
          @onChange={{noop}}
          @label='Realms'
        />
      </template>,
    );
    await click('[data-test-boxel-picker-trigger]');

    let pretui = hintsOn('[data-test-hinted="pretui"]');
    assert.true(
      Object.keys(pretui).length > 0,
      "Pret UI's modifier sets hints",
    );
    assert.deepEqual(
      hintsOn('[data-test-hinted="base"]'),
      pretui,
      "base's copy sets the same hints",
    );
    assert.deepEqual(
      hintsOn('[data-test-boxel-picker-search] input'),
      pretui,
      "boxel-ui Picker's search field sets the same hints",
    );
  });
});
