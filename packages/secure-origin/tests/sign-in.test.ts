import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  cliCallback,
  handoffFields,
  handProfileSignIn,
  handToCli,
  isCliCallback,
} from '../src/security/cli-handoff.js';
import {
  asSentence,
  signInFailed,
  tooManyFailedAttempts,
} from '../src/shell/sign-in-copy.js';
import {
  cliParams,
  currentPage,
  isGoogleCallback,
  pageURL,
  shellPath,
  startURL,
} from '../src/shell/urls.js';

const STATE = 'abcdefghijklmnop0123';

function params(query: Record<string, string>) {
  return new URLSearchParams(query);
}

describe('cliCallback', () => {
  test('names a listener on this machine, on the port the CLI gave', () => {
    assert.deepEqual(cliCallback(params({ port: '51234', state: STATE })), {
      url: 'http://127.0.0.1:51234/callback',
      state: STATE,
    });
  });

  test('refuses a port that is not one', () => {
    for (let port of ['', '0', '65536', '-1', '80.5', 'abc', '1e3x']) {
      assert.equal(
        cliCallback(params({ port, state: STATE })),
        undefined,
        `port ${JSON.stringify(port)}`,
      );
    }
  });

  test('refuses a state the CLI could not have made', () => {
    for (let state of [
      '',
      'short',
      'a'.repeat(129),
      `${STATE}/`,
      `${STATE}@evil.example`,
      `${STATE} `,
    ]) {
      assert.equal(
        cliCallback(params({ port: '51234', state })),
        undefined,
        `state ${JSON.stringify(state)}`,
      );
    }
  });

  test('refuses a link without a port or state', () => {
    assert.equal(cliCallback(params({ state: STATE })), undefined);
    assert.equal(cliCallback(params({ port: '51234' })), undefined);
  });

  test('a profile sign-in says whether the CLI takes a secure session too', () => {
    let listener = {
      url: 'http://127.0.0.1:51234/callback',
      state: STATE,
    };
    assert.deepEqual(
      cliCallback(params({ port: '51234', state: STATE }), { profile: true }),
      { ...listener, profile: { secureSession: false } },
      'the cli-auth page is a profile sign-in whatever its address says',
    );
    assert.deepEqual(
      cliCallback(params({ port: '51234', state: STATE, session: 'secure' }), {
        profile: true,
      }),
      { ...listener, profile: { secureSession: true } },
    );
    assert.deepEqual(
      cliCallback(
        params({
          port: '51234',
          state: STATE,
          cli: 'profile',
          session: 'secure',
        }),
      ),
      { ...listener, profile: { secureSession: true } },
      'the pages a profile sign-in links to read it from `cli=profile`',
    );
    assert.deepEqual(
      cliCallback(params({ port: '51234', state: STATE, session: 'secure' })),
      listener,
      '`boxel keys sign-in` is handed a secure session alone',
    );
  });
});

describe('handToCli', () => {
  const callback = { url: 'http://127.0.0.1:51234/callback', state: STATE };
  const session = {
    token: 'secure-session-token',
    user: '@someone:example.test',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };

  test('sends the CLI its state and the session', () => {
    assert.deepEqual(handoffFields(callback, { session }), [
      ['state', STATE],
      ['secure_session', 'secure-session-token'],
      ['user_id', '@someone:example.test'],
      ['expires_at', '2030-01-01T00:00:00.000Z'],
    ]);
  });

  test('sends a profile sign-in its login token, with the session it takes', () => {
    assert.deepEqual(
      handoffFields(callback, { loginToken: 'login-token', session }),
      [
        ['state', STATE],
        ['login_token', 'login-token'],
        ['secure_session', 'secure-session-token'],
        ['user_id', '@someone:example.test'],
        ['expires_at', '2030-01-01T00:00:00.000Z'],
      ],
    );
  });

  test('sends an OAuth sign-in the CLI started its code and state, or why it has none, and no session', () => {
    assert.deepEqual(
      handoffFields(callback, {
        oauth: { code: 'one-use-code', state: 'sign-in-state' },
      }),
      [
        ['state', STATE],
        ['oauth_code', 'one-use-code'],
        ['oauth_state', 'sign-in-state'],
      ],
    );
    assert.deepEqual(handoffFields(callback, { oauth: { error: 'denied' } }), [
      ['state', STATE],
      ['oauth_error', 'denied'],
    ]);
  });

  test('tells the CLI a change it opened the window for ended, and sends nothing else', () => {
    assert.deepEqual(handoffFields(callback, { window: 'done' }), [
      ['state', STATE],
      ['window_outcome', 'done'],
    ]);
  });

  test('tells the CLI a change it opened the window for was cancelled, and sends nothing else', () => {
    assert.deepEqual(handoffFields(callback, { window: 'cancelled' }), [
      ['state', STATE],
      ['window_outcome', 'cancelled'],
    ]);
  });

  test('sends a login token alone the way every CLI accepts it: in the query of a navigation to the listener', () => {
    let navigated: string[] = [];
    let doc = {
      createElement() {
        throw new Error('no form is made');
      },
    } as unknown as Document;
    let form = handToCli(
      callback,
      { loginToken: 'login token' },
      { doc, navigate: (url: string) => navigated.push(url) },
    );
    assert.equal(form, undefined);
    assert.deepEqual(navigated, [
      `http://127.0.0.1:51234/callback?state=${STATE}&loginToken=login+token`,
    ]);
  });

  test('posts them to the listener as a top-level form submission', () => {
    let appended: unknown[] = [];
    let submitted = 0;
    function element(tag: string) {
      return {
        tag,
        children: [] as unknown[],
        attributes: {} as Record<string, string>,
        append(...nodes: unknown[]) {
          this.children.push(...nodes);
        },
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
        submit() {
          submitted++;
        },
      } as Record<string, any>;
    }
    let doc = {
      createElement: element,
      body: { append: (node: unknown) => appended.push(node) },
    };
    let form = handToCli(
      callback,
      { session },
      { doc: doc as unknown as Document },
    ) as any;
    assert.equal(form.method, 'POST');
    assert.equal(form.action, 'http://127.0.0.1:51234/callback');
    assert.deepEqual(
      form.children.map((input: any) => [input.type, input.name, input.value]),
      handoffFields(callback, { session }).map(([name, value]) => [
        'hidden',
        name,
        value,
      ]),
    );
    assert.deepEqual(appended, [form], 'the form is in the page');
    assert.equal(submitted, 1, 'it is submitted once');
  });
});

describe('handProfileSignIn', () => {
  const session = {
    token: 'secure-session-token',
    user: '@someone:example.test',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
  const listener = { url: 'http://127.0.0.1:51234/callback', state: STATE };

  function recorder() {
    let calls: string[] = [];
    let posted: unknown[] = [];
    let doc = {
      createElement(tag: string) {
        return {
          tag,
          children: [] as any[],
          append(...nodes: unknown[]) {
            this.children.push(...nodes);
          },
          setAttribute() {},
          submit() {
            calls.push('post');
            posted.push(this);
          },
        };
      },
      body: { append() {} },
    } as unknown as Document;
    return {
      calls,
      posted,
      requests: {
        mintLoginToken: async () => {
          calls.push('mint');
          return 'login-token';
        },
        endSession: async (ended: typeof session) => {
          calls.push(`end ${ended.token}`);
        },
        doc,
        navigate: (url: string) => calls.push(`navigate ${url}`),
      },
    };
  }

  test('a CLI that takes a secure session is posted the login token with it, and the session lives on', async () => {
    let { calls, posted, requests } = recorder();
    await handProfileSignIn(
      { ...listener, profile: { secureSession: true } },
      session,
      requests,
    );
    assert.deepEqual(calls, ['mint', 'post']);
    assert.deepEqual(
      (posted[0] as any).children.map((input: any) => input.name),
      ['state', 'login_token', 'secure_session', 'user_id', 'expires_at'],
    );
  });

  test('a CLI that takes none is sent the login token only once the session is ended', async () => {
    let { calls, requests } = recorder();
    await handProfileSignIn(
      { ...listener, profile: { secureSession: false } },
      session,
      requests,
    );
    assert.deepEqual(calls, [
      'mint',
      'end secure-session-token',
      `navigate http://127.0.0.1:51234/callback?state=${STATE}&loginToken=login-token`,
    ]);
  });

  test('a token that can’t be minted ends the session, and the failure is the caller’s to show', async () => {
    let { calls, requests } = recorder();
    await assert.rejects(
      handProfileSignIn(
        { ...listener, profile: { secureSession: true } },
        session,
        {
          ...requests,
          mintLoginToken: async () => {
            throw new Error('signing in is unavailable right now');
          },
        },
      ),
      /unavailable/,
    );
    assert.deepEqual(calls, ['end secure-session-token']);
  });

  test('a failure to end the session doesn’t keep the CLI from its token', async () => {
    let { calls, requests } = recorder();
    await handProfileSignIn(
      { ...listener, profile: { secureSession: false } },
      session,
      {
        ...requests,
        endSession: async () => {
          throw new Error('Boxel could not be reached.');
        },
      },
    );
    assert.match(calls.at(-1)!, /^navigate /);
  });
});

describe('a hand-off target that is not the loopback listener', () => {
  const session = { token: 't', user: '@u:example.test', expiresAt: 'x' };

  test('every callback cliCallback makes is one', () => {
    for (let port of ['1', '51234', '65535']) {
      assert.ok(isCliCallback(cliCallback(params({ port, state: STATE }))));
    }
  });

  test('is refused before anything is posted', () => {
    let created = 0;
    let doc = {
      createElement() {
        created++;
        return {};
      },
      body: { append() {} },
    } as unknown as Document;
    for (let callback of [
      { url: 'https://evil.example/callback', state: STATE },
      { url: 'http://127.0.0.1.evil.example:51234/callback', state: STATE },
      { url: 'http://localhost:51234/callback', state: STATE },
      { url: 'http://127.0.0.1:51234/elsewhere', state: STATE },
      { url: 'http://127.0.0.1:51234/callback?x=1', state: STATE },
      { url: 'http://127.0.0.1:70000/callback', state: STATE },
      { url: 'http://127.0.0.1:51234/callback', state: 'short' },
      { url: 'http://127.0.0.1:51234/callback' },
      {
        url: 'http://127.0.0.1:51234/callback',
        state: STATE,
        profile: { secureSession: 'yes' },
      },
      { url: 'http://127.0.0.1:51234/callback', state: STATE, profile: true },
      undefined,
    ]) {
      assert.throws(
        () =>
          handToCli(
            callback as any,
            { loginToken: 'login-token', session },
            { doc, navigate: () => created++ },
          ),
        /names no listener on this machine/,
        JSON.stringify(callback),
      );
    }
    assert.equal(created, 0, 'no form is made');
  });
});

describe("the shell's addresses", () => {
  let original = (globalThis as any).window;
  afterEach(() => {
    (globalThis as any).window = original;
  });
  function at(pathname: string) {
    (globalThis as any).window = { location: { pathname } };
  }

  test('a page is at its own path beneath the shell', () => {
    at('/secure/');
    assert.equal(shellPath(), '/secure/');
    assert.equal(pageURL('sign-in'), '/secure/sign-in');
    assert.equal(
      pageURL('register', { port: '51234', state: STATE, user: '' }),
      `/secure/register?port=51234&state=${STATE}`,
      'an empty value is left out',
    );
    at('/');
    assert.equal(pageURL('sign-in'), '/sign-in', 'deployed at the root');
  });

  test("the shell's address is the same from every page beneath it", () => {
    for (let path of [
      '/secure',
      '/secure/',
      '/secure/sign-in',
      '/secure/keys',
      '/secure/keys/add',
      '/secure/keys/0b6c1e9e-5a1f-4c47-9d0e-2f5b8f6f1a3c/share',
    ]) {
      at(path);
      assert.equal(shellPath(), '/secure/', path);
    }
    at('/secure/keys/add');
    assert.equal(currentPage(), 'keys/add');
    at('/secure');
    assert.equal(currentPage(), '');
  });

  test("Google's callback is beneath the shell", () => {
    at('/secure/google-callback');
    assert.ok(isGoogleCallback());
    assert.equal(shellPath(), '/secure/');
    assert.equal(pageURL('sign-in'), '/secure/sign-in');
    at('/secure/');
    assert.ok(!isGoogleCallback());
  });

  test("the CLI's pages carry its port, state and username", () => {
    let cli = { url: 'http://127.0.0.1:51234/callback', state: STATE };
    assert.deepEqual(cliParams(cli, 'someone'), {
      port: '51234',
      state: STATE,
      user: 'someone',
    });
    assert.deepEqual(cliParams(cli, ''), {
      port: '51234',
      state: STATE,
      user: undefined,
    });
    assert.deepEqual(cliParams(undefined, 'someone'), {});
  });

  test("a profile sign-in's pages carry that it is one, and whether it takes a secure session", () => {
    at('/secure/');
    let cli = {
      url: 'http://127.0.0.1:51234/callback',
      state: STATE,
      profile: { secureSession: true },
    };
    assert.deepEqual(cliParams(cli), {
      port: '51234',
      state: STATE,
      user: undefined,
      cli: 'profile',
      session: 'secure',
    });
    assert.deepEqual(cliParams({ ...cli, profile: { secureSession: false } }), {
      port: '51234',
      state: STATE,
      user: undefined,
      cli: 'profile',
      session: undefined,
    });
    assert.deepEqual(
      cliCallback(
        new URLSearchParams(pageURL('register', cliParams(cli)).split('?')[1]),
      ),
      cli,
      'and the page they reach reads the same CLI back',
    );
  });

  test('starting a Google sign-in again returns to the page it began on', () => {
    at('/secure/google-callback');
    assert.equal(startURL(undefined), '/secure/sign-in');
    assert.equal(startURL({ client: 'window' }), '/secure/sign-in');
    assert.equal(
      startURL({
        client: 'cli',
        cli: { url: 'http://127.0.0.1:51234/callback', state: STATE },
        username: 'someone',
      }),
      `/secure/cli-sign-in?port=51234&state=${STATE}&user=someone`,
    );
    assert.equal(
      startURL({
        client: 'cli',
        cli: {
          url: 'http://127.0.0.1:51234/callback',
          state: STATE,
          profile: { secureSession: true },
        },
      }),
      `/secure/cli-auth?port=51234&state=${STATE}&cli=profile&session=secure`,
      'a profile sign-in starts again on its own page',
    );
    assert.equal(
      startURL({ client: 'cli' }),
      '/secure/sign-in',
      "a CLI sign-in that lost its listener starts the window's own",
    );
  });
});

// The app's sign-in words a refused sign-in as these do, without the leading
// "Sign-in failed."; the host's unit test of `extractMatrixErrorMessage`
// pins the app's side.
describe('what a failed sign-in says', () => {
  test('too many failed attempts says how long to wait', () => {
    assert.equal(
      signInFailed({ code: 'rate-limited', retryAfterMs: 191117 }),
      'Sign-in failed. Too many failed attempts, try again in 4 minutes.',
    );
    assert.equal(
      signInFailed({ code: 'rate-limited' }),
      'Sign-in failed. Too many failed attempts, try again later.',
    );
    assert.equal(
      tooManyFailedAttempts(191117),
      signInFailed({ code: 'rate-limited', retryAfterMs: 191117 }),
    );
  });

  test('a refused password or account asks to check the credentials', () => {
    assert.equal(
      signInFailed({ code: 'invalid-credentials', message: 'Forbidden' }),
      'Sign-in failed. Please check your credentials and try again.',
    );
  });

  test("any other failure gives the server's reason as a sentence", () => {
    assert.equal(
      signInFailed({ message: 'internal Server Error' }),
      'Sign-in failed. Internal Server Error.',
    );
    assert.equal(
      signInFailed({ message: 'Could not connect to server.' }),
      'Sign-in failed. Could not connect to server.',
    );
    assert.equal(signInFailed({}), 'Sign-in failed.');
    assert.equal(signInFailed(undefined), 'Sign-in failed.');
  });

  test("the server's errors read as sentences", () => {
    assert.equal(asSentence('state mismatch'), 'State mismatch.');
    assert.equal(asSentence('Already done!'), 'Already done!');
    assert.equal(asSentence('  '), '');
    assert.equal(asSentence(undefined), '');
  });
});
