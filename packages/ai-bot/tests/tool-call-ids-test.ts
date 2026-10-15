import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import { collectUsedToolCallIds, ToolCallIds } from '../lib/tool-call-ids.ts';

module('tool-call ids', () => {
  test('collects ids from requests, aggregated replacements and results', (assert) => {
    let used = collectUsedToolCallIds([
      {
        type: 'm.room.message',
        content: { [APP_BOXEL_TOOL_REQUESTS_KEY]: [{ id: 'a' }] },
      },
      {
        type: 'm.room.message',
        content: { [LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY]: [{ id: 'b' }] },
      },
      {
        // A streamed answer: the placeholder carries no requests, its latest
        // edit (aggregated by the server) does.
        type: 'm.room.message',
        content: { body: '' },
        unsigned: {
          'm.relations': {
            'm.replace': {
              content: {
                body: '',
                [APP_BOXEL_TOOL_REQUESTS_KEY]: [{ id: 'c' }],
                'm.relates_to': { rel_type: 'm.replace', event_id: '$1' },
              },
            },
          },
        },
      },
      { type: 'app.boxel.toolResult', content: { commandRequestId: 'd' } },
      { type: 'm.room.message', content: { body: 'no calls' } },
    ] as any);
    assert.deepEqual([...used].sort(), ['a', 'b', 'c', 'd']);
  });

  test('keeps an unused id and suffixes a used one until it is unique', (assert) => {
    let ids = new ToolCallIds(['x:0', 'x:0_1']);
    assert.strictEqual(ids.idFor(0, 'y:0'), 'y:0');
    assert.strictEqual(ids.idFor(1, 'x:0'), 'x:0_2');
  });

  test('an assignment is fixed for its position', (assert) => {
    let ids = new ToolCallIds(['x:0']);
    assert.strictEqual(ids.idFor(0, 'x:0'), 'x:0_1');
    assert.strictEqual(ids.idFor(0, 'x:0'), 'x:0_1');
  });

  test('two calls in one reply with the same id get different ids', (assert) => {
    let ids = new ToolCallIds();
    assert.deepEqual(
      ids.apply([{ id: 'x:0' }, { id: 'x:0' }]).map((c) => c.id),
      ['x:0', 'x:0_1'],
    );
  });

  test('a call without an id yet is left alone, and assigned once its id arrives', (assert) => {
    let ids = new ToolCallIds(['x:0']);
    assert.strictEqual(ids.idFor(0, undefined), undefined);
    assert.strictEqual(ids.idFor(0, 'x:0'), 'x:0_1');
  });

  test('apply copies the calls it changes', (assert) => {
    let call = { id: 'x:0', function: { name: 'f' } };
    let [applied] = new ToolCallIds(['x:0']).apply([call]);
    assert.strictEqual(call.id, 'x:0', 'the original is untouched');
    assert.strictEqual(applied.id, 'x:0_1');
    assert.strictEqual(applied.function, call.function);
  });
});
