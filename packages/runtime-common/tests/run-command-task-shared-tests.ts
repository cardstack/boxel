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
      alertOnError: false,
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
      alertOnError: false,
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
      alertOnError: false,
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
      alertOnError: false,
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

  'throws when alertOnError is set and the command returns an error': async (
    assert,
  ) => {
    assert.expect(2);
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
        prerenderResult: { status: 'error', error: 'boom' },
      }),
    );

    // A thrown task lets the queue mark the job rejected and report it to
    // Sentry, instead of resolving with the error swallowed in-band.
    await assert.rejects(
      task({
        realmURL: 'http://localhost:4201/experiments/',
        realmUsername: '@alice:localhost',
        runAs: '@alice:localhost',
        command: '@cardstack/catalog/commands/sync-openrouter-models/default',
        commandInput: {},
        alertOnError: true,
        jobInfo: { id: 5 } as any,
      }),
      /boom/,
      'rejects with the command error when alertOnError is set',
    );
    assert.true(true, 'did not resolve in-band');
  },

  'throws when alertOnError is set and runAs lacks permissions': async (
    assert,
  ) => {
    assert.expect(1);
    let task = runCommand(makeTaskArgs({ dbRows: [] }));

    await assert.rejects(
      task({
        realmURL: 'http://localhost:4201/experiments/',
        realmUsername: '@alice:localhost',
        runAs: '@alice:localhost',
        command: '@cardstack/catalog/commands/sync-openrouter-models/default',
        commandInput: {},
        alertOnError: true,
        jobInfo: { id: 6 } as any,
      }),
      /does not have permissions in/,
      'a permission failure rejects the job when alertOnError is set',
    );
  },
} as SharedTests<{}>);

export default tests;
