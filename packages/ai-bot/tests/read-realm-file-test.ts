import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common';
import { DelegatedUserRealmSessionError } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import {
  executeReadRealmFile,
  readRealmFileTool,
  classifyToolCalls,
  fileLabelFromUrl,
  readFilesLabel,
  READ_REALM_FILE_TOOL_NAME,
} from '../lib/read-realm-file.ts';

const ON_BEHALF_OF = '@user:localhost';
const REALM = 'https://localhost:4201/user/jane/';
// A markdown file: read via its indexed file-meta document.
const FILE_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md';
// A non-markdown file: read as raw source, exactly as before file-meta reads
// existed — the transport/auth-flow tests use this one.
const RAW_FILE_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/reference/cities.txt';

// A gated file's response: the realm server names the owning realm even on the
// auth challenge, which is how executeReadRealmFile discovers the realm.
function gated(status: 401 | 403 = 401): Response {
  return new Response('unauthorized', {
    status,
    headers: { 'x-boxel-realm-url': REALM },
  });
}

// The tool entry stamped onto the skill's indexed file-meta (resolved
// codeRef, functionName, requiresApproval, ready-to-use LLM definition).
const STAMPED_TOOL = {
  codeRef: {
    module: 'https://localhost:4201/user/jane/tools/plan-trip',
    name: 'default',
  },
  functionName: 'plan-trip_ab12',
  requiresApproval: true,
  definition: {
    type: 'function',
    function: {
      name: 'plan-trip_ab12',
      description: 'Plans a trip',
      parameters: { type: 'object', properties: {} },
    },
  },
};

// A skill markdown file's file-meta document: frontmatter-stripped body in
// `attributes.content`, tools on `attributes.frontmatter.tools`.
function fileMetaResponse(
  attributes: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: FILE_URL,
        type: 'file-meta',
        attributes: { sourceUrl: FILE_URL, ...attributes },
      },
    }),
    { status },
  );
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
    assert.deepEqual(required, ['urls'], 'only urls is required');
    let properties = (readRealmFileTool.function.parameters as any)
      .properties as Record<string, any>;
    assert.strictEqual(
      properties['urls']?.type,
      'array',
      'many files read in one call — a per-turn trickle of single reads is the latency we are avoiding',
    );
    assert.notOk(
      properties['realm'],
      'realm is discovered, not asked of the model',
    );
    assert.true(
      readRealmFileTool.function.description.includes('next turn'),
      'description tells the model that reading a skill file unlocks its ' +
        'tools on the next turn — without this the mechanism goes unused',
    );
  });
});

module('executeReadRealmFile', () => {
  test('reads a public file from the first fetch with no token', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch, calls } = recordingFetch(
      () => new Response('# Trip Planner\n\ninstructions', { status: 200 }),
    );

    let result = await executeReadRealmFile(RAW_FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
    assert.strictEqual(calls.length, 1, 'a single fetch');
    assert.strictEqual(calls[0].url, RAW_FILE_URL, 'fetches the given url');
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

    let result = await executeReadRealmFile(RAW_FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

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
    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });
    assert.false(result.ok);
    assert.true(
      (result as { ok: false; error: string }).error.includes('which realm'),
      'error explains the realm could not be determined',
    );
    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
  });

  test('refuses to mint when the claimed realm does not contain the file', async () => {
    let sessions = stubSessions({ token: 'tok' });
    // A host answering for FILE_URL claims a realm on a different origin; the
    // delegated token for that realm must not be minted or sent back to it.
    let { fetch, calls } = recordingFetch(
      () =>
        new Response('unauthorized', {
          status: 401,
          headers: { 'x-boxel-realm-url': 'https://other.example/user/mary/' },
        }),
    );
    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });
    assert.false(result.ok, 'result not ok');
    assert.true(
      (result as { ok: false; error: string }).error.includes(
        'does not belong to the realm',
      ),
      'error explains the mismatch',
    );
    assert.strictEqual(sessions.calls.length, 0, 'no token minted');
    assert.strictEqual(calls.length, 1, 'no authenticated retry');
  });

  test('returns an error result when the file is missing (404)', async () => {
    let sessions = stubSessions({ token: 'tok' });
    let { fetch } = recordingFetch(
      () => new Response('not found', { status: 404 }),
    );
    let result = await executeReadRealmFile(RAW_FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });
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
    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });
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
    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });
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

    let result = await executeReadRealmFile(RAW_FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

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

module('executeReadRealmFile markdown file-meta', () => {
  const BODY = '# Trip Planner\n\ninstructions';

  test('reads a skill .md via file-meta: body + stamped tools', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch, calls } = recordingFetch(() =>
      fileMetaResponse({
        content: BODY,
        frontmatter: { name: 'Trip Planner', tools: [STAMPED_TOOL] },
      }),
    );

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(calls.length, 1, 'a single file-meta fetch');
    assert.strictEqual(
      (calls[0].init.headers as Record<string, string>)['Accept'],
      SupportedMimeType.FileMeta,
      'markdown requests the indexed file-meta document',
    );
    assert.true(result.ok, 'result ok');
    let ok = result as { ok: true; content: string; tools?: unknown[] };
    assert.strictEqual(
      ok.content,
      BODY,
      'content is the frontmatter-stripped body from the index',
    );
    assert.deepEqual(
      ok.tools,
      [STAMPED_TOOL],
      'stamped tools pass through structurally',
    );
  });

  test('a plain .md (no frontmatter tools) returns body and no tools', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch } = recordingFetch(() =>
      fileMetaResponse({ content: '# A realm README' }),
    );

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.true(result.ok, 'result ok');
    let ok = result as { ok: true; content: string; tools?: unknown[] };
    assert.strictEqual(ok.content, '# A realm README');
    assert.false('tools' in ok, 'no tools key when the file declares none');
  });

  test('non-object tool entries are dropped', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch } = recordingFetch(() =>
      fileMetaResponse({
        content: BODY,
        frontmatter: {
          tools: [null, 'bogus', ['not', 'a', 'tool'], 7, STAMPED_TOOL],
        },
      }),
    );

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.true(result.ok);
    assert.deepEqual(
      (result as { ok: true; tools?: unknown[] }).tools,
      [STAMPED_TOOL],
      'only object entries survive — arrays are objects to typeof, so the ' +
        'filter must exclude them explicitly',
    );
  });

  test('a pre-rename row (frontmatter.commands) reports its entries as tools', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let unstamped = { codeRef: { module: `${REALM}tools/plan`, name: 'x' } };
    let { fetch } = recordingFetch(() =>
      fileMetaResponse({
        content: BODY,
        frontmatter: { commands: [unstamped] },
      }),
    );

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.true(result.ok);
    assert.deepEqual(
      (result as { ok: true; tools?: unknown[] }).tools,
      [unstamped],
      'legacy-key entries pass through so downstream can report the skill ' +
        'declares tools it cannot offer',
    );
  });

  test('an unindexed .md (file-meta 404) falls back to raw source', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let raw = '---\nname: trip\n---\n# Raw body';
    let { fetch, calls } = recordingFetch((_url, init) => {
      let accept = (init.headers as Record<string, string>)['Accept'];
      return accept === SupportedMimeType.FileMeta
        ? new Response('not found', { status: 404 })
        : new Response(raw, { status: 200 });
    });

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(calls.length, 2, 'file-meta attempt, then raw source');
    assert.strictEqual(
      (calls[1].init.headers as Record<string, string>)['Accept'],
      SupportedMimeType.CardSource,
      'fallback requests raw source',
    );
    assert.true(result.ok, 'index lag never fails a read');
    let ok = result as { ok: true; content: string; tools?: unknown[] };
    assert.strictEqual(ok.content, raw, 'raw source returned as-is');
    assert.false('tools' in ok, 'instructions-only on the fallback path');
  });

  test('a file-meta document without content falls back to raw source', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch, calls } = recordingFetch((_url, init) => {
      let accept = (init.headers as Record<string, string>)['Accept'];
      // e.g. an error-state row served as a document with no content
      return accept === SupportedMimeType.FileMeta
        ? fileMetaResponse({ frontmatter: { name: 'broken' } })
        : new Response('# Raw', { status: 200 });
    });

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(calls.length, 2, 'file-meta attempt, then raw source');
    assert.true(result.ok);
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Raw',
    );
  });

  test('a non-JSON file-meta body falls back to raw source', async () => {
    let sessions = stubSessions({ token: 'unused' });
    let { fetch, calls } = recordingFetch((_url, init) => {
      let accept = (init.headers as Record<string, string>)['Accept'];
      return accept === SupportedMimeType.FileMeta
        ? new Response('<!doctype html>oops', { status: 200 })
        : new Response('# Raw', { status: 200 });
    });

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(calls.length, 2, 'file-meta attempt, then raw source');
    assert.true(result.ok);
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Raw',
    );
  });

  test('a gated .md mints a token and reads file-meta with it', async () => {
    let sessions = stubSessions({ token: 'tok-md' });
    let n = 0;
    let { fetch, calls } = recordingFetch(() => {
      n += 1;
      return n === 1
        ? gated()
        : fileMetaResponse({
            content: BODY,
            frontmatter: { tools: [STAMPED_TOOL] },
          });
    });

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(calls.length, 2, 'probe, then authed file-meta fetch');
    for (let call of calls) {
      assert.strictEqual(
        (call.init.headers as Record<string, string>)['Accept'],
        SupportedMimeType.FileMeta,
        'both fetches request file-meta',
      );
    }
    assert.strictEqual(
      (calls[1].init.headers as Record<string, string>)['Authorization'],
      'Bearer tok-md',
    );
    assert.true(result.ok);
    assert.deepEqual(
      (result as { ok: true; tools?: unknown[] }).tools,
      [STAMPED_TOOL],
      'gated skills still surface their tools',
    );
  });

  test('the raw-source fallback re-runs the auth flow for a gated .md', async () => {
    let sessions = stubSessions({ token: 'tok-md' });
    let { fetch, calls } = recordingFetch((_url, init) => {
      let headers = init.headers as Record<string, string>;
      if (!headers['Authorization']) {
        return gated();
      }
      // Authed: the index has no row yet, but raw source exists.
      return headers['Accept'] === SupportedMimeType.FileMeta
        ? new Response('not found', { status: 404 })
        : new Response('# Raw gated body', { status: 200 });
    });

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.strictEqual(
      calls.length,
      4,
      'probe + authed file-meta, then probe + authed raw source',
    );
    assert.true(result.ok, 'gated index lag still degrades to raw source');
    assert.strictEqual(
      (result as { ok: true; content: string }).content,
      '# Raw gated body',
    );
  });

  test('an access failure on the file-meta path does not retry as raw source', async () => {
    let sessions = stubSessions({
      throws: new DelegatedUserRealmSessionError('forbidden', 'nope', 403),
    });
    let { fetch, calls } = recordingFetch(() => gated(403));

    let result = await executeReadRealmFile(FILE_URL, {
      onBehalfOf: ON_BEHALF_OF,
      delegatedUserRealmSessions: sessions,
      fetch,
    });

    assert.false(result.ok, 'no access is a real failure');
    assert.strictEqual(
      calls.length,
      1,
      'raw source would be forbidden identically — no fallback fetch',
    );
    assert.true(
      (result as { ok: false; error: string }).error.includes('no read access'),
    );
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
        fnCall('c1', READ_REALM_FILE_TOOL_NAME, { urls: [FILE_URL] }),
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

module('readFilesLabel', () => {
  test('no urls → generic label', () => {
    assert.strictEqual(readFilesLabel(undefined), 'Read files');
    assert.strictEqual(readFilesLabel([]), 'Read files');
  });

  test('one url → singular label', () => {
    assert.strictEqual(
      readFilesLabel([FILE_URL]),
      'Read file: trip-planner/SKILL.md',
    );
  });

  test('several urls → names joined', () => {
    assert.strictEqual(
      readFilesLabel([
        'https://localhost:4201/user/jane/a.md',
        'https://localhost:4201/user/jane/b.md',
      ]),
      'Read files: a.md, b.md',
    );
  });

  test('caps the number of names and counts the rest', () => {
    let urls = Array.from(
      { length: 8 },
      (_, i) => `https://localhost:4201/user/jane/f${i}.md`,
    );
    assert.strictEqual(
      readFilesLabel(urls),
      'Read files: f0.md, f1.md, f2.md, f3.md, f4.md, and 3 more',
    );
  });

  test('drops non-string entries', () => {
    assert.strictEqual(
      readFilesLabel([
        'https://localhost:4201/user/jane/a.md',
        42,
        null,
        { url: 'x' },
      ]),
      'Read file: a.md',
    );
  });
});
