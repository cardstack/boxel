// Pretui — focused render proof for the foundation usage pages.
// Local-only: do not upload test files to the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DEMOS_AVATAR_GROUP } from './components/avatar-group.usage';
import { DEMOS_CHECKBOX } from './components/checkbox.usage';
import { DEMOS_DATA_GRID } from './components/data-grid.usage';
import { DEMOS_DELTA } from './components/delta.usage';
import { DEMOS_PAGINATION } from './components/pagination.usage';
import { DEMOS_PASSWORD_STRENGTH } from './components/password-strength.usage';
import { DEMOS_SLIDER } from './components/slider.usage';
import { DEMOS_TABLE } from './components/table.usage';
import { DEMOS_TOKEN } from './components/token.usage';

type AnyComponent = any;

// Pages are looked up by component name through the merged loadable registry
// (which throws on a duplicate key), so this test does not care which module
// a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_AVATAR_GROUP, ...DEMOS_CHECKBOX, ...DEMOS_DATA_GRID, ...DEMOS_DELTA, ...DEMOS_PAGINATION, ...DEMOS_PASSWORD_STRENGTH, ...DEMOS_SLIDER, ...DEMOS_TABLE, ...DEMOS_TOKEN };
const NAMES = ['AvatarGroup', 'DataGrid', 'Delta', 'Pagination', 'PasswordStrength', 'Table', 'Token', 'Checkbox', 'Slider'];

module('Pretui | foundation usage pages', function (hooks) {
  setupCardTest(hooks);
  for (let name of NAMES) {
    test(`${name} mounts with representative data`, async function (assert) {
      let Demo = PAGES[name] as AnyComponent;
      await render(<template><Demo /></template>);
      assert.ok(document.querySelector('.FreestyleUsage'), `${name} rendered`);
      assert.notOk(
        document.body.textContent?.includes('There is no JSON to display.'),
        `${name} has no empty object fixture`,
      );
    });
  }
});
