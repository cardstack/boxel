import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common';
import { DelegatedUserRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import {
  executeLoadSkill,
  loadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from '../lib/load-skill.ts';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';
const SKILL_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md';

// A fake fetch that records each call and returns a scripted Response.
function recordingFetch(
  handler: (url: string, init: RequestInit) => Response,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init: RequestInit }[];
} {
  let calls: { url: string; init: RequestInit }[] = [];
  let fetch = (async (input: any, init: any) => {
    let url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// A stand-in for DelegatedUserRealmSessionManager that records getToken calls
// and either returns a token or throws a scripted error.
function stubSessions(result: { token: string } | { throws: unknown }): {
  getToken: (args: { onBehalfOf: string; realm: string }) => Promise<string>;
  invalidate: (args: { onBehalfOf: string; realm: string }) => void;
  calls: { onBehalfOf: string; realm: string }[];
  invalidated: { onBehalfOf: string; realm: string }[];
} {
  let calls: { onBehalfOf: string; realm: string }[] = [];
  let invalidated: { onBehalfOf: string; realm: string }[] = [];
  return {
    calls,
    invalidated,
    getToken: async (args) => {
      calls.push(args);
      if ('throws' in result) {
        throw result.throws;
      }
      return result.token;
    },
    invalidate: (args) => {
      invalidated.push(args);
    },
  };
}

module('loadSkill tool definition', () => {
  test('advertises name + required args', () => {
    assert.strictEqual(loadSkillTool.function.name, LOAD_SKILL_TOOL_NAME);
    assert.strictEqual(loadSkillTool.type, 'function');
    let required = (loadSkillTool.function.parameters as any)
      .required as string[];
    assert.true(required.includes('realm'), 'realm is required');
    assert.true(required.includes('url'), 'url is required');
  });
});

module('executeLoadSkill', () => {
  test('mints a token for the realm and returns the file source', async () => {
    let sessions = stubSessions({ token: 'tok-123' });
    let { fetch, calls } = recordingFetch(
      () => new Response('# Trip Planner\n\ninstructions', { status: 200 }),
    );

    let result = await executeLoadSkill(
      { realm: REALM, url: SKILL_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );

    assert.deepEqual(sessions.calls, [
      { onBehalfOf: ON_BEHALF_OF, realm: REALM },
    ]);
    assert.strictEqual(calls[0].url, SKILL_URL, 'fetches the given url');
    let headers = calls[0].init.headers as Record<string, string>;
    assert.strictEqual(headers['Authorization'], 'Bearer tok-123');
    assert.strictEqual(headers['Accept'], SupportedMimeType.CardSource);
    assert.true(result.ok, 'result ok');
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Trip Planner\n\ninstructions',
    );
  });

  test('rejects a url outside the realm without minting or fetching', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch, calls } = recordingFetch(
      () => new Response('x', { status: 200 }),
    );
    let result = await executeLoadSkill(
      {
        realm: REALM,
        url: 'https://localhost:4201/user/someone-else/skills/x/SKILL.md',
      },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes(
        'not inside realm',
      ),
    );
    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
    assert.strictEqual(calls.length, 0, 'no fetch attempted');
  });

  test('returns an error result when the file is missing (404)', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch } = recordingFetch(
      () => new Response('not found', { status: 404 }),
    );
    let result = await executeLoadSkill(
      { realm: REALM, url: SKILL_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok, 'result not ok');
    assert.true(
      (result as { ok: false; error: string }).error.includes('404'),
      'error mentions the status',
    );
  });

  test('reports a clear message when delegation is disabled', async () => {
    let sessions = stubSessions({
      throws: new DelegatedUserRealmSessionError('disabled', 'off'),
    });
    let { fetch, calls } = recordingFetch(
      () => new Response('', { status: 200 }),
    );
    let result = await executeLoadSkill(
      { realm: REALM, url: SKILL_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes('unavailable'),
      'error explains the feature is off',
    );
    assert.strictEqual(calls.length, 0, 'never fetched without a token');
  });

  test('reports no-access when the user lacks read on the realm', async () => {
    let sessions = stubSessions({
      throws: new DelegatedUserRealmSessionError('forbidden', 'nope', 403),
    });
    let { fetch } = recordingFetch(() => new Response('', { status: 200 }));
    let result = await executeLoadSkill(
      { realm: REALM, url: SKILL_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes('no read access'),
      'error explains the access problem',
    );
  });

  test('invalidates and retries once when a cached token is rejected', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let n = 0;
    let { fetch, calls } = recordingFetch(() => {
      n += 1;
      return n === 1
        ? new Response('stale', { status: 401 })
        : new Response('# Fresh', { status: 200 });
    });

    let result = await executeLoadSkill(
      { realm: REALM, url: SKILL_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );

    assert.true(result.ok, 'succeeds on the retry');
    assert.strictEqual(calls.length, 2, 'fetched twice');
    assert.deepEqual(
      sessions.invalidated,
      [{ onBehalfOf: ON_BEHALF_OF, realm: REALM }],
      'dropped the stale token once',
    );
    assert.strictEqual(sessions.calls.length, 2, 're-minted a fresh token');
  });
});
