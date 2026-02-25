import { module, test } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  Prerenderer,
  QueuePublisher,
  RunCommandResponse,
} from '../index';
import type { TaskArgs } from '../tasks';
import { runCommand } from '../tasks/run-command';

function makeDBAdapter(
  rows: Record<string, unknown>[],
  assertion?: (sql: string, opts?: ExecuteOptions) => void,
): DBAdapter {
  return {
    kind: 'pg',
    isClosed: false,
    execute: async (sql: string, opts?: ExecuteOptions) => {
      assertion?.(sql, opts);
      return rows as any;
    },
    close: async () => {},
    getColumnNames: async () => [],
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
    realm: string;
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
    prerenderCard: async () => {
      throw new Error('not used');
    },
    prerenderModule: async () => {
      throw new Error('not used');
    },
    prerenderFileExtract: async () => {
      throw new Error('not used');
    },
    prerenderFileRender: async () => {
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

module('run-command task', () => {
  test('returns error when runAs has no realm permissions', async function (assert) {
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
      jobInfo: { id: 1 } as any,
    });

    assert.strictEqual(result.status, 'error');
    assert.true(
      result.error?.includes('does not have permissions in'),
      'contains permission error message',
    );
    assert.false(ranPrerender, 'does not call prerenderer');
    assert.deepEqual(statuses, ['start', 'finish'], 'reports start/finish');
  });

  test('returns error when command specifier is invalid', async function (assert) {
    assert.expect(3);
    let statuses: Array<'start' | 'finish'> = [];
    let ranPrerender = false;

    let task = runCommand(
      makeTaskArgs({
        dbRows: [
          {
            username: '@alice:localhost',
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
      jobInfo: { id: 2 } as any,
    });

    assert.strictEqual(result.status, 'error');
    assert.false(ranPrerender, 'does not call prerenderer for invalid command');
    assert.deepEqual(statuses, ['start', 'finish'], 'reports start/finish');
  });

  test('normalizes legacy /commands URL and defaults export name', async function (assert) {
    assert.expect(4);
    let prerenderCall:
      | {
          realm: string;
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
  });

  test('passes scoped command through unchanged', async function (assert) {
    assert.expect(2);
    let prerenderCall:
      | {
          realm: string;
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
      command: '@cardstack/boxel-host/commands/create-submission/default',
      commandInput: { listingId: 'http://localhost:4201/catalog/AppListing/1' },
      jobInfo: { id: 4 } as any,
    });

    assert.strictEqual(
      prerenderCall?.command,
      '@cardstack/boxel-host/commands/create-submission/default',
    );
    assert.deepEqual(prerenderCall?.commandInput, {
      listingId: 'http://localhost:4201/catalog/AppListing/1',
    });
  });
});
