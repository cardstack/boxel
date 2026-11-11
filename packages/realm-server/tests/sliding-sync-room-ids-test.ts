import QUnit from 'qunit';
import { basename } from 'path';
import { slidingSyncRoomIds } from '@cardstack/runtime-common/sliding-sync-room-ids';
const { module, test } = QUnit;

module(basename(import.meta.filename), function () {
  test('Tuwunel simplified sync classifies rooms without list operations', function (assert) {
    assert.deepEqual(
      slidingSyncRoomIds(
        {
          lists: { ai: { count: 2 }, auth: { count: 1 } },
          rooms: {
            '!one': { lists: ['ai'], timeline: [] },
            '!two': { lists: ['ai'] },
            '!private-auth': { lists: ['auth'] },
          },
        },
        'ai',
      ),
      ['!one', '!two'],
    );
  });
  test('legacy operations are combined and deduplicated', function (assert) {
    assert.deepEqual(
      slidingSyncRoomIds(
        {
          lists: {
            ai: {
              ops: [
                { op: 'SYNC', room_ids: ['!one', '!two'] },
                { op: 'INSERT', room_id: '!three' },
                { op: 'SYNC', room_ids: ['!two'] },
              ],
            },
          },
          rooms: { '!three': { lists: ['ai'] } },
        },
        'ai',
      ),
      ['!one', '!two', '!three'],
    );
  });
  test('malformed and unrelated membership cannot become AI rooms', function (assert) {
    assert.deepEqual(slidingSyncRoomIds(null, 'ai'), []);
    assert.deepEqual(
      slidingSyncRoomIds(
        {
          lists: { ai: { ops: [null, { room_ids: [42] }] } },
          rooms: { '!auth': { lists: ['auth'] } },
        },
        'ai',
      ),
      [],
    );
  });
});
