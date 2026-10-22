import { realmServerAuthorizationMiddleware } from '../authorization-middleware.ts';
import type { RealmServerTokenSource } from '../authorization-middleware.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALMS = ['https://realms.example/alice/work/'];

// A recording `next`: answers each attempt from `statuses` in order (repeating
// the last one once the list runs out) and keeps the `Authorization` header
// and body each attempt carried, which is what the assertions below read.
//
// It reads the body from a clone, the way `fetcher`'s terminal does
// (`fetchImplementation(onwardReq.clone())`). The middleware hands the *same*
// `Request` to `next` on both attempts, so a terminal that consumed the
// original would leave the replay with a spent body.
function recordingNext(statuses: number[]) {
  let sentAuthorization: (string | null)[] = [];
  let sentBodies: string[] = [];
  let next = async (req: Request) => {
    sentAuthorization.push(req.headers.get('Authorization'));
    sentBodies.push(await req.clone().text());
    let status =
      statuses[Math.min(sentAuthorization.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? '{}' : '{"errors":["nope"]}', {
      status,
    });
  };
  return { next, sentAuthorization, sentBodies };
}

// A token source standing in for `RealmServerService`: `token` is the session
// it currently holds, and each reauthentication replaces it with the next entry
// of `mints` (an `undefined` entry meaning no session could be minted).
//
// `reauthenticateRealmServer` mirrors the service's contract: a caller whose
// rejected token is no longer the one being held gets the held session back
// and no mint happens.
function tokenSource(
  token: string | undefined,
  mints: (string | undefined)[] = [],
) {
  let state = { token, reauthentications: 0, rejectedTokens: [] as unknown[] };
  let source: RealmServerTokenSource = {
    tokenForRealms: (realms: string[]) =>
      realms.length > 0 ? state.token : undefined,
    reauthenticateRealmServer: async (rejectedToken?: string) => {
      state.rejectedTokens.push(rejectedToken);
      if (rejectedToken && state.token && state.token !== rejectedToken) {
        return state.token;
      }
      state.token = mints[state.reauthentications];
      state.reauthentications++;
      return state.token;
    },
  };
  return { source, state };
}

// The body `_federated-search` sends: the query and the realms it names.
function searchRequest(headers?: Record<string, string>) {
  return new Request('https://realms.example/_federated-search', {
    method: 'QUERY',
    ...(headers ? { headers } : {}),
    body: JSON.stringify({
      filter: { eq: { title: 'Mango' } },
      realms: REALMS,
    }),
  });
}

const tests = Object.freeze({
  'attaches the session token for the request realms': async (assert) => {
    let { source } = tokenSource('session-1');
    let { next, sentAuthorization } = recordingNext([200]);

    let response = await realmServerAuthorizationMiddleware(source, REALMS)(
      searchRequest(),
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
      searchRequest(),
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
      searchRequest(),
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
      searchRequest(),
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
      searchRequest(),
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
      searchRequest(),
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
      searchRequest({ Authorization: 'Bearer delegated' }),
      next,
    );

    // A caller that chose its own token owns that choice, including what its
    // refusal means — this middleware has no standing to replace a token it
    // did not attach.
    assert.strictEqual(response.status, 401);
    assert.deepEqual(sentAuthorization, ['Bearer delegated']);
    assert.strictEqual(state.reauthentications, 0, 'no session was minted');
  },

  'hands the refused token to the reauthentication': async (assert) => {
    let { source, state } = tokenSource('stale', ['fresh']);
    let { next } = recordingNext([401, 200]);

    await realmServerAuthorizationMiddleware(source, REALMS)(
      searchRequest(),
      next,
    );

    // The token source cannot tell a stale session from one that was replaced
    // mid-flight unless it is told which token the server actually refused.
    assert.deepEqual(
      state.rejectedTokens,
      ['stale'],
      'the reauthentication was told which session was refused',
    );
  },

  'replays with a session another caller already minted, without minting again':
    async (assert) => {
      let { source, state } = tokenSource('stale', ['minted-again']);
      let { next, sentAuthorization } = recordingNext([401, 200]);
      // Stand in for a concurrent caller — another search's reauthentication,
      // or the token refresher — replacing the session while this request is
      // in flight, so the 401 for the old token lands after the service has
      // already moved on.
      let replacesTheSessionMidFlight = async (req: Request) => {
        let response = await next(req);
        state.token = 'replaced-mid-flight';
        return response;
      };

      let response = await realmServerAuthorizationMiddleware(source, REALMS)(
        searchRequest(),
        replacesTheSessionMidFlight,
      );

      assert.strictEqual(
        response.status,
        200,
        'the replay produced the answer',
      );
      assert.deepEqual(
        sentAuthorization,
        ['Bearer stale', 'Bearer replaced-mid-flight'],
        'the replay carried the session the service now holds',
      );
      assert.strictEqual(
        state.reauthentications,
        0,
        'and the session nothing had rejected was not discarded for a new one',
      );
    },

  'the replayed request still carries its body': async (assert) => {
    let { source } = tokenSource('stale', ['fresh']);
    let { next, sentBodies } = recordingNext([401, 200]);

    await realmServerAuthorizationMiddleware(source, REALMS)(
      searchRequest(),
      next,
    );

    // The replay reuses the same `Request`, so the query survives only as long
    // as nothing between here and the network consumes that body.
    assert.strictEqual(sentBodies.length, 2, 'both attempts were sent');
    assert.deepEqual(
      JSON.parse(sentBodies[1]),
      JSON.parse(sentBodies[0]),
      'and the replay asked the same question as the refused attempt',
    );
    assert.deepEqual(JSON.parse(sentBodies[1]).realms, REALMS);
  },
}) as SharedTests<Record<string, never>>;

export default tests;
