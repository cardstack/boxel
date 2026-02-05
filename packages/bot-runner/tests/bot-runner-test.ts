import { module, test } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
} from '@cardstack/runtime-common';
import type {
  MatrixClient,
  MatrixEvent,
  Room,
  RoomMember,
} from 'matrix-js-sdk';
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

function makeRoom(membership: string, creator = '@alice:localhost') {
  return {
    getMyMembership: () => membership,
    getCreator: () => creator,
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
    authUserId: '@submissionbot:localhost',
    startTime: 1000,
  });

  test('auto-joins room after membership invite event for submissionbot', async (assert) => {
    joinedRooms = [];

    await handleMembershipEvent(
      makeMembershipEvent(1001),
      makeMember({
        membership: 'invite',
        userId: '@submissionbot:localhost',
        roomId: '!room-id:localhost',
        name: 'submissionbot',
      }),
    );

    assert.deepEqual(
      joinedRooms,
      ['!room-id:localhost'],
      'joins the invited room for the bot user',
    );
  });
});

module('timeline handler', () => {
  let currentRows: Record<string, PgPrimitive>[] = [];
  let registrationsHook:
    | ((sql: string, opts?: ExecuteOptions) => void)
    | undefined;
  let dbAdapter: DBAdapter;
  let handleTimelineEvent: ReturnType<typeof onTimelineEvent>;

  dbAdapter = {
    kind: 'pg',
    isClosed: false,
    execute: async (_sql: string, opts?: ExecuteOptions) => {
      registrationsHook?.(_sql, opts);
      return currentRows;
    },
    close: async () => {},
    getColumnNames: async () => [],
  } as DBAdapter;

  handleTimelineEvent = onTimelineEvent({
    authUserId: '@submissionbot:localhost',
    dbAdapter,
  });

  function mockGetRegistrations(
    onRows: (rows: Record<string, PgPrimitive>[]) => void,
  ) {
    registrationsHook = (sql) => {
      if (
        sql !==
        'SELECT br.id, br.username, br.created_at FROM bot_registrations br WHERE br.username =  $1'
      ) {
        return;
      }
      onRows(currentRows);
    };
  }

  test('loads registrations for sender and ignores if none', async (assert) => {
    assert.expect(1);
    currentRows = [];
    mockGetRegistrations(() => {});

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.deepEqual(currentRows, [], 'loads registrations');
  });

  test('filters events older than registration created_at', async (assert) => {
    assert.expect(1);
    currentRows = [
      {
        id: '1',
        created_at: new Date(2000).toISOString(),
        username: '@alice:localhost',
      },
    ];

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.ok(true, 'loads registrations');
  });
});
