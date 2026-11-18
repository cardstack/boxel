import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { ERROR_STATE_BY_REASON } from '../src/security/oauth-error-states.js';
import {
  ErrorDetailsFailure,
  errorReturnURL,
  errorStateForReason,
  parseErrorParam,
  readAuthorizationError,
} from '../src/security/oauth-errors.ts';
import { errorCopy, returnLabel } from '../src/shell/authorize/error-copy.ts';

const REALM_SERVER = new URL('https://realm.test/');
const REF = 'A'.repeat(21) + '-_' + 'z9'.repeat(10);

describe('the error page reads only an error value from its address', () => {
  test('a reference is looked up', () => {
    assert.equal(REF.length, 43);
    assert.deepEqual(parseErrorParam(`?error=${REF}`), {
      kind: 'ref',
      ref: REF,
    });
  });

  test('the fixed values need no lookup', () => {
    assert.deepEqual(parseErrorParam('?error=expired'), {
      kind: 'fixed',
      state: 'expired',
    });
    assert.deepEqual(parseErrorParam('?error=rate_limited'), {
      kind: 'fixed',
      state: 'rate-limited',
    });
  });

  test('anything else is invalid', () => {
    for (let search of [
      '',
      '?interaction=abc',
      '?error=',
      `?error=${REF.slice(1)}`,
      `?error=${REF}A`,
      `?error=${REF.slice(3)}../`,
      `?error=${encodeURIComponent(REF.slice(1) + '/')}`,
      `?error=${REF}&error=${REF}`,
      '?error=expired&error=expired',
      '?error=constructor',
      '?error=__proto__',
      '?error=https%3A%2F%2Fattacker.example',
    ]) {
      assert.deepEqual(parseErrorParam(search), { kind: 'invalid' }, search);
    }
  });

  test('other parameters change nothing', () => {
    assert.deepEqual(
      parseErrorParam(
        `?redirect_uri=https%3A%2F%2Fattacker.example&error=${REF}&error_description=x`,
      ),
      { kind: 'ref', ref: REF },
    );
  });
});

describe('the states', () => {
  test('every reason has a state, and an unknown one has a neutral state', () => {
    for (let [reason, state] of Object.entries(ERROR_STATE_BY_REASON)) {
      assert.equal(errorStateForReason(reason), state);
    }
    assert.equal(errorStateForReason('something-new'), 'cant-continue');
    assert.equal(errorStateForReason('toString'), 'cant-continue');
  });

  test('each state words itself with the app, or with "the app"', () => {
    let app = { shown: 'example.com', onThisComputer: false };
    for (let state of [
      'bad-redirect',
      'not-offered',
      'not-allowed',
      'unsupported',
    ] as const) {
      assert.match(errorCopy(state, { app }).info, /^example\.com /, state);
      assert.doesNotMatch(errorCopy(state).info, /example\.com/, state);
      assert.match(errorCopy(state).info, /^(The|This) app /, state);
    }
    assert.match(
      errorCopy('unsupported', {
        app: { shown: 'an app on this computer', onThisComputer: true },
      }).info,
      /^An app on this computer asked/,
    );
    assert.match(
      errorCopy('unsupported', {
        app: { shown: 'my app', onThisComputer: false },
      }).info,
      /^my app asked/,
      'only the phrase for an app on this computer is capitalized',
    );
    assert.equal(
      returnLabel({ shown: 'example.com', onThisComputer: false }),
      'Return to example.com',
    );
  });
});

describe('the "Return" link', () => {
  test('goes to the realm server, by the reference alone', () => {
    assert.equal(
      errorReturnURL(REALM_SERVER, REF),
      `https://realm.test/_oauth-provider/error/${REF}/return`,
    );
  });

  test('is never built from anything but a reference', () => {
    assert.throws(() => errorReturnURL(REALM_SERVER, '../_user-keys'));
    assert.throws(() =>
      errorReturnURL(REALM_SERVER, 'https://attacker.example/'),
    );
  });
});

describe('looking an error up', () => {
  let realFetch = globalThis.fetch;
  let requests: { url: string; init: RequestInit }[] = [];

  function answer(
    respond: () => Response | Promise<Response>,
  ): typeof requests {
    requests = [];
    globalThis.fetch = (async (url: URL | string, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return respond();
    }) as typeof fetch;
    return requests;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('asks the realm server, sending no credentials or referrer', async () => {
    let sent = answer(() =>
      Response.json({
        error: 'invalid_scope',
        reason: 'openid',
        app: { kind: 'dynamic', shown: 'example.com', verified: false },
        returnOffered: true,
      }),
    );
    let details = await readAuthorizationError(REALM_SERVER, REF);
    assert.deepEqual(details, {
      state: 'not-offered',
      app: { shown: 'example.com', onThisComputer: false },
      returnOffered: true,
    });
    assert.equal(sent.length, 1);
    assert.equal(
      sent[0]!.url,
      `https://realm.test/_oauth-provider/error/${REF}`,
    );
    assert.equal(sent[0]!.init.credentials, 'omit');
    assert.equal(sent[0]!.init.referrerPolicy, 'no-referrer');
  });

  test('keeps nothing of the app but the name Boxel can check', async () => {
    answer(() =>
      Response.json({
        error: 'invalid_target',
        reason: 'client-not-allowed',
        app: {
          kind: 'dynamic',
          shown: 'example.com',
          verified: false,
          claimedName: 'Totally Boxel',
        },
        returnOffered: true,
      }),
    );
    let details = await readAuthorizationError(REALM_SERVER, REF);
    assert.deepEqual(details.app, {
      shown: 'example.com',
      onThisComputer: false,
    });
    assert.doesNotMatch(JSON.stringify(details), /Totally Boxel/);
  });

  test('knows a stand-in for an app by its marker, not its words', async () => {
    let read = async (app: unknown) => {
      answer(() =>
        Response.json({ reason: 'prompt-none', app, returnOffered: true }),
      );
      return readAuthorizationError(REALM_SERVER, REF);
    };
    assert.deepEqual(
      (
        await read({
          kind: 'dynamic',
          shown: 'an app on this computer',
          verified: false,
          standIn: 'loopback',
        })
      ).app,
      { shown: 'an app on this computer', onThisComputer: true },
    );
    let unknown = await read({
      kind: 'dynamic',
      shown: 'an unknown app',
      verified: false,
      standIn: 'unknown',
    });
    assert.equal(unknown.app, undefined, 'an app with no name is no app');
    assert.equal(unknown.returnOffered, false);
  });

  test('an unknown reference is an expired request', async () => {
    answer(() => Response.json({ error: 'expired' }, { status: 404 }));
    assert.deepEqual(await readAuthorizationError(REALM_SERVER, REF), {
      state: 'expired',
      returnOffered: false,
    });
  });

  test("a 404 that doesn't say the reference expired is a failure", async () => {
    for (let respond of [
      () => new Response('Not Found', { status: 404 }),
      () => Response.json({ error: 'not_found' }, { status: 404 }),
      () => Response.json({}, { status: 404 }),
    ]) {
      answer(respond);
      await assert.rejects(
        readAuthorizationError(REALM_SERVER, REF),
        (e: unknown) =>
          e instanceof ErrorDetailsFailure && e.status === 404 && !e.retryable,
      );
    }
  });

  test('"Return" is offered as the realm server says, when there is a name for it', async () => {
    let cases: [unknown, boolean][] = [
      [{ reason: 'prompt-none', returnOffered: true }, false],
      [
        {
          reason: 'prompt-none',
          app: { shown: 'an unknown app', standIn: 'unknown' },
          returnOffered: true,
        },
        false,
      ],
      [
        {
          reason: 'prompt-none',
          app: { shown: 'example.com' },
          returnOffered: false,
        },
        false,
      ],
      [
        {
          reason: 'library',
          app: { shown: 'example.com' },
          returnOffered: true,
        },
        true,
      ],
      [
        {
          reason: 'prompt-none',
          app: { shown: 'example.com' },
          returnOffered: 'true',
        },
        false,
      ],
      [
        {
          reason: 'prompt-none',
          app: { shown: 'example.com' },
          returnOffered: true,
        },
        true,
      ],
    ];
    for (let [body, offered] of cases) {
      answer(() => Response.json(body));
      let details = await readAuthorizationError(REALM_SERVER, REF);
      assert.equal(details.returnOffered, offered, JSON.stringify(body));
    }
  });

  test('a refusal, a server error, an unusable answer or no answer is a failure', async () => {
    let cases: [() => Response, number, boolean][] = [
      [
        () => Response.json({ error: 'forbidden' }, { status: 403 }),
        403,
        false,
      ],
      [() => new Response('', { status: 500 }), 500, true],
      [() => new Response('', { status: 429 }), 429, true],
      [() => new Response('<html>Sign in to the Wi-Fi</html>'), 200, false],
      [() => Response.json({ error: 'x' }), 200, false],
      [
        () => {
          throw new TypeError('Failed to fetch');
        },
        0,
        true,
      ],
    ];
    for (let [respond, status, retryable] of cases) {
      answer(respond);
      await assert.rejects(
        readAuthorizationError(REALM_SERVER, REF),
        (e: unknown) =>
          e instanceof ErrorDetailsFailure &&
          e.status === status &&
          e.retryable === retryable,
      );
    }
  });

  test('never looks up anything but a reference', async () => {
    let sent = answer(() => Response.json({}));
    await assert.rejects(readAuthorizationError(REALM_SERVER, '../_user-keys'));
    assert.equal(sent.length, 0);
  });
});
