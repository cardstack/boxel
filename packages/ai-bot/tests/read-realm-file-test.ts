import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common';
import { DelegatedUserRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import {
  executeReadRealmFile,
  readRealmFileTool,
  classifyToolCalls,
  fileLabelFromUrl,
  READ_REALM_FILE_TOOL_NAME,
} from '../lib/read-realm-file.ts';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';
const FILE_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md';

// A gated file's response: the realm server names the owning realm even on the
// auth challenge, which is how executeReadRealmFile discovers the realm.
function gated(status: 401 | 403 = 401): Response {
  return new Response('unauthorized', {
    status,
    headers: { 'x-boxel-realm-url': REALM },
  });
}

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

module('readRealmFile tool definition', () => {
  test('advertises name + required args', () => {
    assert.strictEqual(
      readRealmFileTool.function.name,
      READ_REALM_FILE_TOOL_NAME,
    );
    assert.strictEqual(readRealmFileTool.type, 'function');
    let required = (readRealmFileTool.function.parameters as any)
      .required as string[];
    assert.deepEqual(required, ['url'], 'only url is required');
    let properties = (readRealmFileTool.function.parameters as any)
      .properties as Record<string, unknown>;
    assert.notOk(
      properties['realm'],
      'realm is discovered, not asked of the model',
    );
  });
});

module('executeReadRealmFile', () => {
  test('reads a public file from the first fetch with no token', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch, calls } = recordingFetch(
      () => new Response('# Trip Planner\n\ninstructions', { status: 200 }),
    );

    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );

    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
    assert.strictEqual(calls.length, 1, 'a single fetch');
    assert.strictEqual(calls[0].url, FILE_URL, 'fetches the given url');
    let headers = calls[0].init.headers as Record<string, string>;
    assert.notOk(headers['Authorization'], 'no Authorization on a public read');
    assert.strictEqual(headers['Accept'], SupportedMimeType.CardSource);
    assert.true(result.ok, 'result ok');
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Trip Planner\n\ninstructions',
    );
  });

  test('discovers the realm from the challenge, then mints a token', async () => {
    let sessions = stubSessions({ token: 'tok-123' });
    let n = 0;
    let { fetch, calls } = recordingFetch(() => {
      n += 1;
      return n === 1
        ? gated()
        : new Response('# Gated\n\ninstructions', { status: 200 });
    });

    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );

    assert.deepEqual(
      sessions.calls,
      [{ onBehalfOf: ON_BEHALF_OF, realm: REALM }],
      'minted for the realm named in the response header',
    );
    assert.strictEqual(calls.length, 2, 'unauthenticated probe, then authed');
    assert.notOk(
      (calls[0].init.headers as Record<string, string>)['Authorization'],
      'first fetch carries no token',
    );
    assert.strictEqual(
      (calls[1].init.headers as Record<string, string>)['Authorization'],
      'Bearer tok-123',
    );
    assert.true(result.ok, 'result ok');
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Gated\n\ninstructions',
    );
  });

  test('errors when a gated file names no realm to mint against', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch } = recordingFetch(
      () => new Response('unauthorized', { status: 401 }),
    );
    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes('which realm'),
      'error explains the realm could not be determined',
    );
    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
  });

  test('returns an error result when the file is missing (404)', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch } = recordingFetch(
      () => new Response('not found', { status: 404 }),
    );
    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok, 'result not ok');
    assert.true(
      (result as { ok: false; error: string }).error.includes('404'),
      'error mentions the status',
    );
    assert.strictEqual(sessions.calls.length, 0, 'a 404 never mints a token');
  });

  test('reports a clear message when delegation is disabled', async () => {
    let sessions = stubSessions({
      throws: new DelegatedUserRealmSessionError('disabled', 'off'),
    });
    let { fetch } = recordingFetch(() => gated());
    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes('unavailable'),
      'error explains the feature is off',
    );
  });

  test('reports no-access when the user lacks read on the realm', async () => {
    let sessions = stubSessions({
      throws: new DelegatedUserRealmSessionError('forbidden', 'nope', 403),
    });
    let { fetch } = recordingFetch(() => gated(403));
    let result = await executeReadRealmFile(
      { url: FILE_URL },
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
      // 1: unauthenticated probe → challenge (names the realm)
      // 2: authed with a stale cached token → still rejected
      // 3: authed with a freshly minted token → served
      if (n === 1) {
        return gated();
      }
      return n === 2 ? gated() : new Response('# Fresh', { status: 200 });
    });

    let result = await executeReadRealmFile(
      { url: FILE_URL },
      { onBehalfOf: ON_BEHALF_OF, delegatedUserRealmSessions: sessions, fetch },
    );

    assert.true(result.ok, 'succeeds on the retry');
    assert.strictEqual(calls.length, 3, 'probe, stale authed, fresh authed');
    assert.deepEqual(
      sessions.invalidated,
      [{ onBehalfOf: ON_BEHALF_OF, realm: REALM }],
      'dropped the stale token once',
    );
    assert.strictEqual(sessions.calls.length, 2, 're-minted a fresh token');
  });
});

function assistantMessage(toolCalls: any[]): any {
  return { role: 'assistant', content: null, tool_calls: toolCalls };
}

function fnCall(id: string, name: string, args: object = {}) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

module('classifyToolCalls', () => {
  test('splits readRealmFile (bot) from everything else (host)', () => {
    let { botToolCalls, hostToolCalls } = classifyToolCalls(
      assistantMessage([
        fnCall('c1', READ_REALM_FILE_TOOL_NAME, { url: FILE_URL }),
        fnCall('c2', 'SomeHostCommand'),
      ]),
    );
    assert.deepEqual(
      botToolCalls.map((c) => c.id),
      ['c1'],
    );
    assert.deepEqual(
      hostToolCalls.map((c) => c.id),
      ['c2'],
      'a host command and a read coexist — neither is dropped',
    );
  });

  test('no tool calls → both sets empty', () => {
    let { botToolCalls, hostToolCalls } = classifyToolCalls(
      assistantMessage([]),
    );
    assert.deepEqual(botToolCalls, []);
    assert.deepEqual(hostToolCalls, []);
  });
});

module('fileLabelFromUrl', () => {
  test('keeps the skill folder for a SKILL.md', () => {
    assert.strictEqual(
      fileLabelFromUrl(FILE_URL),
      'trip-planner/SKILL.md',
      'a skill reads as <name>/SKILL.md',
    );
  });

  test('falls back to the file name otherwise', () => {
    assert.strictEqual(
      fileLabelFromUrl('https://localhost:4201/user/jane/notes.md'),
      'notes.md',
    );
  });

  test('undefined url → undefined label', () => {
    assert.strictEqual(fileLabelFromUrl(undefined), undefined);
  });
});
