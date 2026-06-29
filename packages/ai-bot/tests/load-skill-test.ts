import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common';
import { DelegatedRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import {
  executeLoadSkill,
  skillFileUrl,
  loadSkillTool,
  LOAD_SKILL_TOOL_NAME,
} from '../lib/load-skill.ts';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';

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

// A stand-in for DelegatedRealmSessionManager that records getToken calls and
// either returns a token or throws a scripted error.
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
    assert.true(required.includes('name'), 'name is required');
    assert.false(required.includes('path'), 'path is optional');
  });
});

module('skillFileUrl', () => {
  test('resolves SKILL.md when no path is given', () => {
    assert.strictEqual(
      skillFileUrl({ realm: REALM, name: 'trip-planner' }),
      'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md',
    );
  });

  test('resolves a references/ file when path is given', () => {
    assert.strictEqual(
      skillFileUrl({
        realm: REALM,
        name: 'trip-planner',
        path: 'api-notes.md',
      }),
      'https://localhost:4201/user/jane/skills/trip-planner/references/api-notes.md',
    );
  });

  test('tolerates a realm URL without a trailing slash', () => {
    assert.strictEqual(
      skillFileUrl({ realm: 'https://localhost:4201/user/jane', name: 's' }),
      'https://localhost:4201/user/jane/skills/s/SKILL.md',
    );
  });
});

module('executeLoadSkill', () => {
  test('mints a token for the user/realm and returns the SKILL.md source', async () => {
    let sessions = stubSessions({ token: 'tok-123' });
    let { fetch, calls } = recordingFetch(
      () => new Response('# Trip Planner\n\ninstructions', { status: 200 }),
    );

    let result = await executeLoadSkill(
      { realm: REALM, name: 'trip-planner' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
    );

    assert.deepEqual(sessions.calls, [
      { onBehalfOf: ON_BEHALF_OF, realm: REALM },
    ]);
    assert.strictEqual(
      calls[0].url,
      'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md',
    );
    let headers = calls[0].init.headers as Record<string, string>;
    assert.strictEqual(headers['Authorization'], 'Bearer tok-123');
    assert.strictEqual(headers['Accept'], SupportedMimeType.CardSource);
    assert.true(result.ok, 'result ok');
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Trip Planner\n\ninstructions',
    );
  });

  test('loads a references/ file when path is given', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch, calls } = recordingFetch(
      () => new Response('ref', { status: 200 }),
    );
    await executeLoadSkill(
      { realm: REALM, name: 'trip-planner', path: 'api-notes.md' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
    );
    assert.strictEqual(
      calls[0].url,
      'https://localhost:4201/user/jane/skills/trip-planner/references/api-notes.md',
    );
  });

  test('returns an error result when the file is missing (404)', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch } = recordingFetch(
      () => new Response('not found', { status: 404 }),
    );
    let result = await executeLoadSkill(
      { realm: REALM, name: 'nope' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
    );
    assert.false(result.ok, 'result not ok');
    assert.true(
      (result as { ok: false; error: string }).error.includes('404'),
      'error mentions the status',
    );
  });

  test('reports a clear message when delegation is disabled', async () => {
    let sessions = stubSessions({
      throws: new DelegatedRealmSessionError('disabled', 'off'),
    });
    let { fetch, calls } = recordingFetch(
      () => new Response('', { status: 200 }),
    );
    let result = await executeLoadSkill(
      { realm: REALM, name: 'trip-planner' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
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
      throws: new DelegatedRealmSessionError('forbidden', 'nope', 403),
    });
    let { fetch } = recordingFetch(() => new Response('', { status: 200 }));
    let result = await executeLoadSkill(
      { realm: REALM, name: 'trip-planner' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
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
      { realm: REALM, name: 'trip-planner' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
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

  test('truncates oversized content', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let big = 'x'.repeat(200_000);
    let { fetch } = recordingFetch(() => new Response(big, { status: 200 }));
    let result = await executeLoadSkill(
      { realm: REALM, name: 'huge' },
      { onBehalfOf: ON_BEHALF_OF, delegatedRealmSessions: sessions, fetch },
    );
    assert.true(result.ok);
    let content = (result as { ok: true; content: string }).content;
    assert.true(content.length < big.length, 'content was capped');
    assert.true(content.endsWith('[truncated]'), 'truncation marked');
  });
});
