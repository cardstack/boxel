import type {
  DBAdapter,
  ExecuteOptions,
  Prerenderer,
  QueuePublisher,
} from '../index.ts';
import type { SharedTests } from '../helpers/index.ts';
import type { PrerenderAuthOptions, TaskArgs } from '../tasks/index.ts';
import { captureCard, type CapturePersistArgs } from '../tasks/capture-card.ts';
import { ANONYMOUS_RENDER } from '../media-cache.ts';

const REALM_URL = 'http://localhost:4201/experiments/';
const CARD_ID = `${REALM_URL}Person/fadhlan`;

function makeDBAdapter(
  rows: Record<string, unknown>[],
  loaderEpoch?: string,
): DBAdapter {
  // `readRealmLoaderEpoch` reads `realm_generations`, and the lookup of the
  // realms that name a policy reads `realm.json` rows, of which there are
  // none here; every other query the task runs (permission fetches) wants the
  // permission `rows`. Branch on the SQL so neither is handed a permission row
  // (whose `loader_epoch` would be undefined → the '0' sentinel).
  let execute = async (sql: string, _opts?: ExecuteOptions) =>
    (/realm_generations/i.test(sql)
      ? loaderEpoch !== undefined
        ? [{ loader_epoch: loaderEpoch }]
        : []
      : /realm\.json/i.test(sql)
        ? []
        : rows) as any;
  return {
    kind: 'pg',
    notify: async () => {},
    isClosed: false,
    execute,
    close: async () => {},
    getColumnNames: async () => [],
    withWriteLock: async (_url, fn) => fn(undefined),
    withFileWriteLocks: async (_url, _paths, fn) => fn(() => {}),
    withUserCostLock: async (_userId, fn) => fn(),
    withTransaction: async (fn) => fn(async () => rows as any),
  };
}

function makeTaskArgs({
  dbRows,
  loaderEpoch,
  onCreatePrerenderAuth,
  onPrerenderCapture,
}: {
  dbRows: Record<string, unknown>[];
  loaderEpoch?: string;
  onCreatePrerenderAuth?: (
    userId: string,
    permissions: Record<string, any>,
    opts?: PrerenderAuthOptions,
  ) => void;
  onPrerenderCapture?: (args: any) => void;
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
    prerenderCapture: async (args: any) => {
      onPrerenderCapture?.(args);
      return {
        status: 'ready',
        base64: 'c3R1Yg==',
        width: 800,
        height: 600,
        contentType: 'image/png',
      };
    },
  } as unknown as Prerenderer;

  return {
    dbAdapter: makeDBAdapter(dbRows, loaderEpoch),
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
    createPrerenderAuth: (userId, permissions, opts) => {
      onCreatePrerenderAuth?.(userId, permissions, opts);
      return 'signed-auth-token';
    },
    reportStatus: () => {},
  };
}

function capture(
  taskArgs: TaskArgs,
  persist: CapturePersistArgs | null = null,
  runAs = '@alice:localhost',
) {
  return captureCard(taskArgs)({
    realmURL: REALM_URL,
    runAs,
    cardId: CARD_ID,
    format: 'isolated',
    captureSpec: null,
    persist,
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

  // A capture reuses a pooled prerender page, so it must tell the render route
  // which module timeline it belongs to or a page holding a superseded module
  // graph renders the old module and persists it under the new generation's
  // ledger key. The task threads the realm's committed `loader_epoch`; the
  // route resets the tab's loader when it differs.
  //
  // This pins the threading half only — that the task reads the epoch and puts
  // it on the render options. The reset half (a warm pooled tab dropping and
  // re-evaluating its module graph when the epoch it is handed changes) is the
  // shared render-route path, covered against the real pool by the
  // loader-reset-reason test in realm-server's prerendering-test; a capture
  // reaches it through the same `render.html` build as a visit.
  'threads the realm loader epoch into the capture render options': async (
    assert,
  ) => {
    assert.expect(2);
    let renderArgs: any;

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
        loaderEpoch: 'epoch-2',
        onPrerenderCapture: (args) => {
          renderArgs = args;
        },
      }),
    );

    assert.strictEqual(result.status, 'ready');
    assert.deepEqual(
      renderArgs?.renderOptions,
      { loaderEpoch: 'epoch-2' },
      'the capture carries the realm’s current loader epoch',
    );
  },

  // A capture is something a reader asks for, so it draws what that reader may
  // see, whether it is answered only to them or persisted and served back to
  // them later.
  "a capture renders on its requester's ordinary session, whether or not it persists":
    async (assert) => {
      assert.expect(2);
      let dbRows = [
        {
          username: '@alice:localhost',
          realm_url: REALM_URL,
          read: true,
          write: false,
          realm_owner: false,
        },
      ];
      let minted: { userId: string; opts?: PrerenderAuthOptions }[] = [];
      let taskArgs = makeTaskArgs({
        dbRows,
        onCreatePrerenderAuth: (userId, _permissions, opts) => {
          minted.push({ userId, opts });
        },
      });

      await capture(taskArgs, {
        realmURL: REALM_URL,
        sourceURL: CARD_ID.replace(/\.json$/, ''),
        captureSpecHash: 'spec-hash',
        sourceGeneration: 1,
        lane: 'on-demand',
      });
      await capture(taskArgs);

      assert.deepEqual(
        minted[0],
        { userId: '@alice:localhost', opts: undefined },
        "the persisting capture mints the requester's ordinary session",
      );
      assert.deepEqual(
        minted[1],
        { userId: '@alice:localhost', opts: undefined },
        'and so does one answered only to them',
      );
    },

  'a capture for a reader who authenticated nobody renders with no session':
    async (assert) => {
      assert.expect(3);
      let minted = false;
      let renderAuth: string | undefined;
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
          onCreatePrerenderAuth: () => {
            minted = true;
          },
          onPrerenderCapture: (args) => {
            renderAuth = args.auth;
          },
        }),
        null,
        ANONYMOUS_RENDER,
      );

      assert.strictEqual(result.status, 'ready');
      assert.false(minted, 'no session is minted for anyone');
      assert.strictEqual(
        renderAuth,
        '{}',
        'the render carries no session, so it reaches only what anyone may read',
      );
    },

  'a capture for a reader who authenticated nobody is refused where anyone may not read':
    async (assert) => {
      assert.expect(2);
      let rendered = false;
      let result = await capture(
        makeTaskArgs({
          dbRows: [
            {
              username: '@alice:localhost',
              realm_url: REALM_URL,
              read: true,
              write: false,
              realm_owner: false,
            },
          ],
          onPrerenderCapture: () => {
            rendered = true;
          },
        }),
        null,
        ANONYMOUS_RENDER,
      );

      assert.strictEqual(result.status, 'error');
      assert.false(rendered, 'nothing renders');
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
