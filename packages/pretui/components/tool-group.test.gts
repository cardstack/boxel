// Pretui — ToolGroup unit tests: which calls merge into one row.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ToolGroup } from './tool-group';
import type { ToolPart } from './tool-group';

module('Pretui | components/tool-group', function (hooks) {
  setupCardTest(hooks);

  test('a call that needs the reader keeps its own row instead of folding into a merged one', async function (assert) {
    const tools: ToolPart[] = [
      { id: 'a', name: 'read_file', kind: 'read', state: 'completed', subtitle: 'a.gts' },
      { id: 'b', name: 'read_file', kind: 'read', state: 'awaiting-approval', subtitle: 'b.gts' },
      { id: 'c', name: 'read_file', kind: 'read', state: 'completed', subtitle: 'c.gts' },
    ];
    await render(<template><ToolGroup @tools={{tools}} /></template>);
    await settled();
    assert.dom('[data-test-pretui-tool-group]').hasAttribute('data-open', 'true', 'the call that needs the reader opens the group');
    assert.dom('[data-test-pretui-tool-group-rows] [data-test-pretui-tool-row]').exists({ count: 3 });
    assert.dom('[data-test-pretui-tool-group-rows] [data-merged]').doesNotExist();
    assert.dom('[data-transcript-id="b"]').hasAttribute('data-tone', 'attention');
  });

  test('settled reads still merge', async function (assert) {
    const tools: ToolPart[] = [
      { id: 'a', name: 'read_file', kind: 'read', state: 'completed', subtitle: 'a.gts' },
      { id: 'b', name: 'read_file', kind: 'read', state: 'completed', subtitle: 'b.gts' },
    ];
    await render(<template><ToolGroup @tools={{tools}} @defaultOpen={{true}} /></template>);
    await settled();
    assert.dom('[data-test-pretui-tool-group-rows] [data-test-pretui-tool-row]').exists({ count: 1 });
    assert.dom('[data-test-pretui-tool-group-rows] [data-merged]').exists();
  });

  test('the names list joins in English, whatever the browser locale', async function (assert) {
    const tools: ToolPart[] = [
      { id: 'a', name: 'read', state: 'completed' },
      { id: 'b', name: 'search', state: 'completed' },
      { id: 'c', name: 'patch_fields', state: 'completed' },
    ];
    await render(<template><ToolGroup @tools={{tools}} @phrasing='names' /></template>);
    assert.dom('[data-test-pretui-tool-group-names]').hasText('Read, Search, and Patch fields');
  });
});
