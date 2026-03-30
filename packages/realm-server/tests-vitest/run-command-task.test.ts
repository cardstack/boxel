import type {
  DBAdapter,
  ExecuteOptions,
  Prerenderer,
  QueuePublisher,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { TaskArgs } from '@cardstack/runtime-common/tasks';
import { runCommand } from '@cardstack/runtime-common/tasks/run-command';
import { describe, expect, it } from 'vitest';

function makeDBAdapter(
  rows: Record<string, unknown>[],
  assertion?: (sql: string, opts?: ExecuteOptions) => void,
): DBAdapter {
  return {
    kind: 'pg',
    isClosed: false,
    execute: async (sql: string, opts?: ExecuteOptions) => {
      assertion?.(sql, opts);
      return rows as never;
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
    indexWriter: {} as never,
    prerenderer,
    definitionLookup: {} as never,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      trace: () => {},
    } as never,
    matrixURL: 'http://localhost:8008',
    getReader: () => ({}) as never,
    getAuthedFetch: async () => fetch,
    createPrerenderAuth: (userId, permissions) => {
      onCreatePrerenderAuth?.(userId, permissions);
      return 'signed-auth-token';
    },
    reportStatus: (_jobInfo, status) => onReportStatus?.(status),
  };
}

describe('run-command-task-test.ts', function () {
  describe('run-command task', function () {
    it('returns error when runAs has no realm permissions', async function () {
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
        jobInfo: { id: 1 } as never,
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('does not have permissions in');
      expect(ranPrerender).toBe(false);
      expect(statuses).toEqual(['start', 'finish']);
    });

    it('returns error when command specifier is invalid', async function () {
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
        jobInfo: { id: 2 } as never,
      });

      expect(result.status).toBe('error');
      expect(ranPrerender).toBe(false);
      expect(statuses).toEqual(['start', 'finish']);
    });

    it('normalizes legacy /commands URL and defaults export name', async function () {
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
        jobInfo: { id: 3 } as never,
      });

      expect(result.status).toBe('ready');
      expect(authCall).toEqual({
        userId: '@alice:localhost',
        permissions: {
          'http://localhost:4201/experiments/': ['read', 'write'],
        },
      });
      expect(prerenderCall?.command).toBe(
        'http://localhost:4201/experiments/commands/create-submission/default',
      );
      expect(prerenderCall?.commandInput).toBeUndefined();
    });

    it('passes scoped command through unchanged', async function () {
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
        commandInput: {
          listingId: 'http://localhost:4201/catalog/AppListing/1',
        },
        jobInfo: { id: 4 } as never,
      });

      expect(prerenderCall?.command).toBe(
        '@cardstack/catalog/commands/create-submission/default',
      );
      expect(prerenderCall?.commandInput).toEqual({
        listingId: 'http://localhost:4201/catalog/AppListing/1',
      });
    });
  });
});
