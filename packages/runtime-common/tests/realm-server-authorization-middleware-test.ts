import { realmServerAuthorizationMiddleware } from '../authorization-middleware.ts';
import type { RealmServerTokenSource } from '../authorization-middleware.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALMS = ['https://realms.example/alice/work/'];

// A recording `next`: answers each attempt from `statuses` in order (repeating
// the last one once the list runs out) and keeps the `Authorization` header
// each attempt carried, which is what the assertions below read.
function recordingNext(statuses: number[]) {
  let sentAuthorization: (string | null)[] = [];
  let next = async (req: Request) => {
    sentAuthorization.push(req.headers.get('Authorization'));
    let status =
      statuses[Math.min(sentAuthorization.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? '{}' : '{"errors":["nope"]}', {
      status,
    });
  };
  return { next, sentAuthorization };
}

// A token source standing in for `RealmServerService`: `token` is the session
// it currently holds, and each reauthentication replaces it with the next entry
// of `mints` (an `undefined` entry meaning no session could be minted).
function tokenSource(
  token: string | undefined,
  mints: (string | undefined)[] = [],
) {
  let state = { token, reauthentications: 0 };
  let source: RealmServerTokenSource = {
    tokenForRealms: (realms: string[]) =>
      realms.length > 0 ? state.token : undefined,
    reauthenticateRealmServer: async () => {
      state.token = mints[state.reauthentications];
      state.reauthentications++;
      return state.token;
    },
  };
  return { source, state };
}

const tests = Object.freeze({
  'attaches the session token for the request realms': async (assert) => {
    let { source } = tokenSource('session-1');
    let { next, sentAuthorization } = recordingNext([200]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    assert.strictEqual(response.status, 200);
    assert.deepEqual(sentAuthorization, ['Bearer session-1']);
  },

  'sends no authorization when the source has no usable token': async (
    assert,
  ) => {
    let { source } = tokenSource(undefined);
    let { next, sentAuthorization } = recordingNext([200]);

    await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    // The realms may be publicly readable, so the server — not the client —
    // decides whether an unauthenticated search is allowed.
    assert.deepEqual(sentAuthorization, [null]);
  },

  'reauthenticates a 401 and replays the request once': async (assert) => {
    let { source, state } = tokenSource('stale', ['fresh']);
    let { next, sentAuthorization } = recordingNext([401, 200]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    assert.strictEqual(response.status, 200, 'the replay produced the answer');
    assert.strictEqual(state.reauthentications, 1, 'one session was minted');
    assert.deepEqual(
      sentAuthorization,
      ['Bearer stale', 'Bearer fresh'],
      'the replay carried the freshly minted session',
    );
  },

  'surfaces a 401 the fresh session is also refused': async (assert) => {
    let { source, state } = tokenSource('stale', ['fresh', 'fresher']);
    let { next, sentAuthorization } = recordingNext([401]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    assert.strictEqual(response.status, 401, 'the caller sees the refusal');
    assert.strictEqual(
      sentAuthorization.length,
      2,
      'the request was replayed once and then left alone',
    );
    assert.strictEqual(
      state.reauthentications,
      1,
      'and only one session was minted for it',
    );
  },

  'surfaces a 401 when no session can be minted': async (assert) => {
    let { source, state } = tokenSource('stale', [undefined]);
    let { next, sentAuthorization } = recordingNext([401]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    assert.strictEqual(response.status, 401);
    assert.strictEqual(state.reauthentications, 1, 'the mint was attempted');
    assert.strictEqual(
      sentAuthorization.length,
      1,
      'but with no token to replay with, the request is not sent again',
    );
  },

  'leaves a 403 alone': async (assert) => {
    let { source, state } = tokenSource('session-1', ['fresh']);
    let { next, sentAuthorization } = recordingNext([403]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
      }),
      next,
    );

    // Authenticated but not permitted: a fresh session would be refused the
    // same way, so minting one would be noise.
    assert.strictEqual(response.status, 403);
    assert.strictEqual(state.reauthentications, 0, 'no session was minted');
    assert.strictEqual(sentAuthorization.length, 1, 'and nothing was replayed');
  },

  'leaves a caller-supplied authorization header alone': async (assert) => {
    let { source, state } = tokenSource('session-1', ['fresh']);
    let { next, sentAuthorization } = recordingNext([401]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      new Request('https://realms.example/_federated-search', {
        method: 'QUERY',
        headers: { Authorization: 'Bearer delegated' },
      }),
      next,
    );

    // A caller that chose its own token (the delegated and prerender paths)
    // owns that choice, including what its refusal means.
    assert.strictEqual(response.status, 401);
    assert.deepEqual(sentAuthorization, ['Bearer delegated']);
    assert.strictEqual(state.reauthentications, 0, 'no session was minted');
  },
}) as SharedTests<Record<string, never>>;

export default tests;
