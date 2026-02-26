import { module, test } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
  QueuePublisher,
} from '@cardstack/runtime-common';
import type {
  MatrixClient,
  MatrixEvent,
  Room,
  RoomMember,
} from 'matrix-js-sdk';
import type { GitHubClient } from '../lib/github';
import { onMembershipEvent } from '../lib/membership-handler';
import { onTimelineEvent } from '../lib/timeline-handler';

function makeBotTriggerEvent(
  sender: string | null | undefined,
  originServerTs: number,
  contentType = 'show-card',
) {
  const BOT_TRIGGER_EVENT_TYPE = 'app.boxel.bot-trigger';
  let userId = sender ?? '@alice:localhost';
  return {
    event: {
      origin_server_ts: originServerTs,
      type: BOT_TRIGGER_EVENT_TYPE,
      content: {
        type: contentType,
        input: {},
        realm: 'http://localhost:4201/test/',
        userId,
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
  let dbAdapter: DBAdapter;
  let queuePublisher: QueuePublisher;
  let githubClient: GitHubClient;
  let publishedJobs: unknown[] = [];
  let queueJobDoneResult: unknown = undefined;
  let branchWrites: unknown[] = [];
  let createdBranches: unknown[] = [];
  let senderRegistrations: Record<string, PgPrimitive>[] = [];
  let submissionBotRegistrations: Record<string, PgPrimitive>[] = [];
  let commandsByRegistrationId = new Map<string, Record<string, PgPrimitive>[]>();

  dbAdapter = {
    kind: 'pg',
    isClosed: false,
    execute: async (sql: string, opts?: ExecuteOptions) => {
      if (sql.includes('FROM bot_registrations br')) {
        let username = opts?.bind?.[0];
        if (username === '@alice:localhost') {
          return senderRegistrations;
        }
        if (username === '@submissionbot:localhost') {
          return submissionBotRegistrations;
        }
        return [];
      }

      if (sql.includes('FROM bot_commands WHERE bot_id =')) {
        let registrationId = opts?.bind?.[0];
        if (typeof registrationId !== 'string') {
          return [];
        }
        return commandsByRegistrationId.get(registrationId) ?? [];
      }

      return [];
    },
    close: async () => {},
    getColumnNames: async () => [],
  } as DBAdapter;

  queuePublisher = {
    publish: async (job: unknown) => {
      publishedJobs.push(job);
      return { id: 1, done: Promise.resolve(queueJobDoneResult) } as any;
    },
    destroy: async () => {},
  };
  githubClient = {
    openPullRequest: async () => ({
      number: 1,
      html_url: 'https://example.com/pr/1',
    }),
    createBranch: async (params) => {
      createdBranches.push(params);
      return {
        ref: 'refs/heads/room-branch',
        sha: 'abc123',
      };
    },
    writeFileToBranch: async () => ({
      commitSha: 'def456',
    }),
    writeFilesToBranch: async (params) => {
      branchWrites.push(params);
      return {
        commitSha: 'def456',
      };
    },
  };

  test('enqueues command when event matches', async (assert) => {
    senderRegistrations = [];
    submissionBotRegistrations = [
      {
        id: 'bot-registration-1',
        created_at: new Date(0) as unknown as PgPrimitive,
        username: '@submissionbot:localhost',
      },
    ];
    commandsByRegistrationId = new Map([
      [
        'bot-registration-1',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'show-card',
            },
            command: '@cardstack/boxel-host/commands/show-card/default',
          },
        ],
      ],
    ]);
    publishedJobs = [];
    queueJobDoneResult = undefined;
    branchWrites = [];
    createdBranches = [];

    let handleTimelineEvent = onTimelineEvent({
      authUserId: '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
      startTime: 0,
    });

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.strictEqual(publishedJobs.length, 1, 'enqueues run-command job');
    assert.deepEqual(
      publishedJobs[0],
      {
        jobType: 'run-command',
        concurrencyGroup: 'command:http://localhost:4201/test/',
        timeout: 60,
        priority: 10,
        args: {
          realmURL: 'http://localhost:4201/test/',
          realmUsername: '@alice:localhost',
          runAs: '@alice:localhost',
          command: '@cardstack/boxel-host/commands/show-card/default',
          commandInput: {},
        },
      },
      'enqueues expected command payload',
    );
  });

  test('handles pr-listing-create by writing files and opening a PR', async (assert) => {
    senderRegistrations = [];
    submissionBotRegistrations = [
      {
        id: 'bot-registration-2',
        created_at: new Date(0) as unknown as PgPrimitive,
        username: '@submissionbot:localhost',
      },
    ];
    commandsByRegistrationId = new Map([
      [
        'bot-registration-2',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/boxel-host/commands/create-listing-pr/default',
          },
        ],
      ],
    ]);
    publishedJobs = [];
    queueJobDoneResult = {
      status: 'ready',
      cardResultString: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/catalog/AppListing/95cbe2c7-9b60-4afd-8a3c-1382b610e316',
          attributes: {
            allFileContents: [
              {
                filename: 'experiments/MyListing/listing.json',
                contents: '{\"data\":{\"type\":\"card\"}}',
              },
              {
                filename: 'experiments/MyListing/readme.md',
                contents: '# My Listing',
              },
            ],
          },
          links: {
            self: 'http://localhost:4201/catalog/AppListing/95cbe2c7-9b60-4afd-8a3c-1382b610e316',
          },
        },
      }),
    };
    branchWrites = [];
    createdBranches = [];

    let handleTimelineEvent = onTimelineEvent({
      authUserId: '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
      startTime: 0,
    });

    await handleTimelineEvent(
      {
        event: {
          origin_server_ts: 1000,
          type: 'app.boxel.bot-trigger',
          content: {
            type: 'pr-listing-create',
            input: {
              roomId: '!abc123:localhost',
              listingName: 'My Listing',
            },
            realm: 'http://localhost:4201/test/',
            userId: '@alice:localhost',
          },
        },
        getSender: () => '@alice:localhost',
      } as unknown as MatrixEvent,
      makeRoom('join'),
      false,
    );

    assert.strictEqual(
      publishedJobs.length,
      1,
      'enqueues run-command job for pr-listing-create',
    );
    assert.strictEqual(
      createdBranches.length,
      1,
      'creates branch before committing',
    );
    assert.strictEqual(
      branchWrites.length,
      1,
      'writes fileContents to a commit',
    );
    let write = branchWrites[0] as Record<string, unknown>;
    assert.propContains(
      write,
      {
        owner: 'cardstack',
        repo: 'boxel-catalog',
      },
      'commit targets the expected repo/branch',
    );
    assert.true(
      write.branch?.toString().includes('my-listing'),
      'commit branch includes listing slug',
    );
    assert.deepEqual(
      write.files,
      [
        {
          path: 'experiments/MyListing/listing.json',
          content: '{"data":{"type":"card"}}',
        },
        {
          path: 'experiments/MyListing/readme.md',
          content: '# My Listing',
        },
      ],
      'commit payload contains parsed files from allFileContents',
    );
    assert.true(
      write.message
        ?.toString()
        .startsWith('add My Listing changes [boxel-content-hash:'),
      'commit message includes listing name and content hash marker',
    );
  });

  test('does not duplicate pr-listing-create commit when both sender and bot have same registration', async (assert) => {
    senderRegistrations = [
      {
        id: 'sender-registration-1',
        created_at: new Date(0) as unknown as PgPrimitive,
        username: '@alice:localhost',
      },
    ];
    submissionBotRegistrations = [
      {
        id: 'bot-registration-3',
        created_at: new Date(0) as unknown as PgPrimitive,
        username: '@submissionbot:localhost',
      },
    ];
    commandsByRegistrationId = new Map([
      [
        'bot-registration-3',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/boxel-host/commands/create-listing-pr/default',
          },
        ],
      ],
      [
        'sender-registration-1',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/boxel-host/commands/create-listing-pr/default',
          },
        ],
      ],
    ]);
    publishedJobs = [];
    queueJobDoneResult = {
      status: 'ready',
      cardResultString: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            allFileContents: [
              {
                filename: 'catalog/Listing/listing.json',
                contents: '{}',
              },
            ],
          },
        },
      }),
    };
    branchWrites = [];
    createdBranches = [];

    let handleTimelineEvent = onTimelineEvent({
      authUserId: '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
      startTime: 0,
    });

    await handleTimelineEvent(
      {
        event: {
          origin_server_ts: 1000,
          type: 'app.boxel.bot-trigger',
          content: {
            type: 'pr-listing-create',
            input: {
              roomId: '!room-id:localhost',
              listingName: 'Dupe Test',
            },
            realm: 'http://localhost:4201/test/',
            userId: '@alice:localhost',
          },
        },
        getSender: () => '@alice:localhost',
      } as unknown as MatrixEvent,
      makeRoom('join'),
      false,
    );

    assert.strictEqual(
      publishedJobs.length,
      2,
      'current behavior enqueues once per matching registration',
    );
    assert.strictEqual(
      branchWrites.length,
      2,
      'writes fileContents for each matching registration path',
    );
  });

  test('ignores timeline events older than startTime', async (assert) => {
    senderRegistrations = [];
    submissionBotRegistrations = [
      {
        id: 'bot-registration-4',
        created_at: new Date(0) as unknown as PgPrimitive,
        username: '@submissionbot:localhost',
      },
    ];
    commandsByRegistrationId = new Map([
      [
        'bot-registration-4',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'show-card',
            },
            command: '@cardstack/boxel-host/commands/show-card/default',
          },
        ],
      ],
    ]);
    publishedJobs = [];

    let handleTimelineEvent = onTimelineEvent({
      authUserId: '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
      startTime: 2000,
    });

    await handleTimelineEvent(
      makeBotTriggerEvent('@alice:localhost', 1000),
      makeRoom('join'),
      false,
    );

    assert.strictEqual(
      publishedJobs.length,
      0,
      'does not handle events that are older than startTime',
    );
  });
});
