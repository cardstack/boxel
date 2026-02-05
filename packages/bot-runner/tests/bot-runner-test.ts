import { module, test } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
} from '@cardstack/runtime-common';
import type { MatrixClient, MatrixEvent, Room, RoomMember } from 'matrix-js-sdk';
import { onMembershipEvent } from '../lib/membership-handler';
import { onTimelineEvent } from '../lib/timeline-handler';

function makeBotTriggerEvent(
  sender: string | null | undefined,
  originServerTs: number,
) {
  return {
    event: {
      origin_server_ts: originServerTs,
      type: 'app.boxel.bot-trigger',
      content: {
        type: 'create-listing-pr',
        input: {},
      },
    },
    getSender: () => sender,
  } as unknown as MatrixEvent;
}

function makeRoom(membership: string) {
  return {
    getMyMembership: () => membership,
  } as unknown as Room;
}

function makeMembershipEvent(originServerTs: number) {
  return {
    event: {
      origin_server_ts: originServerTs,
    },
  } as unknown as MatrixEvent;
}

function makeMember(member: Partial<RoomMember>): RoomMember {
  return member as RoomMember;
}

function makeMatrixClient(client: Partial<MatrixClient>): MatrixClient {
  return client as MatrixClient;
}

module('membership handler', () => {
  let joinedRooms: string[] = [];
  let handleMembershipEvent = onMembershipEvent({
    client: makeMatrixClient({
      joinRoom: async (roomId: string) => {
        joinedRooms.push(roomId);
        return makeRoom('join');
      },
    }),
    authUserId: '@bot-runner:localhost',
    startTime: 1000,
  });

  test('auto-joins room after membership invite event for bot-runner', async (assert) => {
    joinedRooms = [];

    await handleMembershipEvent(makeMembershipEvent(1001), makeMember({
      membership: 'invite',
      userId: '@bot-runner:localhost',
      roomId: '!room-id:localhost',
      name: 'bot-runner',
    }));

    assert.deepEqual(
      joinedRooms,
      ['!room-id:localhost'],
      'joins the invited room for the bot user',
    );
  });
});

module('timeline handler', () => {
  let currentRows: Record<string, PgPrimitive>[] = [];
  let executeHook: ((opts?: ExecuteOptions) => void) | undefined;
  let dbAdapter: DBAdapter;
  let handleTimelineEvent: ReturnType<typeof onTimelineEvent>;

  dbAdapter = {
    kind: 'pg',
    isClosed: false,
    execute: async (_sql: string, opts?: ExecuteOptions) => {
      executeHook?.(opts);
      return currentRows;
    },
    close: async () => {},
    getColumnNames: async () => [],
  } as DBAdapter;

  handleTimelineEvent = onTimelineEvent({
    authUserId: '@bot-runner:localhost',
    dbAdapter,
  });

  test('loads registrations for sender and ignores if none', async (assert) => {
    assert.expect(2);
    let requestedUser: string | undefined;
    let executedCount = 0;
    currentRows = [];
    executeHook = (opts) => {
      requestedUser = opts?.bind?.[0] as string | undefined;
      executedCount += 1;
    };

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.strictEqual(
      requestedUser,
      '@alice:localhost',
      'loads registrations for sender',
    );
    assert.strictEqual(executedCount, 1, 'loads registrations once');
  });

  test('filters events older than registration created_at', async (assert) => {
    assert.expect(1);
    let executedCount = 0;
    currentRows = [
      {
        id: '1',
        created_at: new Date(2000).toISOString(),
        username: '@alice:localhost',
      },
    ];
    executeHook = () => {
      executedCount += 1;
    };

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.strictEqual(executedCount, 1, 'loads registrations once');
  });

  test('filters events for unregistered users', async (assert) => {
    assert.expect(1);
    let wasExecuted = false;
    currentRows = [];
    executeHook = () => {
      wasExecuted = true;
    };

    await handleTimelineEvent(
      makeBotTriggerEvent('@bot-runner:localhost', 2000),
      makeRoom('join'),
      false,
    );

    assert.notOk(wasExecuted, 'skips bot events before registration lookup');
  });
});
