import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, test } from 'node:test';

import {
  cliCallback,
  handoffFields,
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
  isGoogleCallback,
  modeURL,
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
});

describe('handToCli', () => {
  const callback = { url: 'http://127.0.0.1:51234/callback', state: STATE };
  const session = {
    token: 'secure-session-token',
    user: '@someone:example.test',
    expiresAt: '2030-01-01T00:00:00.000Z',
  };

  test('sends the CLI its state and the session', () => {
    assert.deepEqual(handoffFields(callback, session), [
      ['state', STATE],
      ['secure_session', 'secure-session-token'],
      ['user_id', '@someone:example.test'],
      ['expires_at', '2030-01-01T00:00:00.000Z'],
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
    let form = handToCli(callback, session, doc as unknown as Document) as any;
    assert.equal(form.method, 'POST');
    assert.equal(form.action, 'http://127.0.0.1:51234/callback');
    assert.deepEqual(
      form.children.map((input: any) => [input.type, input.name, input.value]),
      handoffFields(callback, session).map(([name, value]) => [
        'hidden',
        name,
        value,
      ]),
    );
    assert.deepEqual(appended, [form], 'the form is in the page');
    assert.equal(submitted, 1, 'it is submitted once');
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
      undefined,
    ]) {
      assert.throws(
        () => handToCli(callback as any, session, doc),
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

  test('a mode is the shell with a `mode` parameter', () => {
    at('/secure/');
    assert.equal(shellPath(), '/secure/');
    assert.equal(modeURL('sign-in'), '/secure/?mode=sign-in');
    assert.equal(
      modeURL('register', { port: '51234', state: STATE, user: '' }),
      `/secure/?mode=register&port=51234&state=${STATE}`,
      'an empty value is left out',
    );
  });

  test("Google's callback is beneath the shell", () => {
    at('/secure/google-callback');
    assert.ok(isGoogleCallback());
    assert.equal(shellPath(), '/secure/');
    assert.equal(modeURL('sign-in'), '/secure/?mode=sign-in');
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

  test('starting a Google sign-in again returns to the page it began on', () => {
    at('/secure/google-callback');
    assert.equal(startURL(undefined), '/secure/?mode=sign-in');
    assert.equal(startURL({ client: 'window' }), '/secure/?mode=sign-in');
    assert.equal(
      startURL({
        client: 'cli',
        cli: { url: 'http://127.0.0.1:51234/callback', state: STATE },
        username: 'someone',
      }),
      `/secure/?mode=cli-sign-in&port=51234&state=${STATE}&user=someone`,
    );
    assert.equal(
      startURL({ client: 'cli' }),
      '/secure/?mode=sign-in',
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

// `shell.css` styles the pages `dom.js` still draws, with the same class names
// the components use. Each of its component rules is scoped to the plain
// pages' root, so none of them reaches a component; only the page-wide rules
// (the reset, the typeface, the page's background) are left global.
test("shell.css's component rules reach only the plain pages", () => {
  let css = readFileSync(
    new URL('../src/shell/shell.css', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  let components = css.slice(css.indexOf('@layer boxel {'));
  let unscoped = [...components.matchAll(/([^{};]+)\{/g)]
    .map(([, selector]) => selector.trim())
    .filter((selector) => !/^(@|from$|to$|body$|\.plain-page$)/.test(selector))
    .flatMap((selector) =>
      selector.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    )
    .filter((selector) => !selector.startsWith(':where(.plain-page) '));
  assert.deepEqual(unscoped, []);
});
