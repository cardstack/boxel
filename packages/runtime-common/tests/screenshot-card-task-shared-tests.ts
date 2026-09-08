import type {
  DBAdapter,
  ExecuteOptions,
  Prerenderer,
  QueuePublisher,
} from '../index.ts';
import type { SharedTests } from '../helpers/index.ts';
import type { TaskArgs } from '../tasks/index.ts';
import { screenshotCard } from '../tasks/screenshot-card.ts';

const REALM_URL = 'http://localhost:4201/experiments/';
const CARD_ID = `${REALM_URL}Person/fadhlan`;

function makeDBAdapter(rows: Record<string, unknown>[]): DBAdapter {
  return {
    kind: 'pg',
    notify: async () => {},
    isClosed: false,
    execute: async (_sql: string, _opts?: ExecuteOptions) => rows as any,
    close: async () => {},
    getColumnNames: async () => [],
    withWriteLock: async (_url, fn) => fn(undefined),
    withUserCostLock: async (_userId, fn) => fn(),
  };
}

function makeTaskArgs({
  dbRows,
  onCreatePrerenderAuth,
}: {
  dbRows: Record<string, unknown>[];
  onCreatePrerenderAuth?: (
    userId: string,
    permissions: Record<string, any>,
  ) => void;
}): TaskArgs {
  let prerenderer: Prerenderer = {
    prerenderModule: async () => {
      throw new Error('not used');
    },
    prerenderVisit: async () => {
      throw new Error('not used');
    },
    runCommand: async () => {
      throw new Error('not used');
    },
    prerenderScreenshot: async () => ({
      status: 'ready',
      base64: 'c3R1Yg==',
      width: 800,
      height: 600,
      contentType: 'image/png',
    }),
  } as unknown as Prerenderer;

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
    reportStatus: () => {},
  };
}

function capture(taskArgs: TaskArgs) {
  return screenshotCard(taskArgs)({
    realmURL: REALM_URL,
    runAs: '@alice:localhost',
    cardId: CARD_ID,
    format: 'isolated',
    captureSpec: null,
    persist: null,
    surface: 'post',
    loggingCorrelationId: null,
    jobInfo: { id: 1 } as any,
  } as any);
}

// The realm verifies a session token by comparing its permissions claim against
// the union of the realm's `users` and `*` grants with the runner's own row, and
// rejects any difference as a PermissionMismatch. These cover the mint side of
// that contract for the realm being captured.
const tests = Object.freeze({
  'mints the union of the wildcard grant and the runner row': async (
    assert,
  ) => {
    assert.expect(1);
    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    await capture(
      makeTaskArgs({
        dbRows: [
          {
            username: '*',
            realm_url: REALM_URL,
            read: true,
            write: false,
            realm_owner: false,
          },
          {
            username: '@alice:localhost',
            realm_url: REALM_URL,
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

    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: { [REALM_URL]: ['read', 'write'] },
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
      await capture(
        makeTaskArgs({
          dbRows: [
            {
              username: 'users',
              realm_url: REALM_URL,
              read: true,
              write: false,
              realm_owner: false,
            },
            {
              username: '@alice:localhost',
              realm_url: REALM_URL,
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
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: { [REALM_URL]: ['read', 'write'] },
    });
    assert.strictEqual(
      profileRequests.length,
      1,
      'resolves the users grant against the homeserver once',
    );
  },

  'captures for a runner whose only access is the wildcard grant': async (
    assert,
  ) => {
    assert.expect(2);
    let authCall:
      | { userId: string; permissions: Record<string, unknown> }
      | undefined;

    let result = await capture(
      makeTaskArgs({
        dbRows: [
          {
            username: '*',
            realm_url: REALM_URL,
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

    assert.strictEqual(result.status, 'ready');
    assert.deepEqual(authCall, {
      userId: '@alice:localhost',
      permissions: { [REALM_URL]: ['read'] },
    });
  },

  'refuses a runner with no access to the realm': async (assert) => {
    assert.expect(2);
    let mintedAuth = false;

    let result = await capture(
      makeTaskArgs({
        dbRows: [],
        onCreatePrerenderAuth: () => {
          mintedAuth = true;
        },
      }),
    );

    assert.strictEqual(result.status, 'error');
    assert.false(mintedAuth, 'does not mint a token for a runner it refuses');
  },
} as SharedTests<{}>);

export default tests;
