// Pretui — ToolChangeTable unit tests: "Show N more" and where focus goes.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ToolChangeTable } from './tool-change-table';
import type { ToolChangeRow } from './tool-change-table';

module('Pretui | components/tool-change-table', function (hooks) {
  setupCardTest(hooks);

  test('"Show N more" reveals the rest and moves focus to the first row it revealed', async function (assert) {
    const rows: ToolChangeRow[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((card) => ({ card, change: 'Became a Regular' }));
    await render(<template><ToolChangeTable @rows={{rows}} /></template>);
    assert.dom('[data-test-pretui-tool-change-row]').exists({ count: 4 });
    assert.dom('[data-test-pretui-tool-change-table-more]').hasText('Show 2 more');
    await click('[data-test-pretui-tool-change-table-more]');
    assert.dom('[data-test-pretui-tool-change-row]').exists({ count: 6 });
    assert.dom('[data-test-pretui-tool-change-table-more]').doesNotExist();
    assert.strictEqual(document.activeElement, document.querySelector('[data-test-pretui-tool-change-row="E"]'), 'focus lands on the first new row');
  });
});
