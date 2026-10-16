import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  APP_BOXEL_COMPACTION_EVENT_TYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
  LEGACY_APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import {
  collectUsedToolCallIds,
  MAX_CARRIED_TOOL_CALL_IDS,
  ToolCallIds,
  toolCallIdsToCarry,
} from '../lib/tool-call-ids.ts';

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

  test('suffixes past the highest suffix in use, not the lowest free one', (assert) => {
    let ids = new ToolCallIds(['x:0', 'x:0_3']);
    assert.strictEqual(ids.idFor(0, 'x:0'), 'x:0_4');
  });

  test('collects the ids a compaction carries for the history before its cut', (assert) => {
    // The history starts at the cut; x:0 and x:0_4 were used before it.
    let window = [
      {
        type: APP_BOXEL_COMPACTION_EVENT_TYPE,
        content: {
          status: 'done',
          upToEventId: 'cut',
          summary: 'summary',
          usedToolCallIds: ['x:0', 'x:0_4'],
        },
      },
      { type: 'app.boxel.toolResult', content: { commandRequestId: 'y:0' } },
      {
        type: APP_BOXEL_COMPACTION_EVENT_TYPE,
        content: { status: 'failed', usedToolCallIds: ['z:0'] },
      },
    ] as any;
    let used = collectUsedToolCallIds(window);
    assert.deepEqual([...used], ['x:0', 'x:0_4', 'y:0']);
    assert.strictEqual(new ToolCallIds(used).idFor(0, 'x:0'), 'x:0_5');
  });

  test('carries each used id with only its highest suffix', (assert) => {
    assert.deepEqual(
      toolCallIdsToCarry(['x:0', 'x:0_1', 'y:0', 'x:0_2', 'call_1', 'call_2']),
      ['x:0', 'y:0', 'x:0_2', 'call_1', 'call_2'],
      'ids that only look suffixed, with no base id, are all kept',
    );
  });

  test('carries at most MAX_CARRIED_TOOL_CALL_IDS ids, the most recent', (assert) => {
    let used = Array.from(
      { length: MAX_CARRIED_TOOL_CALL_IDS + 10 },
      (_, i) => `call-${i}`,
    );
    let carried = toolCallIdsToCarry(used);
    assert.strictEqual(carried.length, MAX_CARRIED_TOOL_CALL_IDS);
    assert.strictEqual(carried.at(-1), used.at(-1));
    assert.strictEqual(carried[0], 'call-10');
  });

  test('a base id stays carried as long as its highest suffix is', (assert) => {
    // `x:0` and `x:0_9` are oldest and most recent: dropping the oldest ids
    // one by one would drop `x:0` and keep `x:0_9`, and the next `x:0` would
    // be issued as `x:0` again.
    let used = [
      'x:0',
      ...Array.from({ length: MAX_CARRIED_TOOL_CALL_IDS }, (_, i) => `c-${i}`),
      'x:0_9',
    ];
    let carried = toolCallIdsToCarry(used);
    assert.true(carried.length <= MAX_CARRIED_TOOL_CALL_IDS);
    assert.strictEqual(carried[0], 'x:0');
    assert.strictEqual(carried.at(-1), 'x:0_9');
    assert.false(carried.includes('c-0'));
    assert.true(carried.includes(`c-${MAX_CARRIED_TOOL_CALL_IDS - 1}`));
    assert.strictEqual(
      new ToolCallIds(carried).idFor(0, 'x:0'),
      'x:0_10',
      'the next x:0 is suffixed past the carried highest suffix',
    );
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
