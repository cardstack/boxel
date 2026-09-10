import type {
  DBAdapter,
  ExecuteOptions,
  Prerenderer,
  QueuePublisher,
  RunCommandResponse,
} from '../index.ts';
import type { SharedTests } from '../helpers/index.ts';
import type { TaskArgs } from '../tasks/index.ts';
import { runCommand } from '../tasks/run-command.ts';

function makeDBAdapter(
  rows: Record<string, unknown>[],
  assertion?: (sql: string, opts?: ExecuteOptions) => void,
): DBAdapter {
  return {
    kind: 'pg',
    notify: async () => {},
    isClosed: false,
    execute: async (sql: string, opts?: ExecuteOptions) => {
      assertion?.(sql, opts);
      return rows as any;
    },
    close: async () => {},
    getColumnNames: async () => [],
    withWriteLock: async (_url, fn) => fn(undefined),
    withUserCostLock: async (_userId, fn) => fn(),
  };
}

function makeTaskArgs({
  dbRows,
  prerenderResult,
  onRunCommand,
  onCreatePrerenderAuth,
  onReportStatus,
}: {
  dbRows: Record<string, unknown>[];
  prerenderResult?: RunCommandResponse;
  onRunCommand?: (args: {
    userId: string;
    auth: string;
    command: string;
    commandInput?: Record<string, any> | null;
  }) => void;
  onCreatePrerenderAuth?: (
    userId: string,
    permissions: Record<string, any>,
  ) => void;
  onReportStatus?: (status: 'start' | 'finish') => void;
}): TaskArgs {
  let prerenderer: Prerenderer = {
    prerenderModule: async () => {
      throw new Error('not used');
    },
    prerenderVisit: async () => {
      throw new Error('not used');
    },
    runCommand: async (args) => {
      onRunCommand?.(args);
      return prerenderResult ?? { status: 'ready', cardResultString: '{}' };
    },
  };

  return {
    dbAdapter: makeDBAdapter(dbRows),
    queuePublisher: {} as QueuePublisher,
    indexWriter: {} as any,
    prerenderer,
    definitionLookup: {} as any,
    virtualNetwork: {} as any,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      trace: () => {},
    } as any,
    matrixURL: 'http://localhost:8008',
    getReader: () => ({}) as any,
    getAuthedFetch: async () => fetch,
    createPrerenderAuth: (userId, permissions) => {
      onCreatePrerenderAuth?.(userId, permissions);
      return 'signed-auth-token';
    },
    reportStatus: (_jobInfo, status) => onReportStatus?.(status),
  };
}

const tests = Object.freeze({
  'returns error when runAs has no realm permissions': async (assert) => {
    assert.expect(4);
    let statuses: Array<'start' | 'finish'> = [];
    let ranPrerender = false;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [],
        onRunCommand: () => {
          ranPrerender = true;
        },
        onReportStatus: (status) => statuses.push(status),
      }),
    );

    let result = await task({
      realmURL: 'http://localhost:4201/experiments',
      realmUsername: '@alice:localhost',
      runAs: '@alice:localhost',
      command: '@cardstack/boxel-host/commands/show-card/default',
      commandInput: {},
      dedupeKey: null,
      jobInfo: { id: 1 } as any,
    });

    assert.strictEqual(result.status, 'error');
    assert.true(
      result.error?.includes('does not have permissions in'),
      'contains permission error message',
    );
    assert.false(ranPrerender, 'does not call prerenderer');
    assert.deepEqual(statuses, ['start', 'finish'], 'reports start/finish');
  },

  'returns error when command specifier is invalid': async (assert) => {
    assert.expect(3);
    let statuses: Array<'start' | 'finish'> = [];
    let ranPrerender = false;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '@alice:localhost',
            realm_url: 'http://localhost:4201/experiments/',
            read: true,
            write: true,
            realm_owner: false,
          },
        ],
        onRunCommand: () => {
          ranPrerender = true;
        },
        onReportStatus: (status) => statuses.push(status),
      }),
    );

    let result = await task({
      realmURL: 'http://localhost:4201/experiments/',
      realmUsername: '@alice:localhost',
      runAs: '@alice:localhost',
      command: '   ',
      commandInput: {},
      dedupeKey: null,
      jobInfo: { id: 2 } as any,
    });

    assert.strictEqual(result.status, 'error');
    assert.false(ranPrerender, 'does not call prerenderer for invalid command');
    assert.deepEqual(statuses, ['start', 'finish'], 'reports start/finish');
  },

  'normalizes legacy /commands URL and defaults export name': async (
    assert,
  ) => {
    assert.expect(4);
    let prerenderCall:
      | {
          userId: string;
          auth: string;
          command: string;
          commandInput?: Record<string, any> | null;
        }
      | undefined;
    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '@alice:localhost',
            realm_url: 'http://localhost:4201/experiments/',
            read: true,
            write: true,
            realm_owner: false,
          },
        ],
        onRunCommand: (args) => {
          prerenderCall = args;
        },
        onCreatePrerenderAuth: (userId, permissions) => {
          authCall = { userId, permissions };
        },
        prerenderResult: { status: 'ready', cardResultString: '{"ok":true}' },
      }),
    );

    let result = await task({
      realmURL: 'http://localhost:4201/experiments',
      realmUsername: '@alice:localhost',
      runAs: '@alice',
      command: 'http://localhost:4200/commands/create-submission',
      commandInput: null,
      dedupeKey: null,
      jobInfo: { id: 3 } as any,
    });

    assert.strictEqual(result.status, 'ready');
    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: { 'http://localhost:4201/experiments/': ['read', 'write'] },
    });
    assert.strictEqual(
      prerenderCall?.command,
      'http://localhost:4201/experiments/commands/create-submission/default',
      'legacy command URL is normalized to realm-local default export',
    );
    assert.strictEqual(
      prerenderCall?.commandInput,
      undefined,
      'null commandInput is converted to undefined',
    );
  },

  'passes scoped command through unchanged': async (assert) => {
    assert.expect(2);
    let prerenderCall:
      | {
          userId: string;
          auth: string;
          command: string;
          commandInput?: Record<string, any> | null;
        }
      | undefined;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '@alice:localhost',
            realm_url: 'http://localhost:4201/experiments/',
            read: true,
            write: true,
            realm_owner: false,
          },
        ],
        onRunCommand: (args) => {
          prerenderCall = args;
        },
      }),
    );

    await task({
      realmURL: 'http://localhost:4201/experiments/',
      realmUsername: '@alice:localhost',
      runAs: '@alice:localhost',
      command: '@cardstack/catalog/commands/create-submission/default',
      commandInput: { listingId: 'http://localhost:4201/catalog/AppListing/1' },
      dedupeKey: null,
      jobInfo: { id: 4 } as any,
    });

    assert.strictEqual(
      prerenderCall?.command,
      '@cardstack/catalog/commands/create-submission/default',
    );
    assert.deepEqual(prerenderCall?.commandInput, {
      listingId: 'http://localhost:4201/catalog/AppListing/1',
      accessibleRealms: ['http://localhost:4201/experiments/'],
    });
  },
  // The realm verifies a session token by comparing its permissions claim
  // against the union of the realm's `users` and `*` grants with the runner's
  // own row, and rejects any difference as a PermissionMismatch. These cover
  // the mint side of that contract.
  'mints the union of the wildcard grant and the runner row': async (
    assert,
  ) => {
    assert.expect(1);
    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '*',
            realm_url: 'http://localhost:4201/experiments/',
            read: true,
            write: false,
            realm_owner: false,
          },
          {
            username: '@alice:localhost',
            realm_url: 'http://localhost:4201/experiments/',
            read: false,
            write: true,
            realm_owner: false,
          },
        ],
        onCreatePrerenderAuth: (userId, permissions) => {
          authCall = { userId, permissions };
        },
      }),
    );

    await task({
      realmURL: 'http://localhost:4201/experiments/',
      realmUsername: '@alice:localhost',
      runAs: '@alice:localhost',
      command: '@cardstack/catalog/commands/noop/default',
      commandInput: {},
      dedupeKey: null,
      jobInfo: { id: 5 } as any,
    });

    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: {
        'http://localhost:4201/experiments/': ['read', 'write'],
      },
    });
  },

  'mints the union of the users grant for a registered matrix user': async (
    assert,
  ) => {
    assert.expect(2);
    let profileRequests: string[] = [];
    let realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      let url = typeof input === 'string' ? input : input.url;
      if (url.includes('/_matrix/client/v3/profile/')) {
        profileRequests.push(url);
        return new Response(JSON.stringify({ displayname: 'Alice' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    try {
      let task = runCommand(
        makeTaskArgs({
          dbRows: [
            {
              username: 'users',
              realm_url: 'http://localhost:4201/experiments/',
              read: true,
              write: false,
              realm_owner: false,
            },
            {
              username: '@alice:localhost',
              realm_url: 'http://localhost:4201/experiments/',
              read: false,
              write: true,
              realm_owner: false,
            },
          ],
          onCreatePrerenderAuth: (userId, permissions) => {
            authCall = { userId, permissions };
          },
        }),
      );

      await task({
        realmURL: 'http://localhost:4201/experiments/',
        realmUsername: '@alice:localhost',
        runAs: '@alice:localhost',
        command: '@cardstack/catalog/commands/noop/default',
        commandInput: {},
        dedupeKey: null,
        jobInfo: { id: 6 } as any,
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: {
        'http://localhost:4201/experiments/': ['read', 'write'],
      },
    });
    assert.strictEqual(
      profileRequests.length,
      1,
      'resolves the users grant against the homeserver once',
    );
  },

  'runs for a runner whose only access is the wildcard grant': async (
    assert,
  ) => {
    assert.expect(2);
    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '*',
            realm_url: 'http://localhost:4201/experiments/',
            read: true,
            write: false,
            realm_owner: false,
          },
        ],
        onCreatePrerenderAuth: (userId, permissions) => {
          authCall = { userId, permissions };
        },
      }),
    );

    let result = await task({
      realmURL: 'http://localhost:4201/experiments/',
      realmUsername: '@alice:localhost',
      runAs: '@alice:localhost',
      command: '@cardstack/catalog/commands/noop/default',
      commandInput: {},
      dedupeKey: null,
      jobInfo: { id: 7 } as any,
    });

    assert.strictEqual(result.status, 'ready');
    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: {
        'http://localhost:4201/experiments/': ['read'],
      },
    });
  },
} as SharedTests<{}>);

export default tests;
