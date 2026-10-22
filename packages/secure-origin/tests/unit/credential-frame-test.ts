import { module, test } from 'qunit';

import {
  CredentialFrame,
  FORMS,
  mayStart,
  readConfig,
  readParams,
} from '../../src/security/credentials.js';

const APP_ORIGIN = 'https://app.example.test';
const MATRIX_URL = new URL('https://matrix.example.test/');

interface Request {
  url: string;
  headers: Record<string, string>;
  body: any;
}

interface Harness {
  frame: CredentialFrame;
  parent: object;
  sent: any[];
  requests: Request[];
  ended: { username: string; password: string }[];
  submitted: { count: number };
  styled: any[];
  receive(data: unknown, from?: { source?: unknown; origin?: string }): void;
  sentOfType(type: string): any[];
}

// A frame for `formName`, with everything it reaches outside itself
// recorded. `respond` answers each Matrix request, by its path.
function harness(
  formName: keyof typeof FORMS,
  {
    respond = () => ({ status: 200, body: {} }),
    height = () => 100,
    rendered = () => Promise.resolve(),
  }: {
    respond?: (path: string, body: any) => { status: number; body: unknown };
    height?: () => number;
    rendered?: () => Promise<unknown>;
  } = {},
): Harness {
  let parent = {};
  let sent: any[] = [];
  let requests: Request[] = [];
  let ended: { username: string; password: string }[] = [];
  let submitted = { count: 0 };
  let styled: any[] = [];
  let frame = new CredentialFrame({
    form: FORMS[formName],
    appOrigin: APP_ORIGIN,
    matrixURL: MATRIX_URL,
    parent,
    send: (message) => sent.push(message),
    applyStyle: (message) => styled.push(message),
    measure: height,
    requestSubmit: () => submitted.count++,
    rendered,
    fetch: async (url, init) => {
      let body = JSON.parse(String(init.body));
      requests.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body,
      });
      let path = String(url).slice(
        `${MATRIX_URL.href}_matrix/client/v3/`.length,
      );
      let answer = respond(path, body);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
      });
    },
    endSessions: async (credentials) => {
      ended.push(credentials);
    },
  });
  return {
    frame,
    parent,
    sent,
    requests,
    ended,
    submitted,
    styled,
    receive(data, { source = parent, origin = APP_ORIGIN } = {}) {
      frame.receive({ data, source, origin } as unknown as MessageEvent);
    },
    sentOfType(type) {
      return sent.filter((message) => message.type === type);
    },
  };
}

function fill(h: Harness, values: Record<string, string>) {
  for (let [name, value] of Object.entries(values)) {
    h.frame.input(name, value);
  }
}

async function submit(
  h: Harness,
  operation: string,
  args: Record<string, unknown> = {},
) {
  h.receive({ type: 'submit', id: 'request-1', operation, args });
  await h.frame.queue;
  return h.sentOfType('result').at(-1);
}

module('Unit | credential frame protocol', function () {
  module('the frame URL and page', function () {
    test('reads the form and the app origin from the fragment', function (assert) {
      let params = readParams(
        'https://secure.example.test/credentials#form=login&origin=http%3A%2F%2Flocalhost%3A4200',
      );
      assert.strictEqual(params.formName, 'login');
      assert.strictEqual(params.form, FORMS.login);
      assert.strictEqual(params.appOrigin, 'http://localhost:4200');
    });

    test('reads the query when the fragment names no form', function (assert) {
      let params = readParams(
        'https://secure.example.test/credentials?form=reset&origin=https%3A%2F%2Fapp.example.test#other=1',
      );
      assert.strictEqual(params.form, FORMS.reset);
      assert.strictEqual(params.appOrigin, APP_ORIGIN);
    });

    test('names no form for one it does not know', function (assert) {
      for (let name of ['unknown', 'toString', '__proto__', '']) {
        assert.strictEqual(
          readParams(`https://secure.example.test/credentials#form=${name}`)
            .form,
          undefined,
          name,
        );
      }
    });

    test("reads the Matrix server and the app origins from the page's markup", function (assert) {
      let doc = document.implementation.createHTMLDocument();
      doc.head.innerHTML = `
        <meta name="boxel-matrix-url" content="https://matrix.example.test/" />
        <meta name="boxel-app-origins" content="https://app.example.test  https://*.preview.example.test" />
      `;
      let config = readConfig(doc);
      assert.strictEqual(config.matrixURL.href, 'https://matrix.example.test/');
      assert.deepEqual(config.appOrigins, [
        'https://app.example.test',
        'https://*.preview.example.test',
      ]);
    });

    test('starts only for a known form, framed by a listed app origin', function (assert) {
      let appOrigins = [APP_ORIGIN, 'https://*.preview.example.test'];
      let start = (overrides: Record<string, unknown>) =>
        mayStart({
          form: FORMS.login,
          appOrigin: APP_ORIGIN,
          appOrigins,
          framed: true,
          ...overrides,
        });
      assert.true(start({}), 'a listed origin, framed');
      assert.true(
        start({ appOrigin: 'https://branch.preview.example.test' }),
        'a subdomain of a listed pattern',
      );
      assert.false(
        start({ appOrigin: 'https://evil.example.test' }),
        'an origin not listed',
      );
      assert.false(start({ appOrigin: null }), 'no origin');
      assert.false(start({ form: undefined }), 'no form');
      assert.false(start({ framed: false }), 'not framed');
    });
  });

  module('forms', function () {
    test('each form names its fields and the one request it may make', function (assert) {
      let shape = Object.fromEntries(
        Object.entries(FORMS).map(([name, form]) => [
          name,
          {
            fields: form.fields.map((field) => [
              field.name,
              field.type,
              field.autocomplete,
            ]),
            operations: form.operations,
          },
        ]),
      );
      assert.deepEqual(shape, {
        login: {
          fields: [
            ['username', 'text', 'username'],
            ['password', 'password', 'current-password'],
          ],
          operations: ['login'],
        },
        'cli-login': {
          fields: [
            ['username', 'text', 'username'],
            ['password', 'password', 'current-password'],
          ],
          operations: ['cli-login'],
        },
        register: {
          fields: [
            ['password', 'password', 'new-password'],
            ['confirm', 'password', 'new-password'],
          ],
          operations: ['register'],
        },
        reset: {
          fields: [
            ['password', 'password', 'new-password'],
            ['confirm', 'password', 'new-password'],
          ],
          operations: ['set-password'],
        },
        'change-password': {
          fields: [
            ['current', 'password', 'current-password'],
            ['password', 'password', 'new-password'],
            ['confirm', 'password', 'new-password'],
          ],
          operations: ['set-password'],
        },
        'confirm-password': {
          fields: [['current', 'password', 'current-password']],
          operations: ['add-threepid'],
        },
      });
    });

    test('a form refuses any request but its own', async function (assert) {
      let h = harness('login');
      fill(h, { username: 'example-user', password: 'a-long-password' });
      for (let operation of [
        'set-password',
        'register',
        'add-threepid',
        'toString',
      ]) {
        let result = await submit(h, operation);
        assert.deepEqual(
          result,
          {
            type: 'result',
            id: 'request-1',
            ok: false,
            status: 0,
            body: { error: 'The form is not ready to submit.' },
          },
          operation,
        );
      }
      assert.deepEqual(h.requests, [], 'nothing was sent to the Matrix server');
      assert.strictEqual(h.submitted.count, 0, 'the form was not submitted');
    });

    test('a request waits for every field to be filled in and valid', async function (assert) {
      let h = harness('reset');
      fill(h, { password: 'a-long-password', confirm: 'a-different-one' });
      h.frame.blur('confirm');
      let result = await submit(h, 'set-password', { account: 'someone' });
      assert.false(result.ok);
      assert.deepEqual(h.requests, []);
    });
  });

  module('messages', function () {
    test('answers only its parent window, on the app origin', function (assert) {
      let h = harness('login');
      h.receive(
        { type: 'context', username: 'from-elsewhere' },
        { source: {} },
      );
      h.receive(
        { type: 'context', username: 'from-elsewhere' },
        { origin: 'https://evil.example.test' },
      );
      h.receive('context');
      h.receive(null);
      assert.strictEqual(
        h.frame.value('username'),
        '',
        'nothing was filled in',
      );

      h.receive({ type: 'context', username: 'example-user' });
      assert.strictEqual(h.frame.value('username'), 'example-user');
    });

    test('reports whether each field is filled in, never what is in it, and only on a change', function (assert) {
      let h = harness('login');
      h.frame.ready(['--credential-layout']);
      fill(h, { username: 'example-user' });
      fill(h, { username: 'example-user2' });
      fill(h, { password: 'a-long-password' });
      assert.deepEqual(h.sentOfType('state'), [
        {
          type: 'state',
          filled: { username: false, password: false },
          complete: false,
        },
        {
          type: 'state',
          filled: { username: true, password: false },
          complete: false,
        },
        {
          type: 'state',
          filled: { username: true, password: true },
          complete: true,
        },
      ]);
      assert.notOk(
        JSON.stringify(h.sent).includes('a-long-password'),
        'the password never goes to the app',
      );
      assert.deepEqual(h.sentOfType('ready'), [
        { type: 'ready', properties: ['--credential-layout'] },
      ]);
    });

    test('reports the first keystroke into a field after it was marked invalid', function (assert) {
      let h = harness('login');
      fill(h, { password: 'a' });
      fill(h, { password: 'ab' });
      assert.deepEqual(h.sentOfType('input'), [
        { type: 'input', field: 'password' },
      ]);
      h.receive({
        type: 'field-error',
        field: 'password',
        message: 'Wrong password',
      });
      assert.strictEqual(h.frame.error('password'), 'Wrong password');
      assert.false(h.frame.isComplete());
      fill(h, { password: 'abc' });
      assert.strictEqual(h.frame.error('password'), undefined, 'cleared');
      assert.strictEqual(h.sentOfType('input').length, 2);
    });

    test('checks a new password and its confirmation as each field is left', function (assert) {
      let h = harness('register');
      fill(h, { password: 'short' });
      h.frame.blur('password');
      assert.strictEqual(
        h.frame.error('password'),
        'Password must be at least 8 characters long',
      );
      fill(h, { password: 'a-long-password', confirm: 'something-else' });
      h.frame.blur('confirm');
      assert.strictEqual(h.frame.error('confirm'), 'Passwords do not match');
      assert.false(h.frame.showsHint('confirm'));
      assert.true(h.frame.showsHint('password'), 'password is valid');
      fill(h, { confirm: 'a-long-password' });
      assert.true(h.frame.showsHint('confirm'), 'passwords match');
      h.frame.blur('password');
      h.frame.input('password', '');
      h.frame.blur('password');
      assert.strictEqual(h.frame.error('password'), 'Password is missing');
    });

    test('answers `validate` once its state is up to date', function (assert) {
      let h = harness('change-password');
      fill(h, {
        current: 'the-old-password',
        password: 'short',
        confirm: 'short',
      });
      h.receive({ type: 'validate', id: 'check-1' });
      assert.strictEqual(
        h.frame.error('password'),
        'Password must be at least 8 characters long',
      );
      let last = h.sent.at(-1);
      assert.deepEqual(last, {
        type: 'validated',
        id: 'check-1',
        complete: false,
      });
      assert.false(h.sentOfType('state').at(-1).complete);
    });

    test('fills a username the page knows into an empty username field, and the hidden one', function (assert) {
      let login = harness('login');
      login.receive({ type: 'context', username: 'example-user' });
      assert.strictEqual(login.frame.value('username'), 'example-user');
      login.frame.input('username', 'typed-user');
      login.receive({ type: 'context', username: 'example-user' });
      assert.strictEqual(
        login.frame.value('username'),
        'typed-user',
        'a typed username stays',
      );

      let register = harness('register');
      register.receive({ type: 'context', username: 'new-user' });
      assert.strictEqual(register.frame.hiddenUsername, 'new-user');
    });

    test('Enter asks the app to submit', function (assert) {
      let h = harness('login');
      h.frame.enter();
      assert.deepEqual(h.sent, [{ type: 'submit-request' }]);
    });

    test('takes the styles the app sends, and reports its height when it changes', function (assert) {
      let height = 100;
      let h = harness('change-password', { height: () => height });
      let style = {
        type: 'style',
        properties: { '--credential-layout': ' narrow ' },
      };
      h.receive(style);
      assert.deepEqual(h.styled, [style], 'the styles are applied');
      assert.true(h.frame.narrow, 'a narrow layout');
      h.receive({ type: 'style', properties: {} });
      assert.false(h.frame.narrow);
      h.frame.sendSize();
      height = 120.25;
      h.frame.sendSize();
      assert.deepEqual(h.sentOfType('size'), [
        { type: 'size', height: 100 },
        { type: 'size', height: 120.25 },
      ]);
    });

    test('measures itself for the styles the app sends once they are drawn', async function (assert) {
      let height = 164;
      let draw: () => void = () => {};
      let drawn = new Promise<void>((resolve) => (draw = resolve));
      let h = harness('change-password', {
        height: () => height,
        rendered: () => drawn,
      });
      h.receive({
        type: 'style',
        properties: { '--credential-layout': 'narrow' },
      });
      // The narrow layout's height, which the page has not drawn yet.
      height = 140.25;
      assert.deepEqual(h.sentOfType('size'), [], 'nothing before it is drawn');
      draw();
      await drawn;
      assert.deepEqual(h.sentOfType('size'), [
        { type: 'size', height: 140.25 },
      ]);
    });
  });

  module('requests', function () {
    test('signs in by username, then by email address', async function (assert) {
      let h = harness('login', {
        respond: (_path, body) =>
          body.identifier.type === 'm.id.thirdparty'
            ? {
                status: 200,
                body: { user_id: '@example-user:example.test' },
              }
            : { status: 403, body: { errcode: 'M_FORBIDDEN' } },
      });
      fill(h, {
        username: 'user@example.test',
        password: 'a-long-password',
      });
      let result = await submit(h, 'login');
      assert.strictEqual(h.submitted.count, 1, 'the form is submitted');
      assert.deepEqual(
        h.requests.map((request) => [request.url, request.body]),
        [
          [
            'https://matrix.example.test/_matrix/client/v3/login',
            {
              identifier: { type: 'm.id.user', user: 'user@example.test' },
              password: 'a-long-password',
              type: 'm.login.password',
            },
          ],
          [
            'https://matrix.example.test/_matrix/client/v3/login',
            {
              identifier: {
                type: 'm.id.thirdparty',
                medium: 'email',
                address: 'user@example.test',
              },
              password: 'a-long-password',
              type: 'm.login.password',
            },
          ],
        ],
      );
      assert.deepEqual(result, {
        type: 'result',
        id: 'request-1',
        ok: true,
        status: 200,
        body: { user_id: '@example-user:example.test' },
      });
    });

    test("a response goes back with the fields' passwords cut out", async function (assert) {
      let h = harness('login', {
        respond: (_path, body) => ({
          status: 403,
          body: {
            error: `bad password ${body.password} for ${body.identifier.user}`,
          },
        }),
      });
      fill(h, { username: 'example-user', password: 'a-long-password' });
      let result = await submit(h, 'login');
      assert.deepEqual(result.body, {
        error: 'bad password [redacted] for example-user',
      });
    });

    test("set-password signs out every device, takes the current password from its field and ends the account's sessions", async function (assert) {
      let h = harness('change-password');
      fill(h, {
        current: 'the-old-password',
        password: 'the-new-password',
        confirm: 'the-new-password',
      });
      let result = await submit(h, 'set-password', {
        auth: {
          type: 'm.login.password',
          password: 'from-the-app',
          identifier: { type: 'm.id.user', user: '@example-user:example.test' },
        },
        accessToken: 'app-token',
        account: '@example-user:example.test',
      });
      assert.true(result.ok);
      let [request] = h.requests;
      assert.strictEqual(
        request.url,
        'https://matrix.example.test/_matrix/client/v3/account/password',
      );
      assert.strictEqual(request.headers.Authorization, 'Bearer app-token');
      assert.deepEqual(request.body, {
        auth: {
          type: 'm.login.password',
          password: 'the-old-password',
          identifier: { type: 'm.id.user', user: '@example-user:example.test' },
        },
        new_password: 'the-new-password',
        logout_devices: true,
      });
      assert.deepEqual(h.ended, [
        {
          username: '@example-user:example.test',
          password: 'the-new-password',
        },
      ]);
    });

    test('set-password ends no sessions when the change fails', async function (assert) {
      let h = harness('reset', {
        respond: () => ({ status: 401, body: { errcode: 'M_UNAUTHORIZED' } }),
      });
      fill(h, { password: 'the-new-password', confirm: 'the-new-password' });
      let result = await submit(h, 'set-password', {
        account: 'user@example.test',
      });
      assert.false(result.ok);
      assert.deepEqual(h.ended, []);
    });

    test('register sends the username the app names with the password from its field', async function (assert) {
      let h = harness('register');
      fill(h, { password: 'the-new-password', confirm: 'the-new-password' });
      await submit(h, 'register', {
        username: 'new-user',
        auth: { type: 'm.login.dummy', session: 'session-1' },
      });
      assert.deepEqual(h.requests[0].body, {
        username: 'new-user',
        password: 'the-new-password',
        auth: { type: 'm.login.dummy', session: 'session-1' },
      });
    });

    test('add-threepid confirms with the password from its field', async function (assert) {
      let h = harness('confirm-password');
      fill(h, { current: 'the-password' });
      await submit(h, 'add-threepid', {
        auth: { type: 'm.login.password', session: 'session-1' },
        accessToken: 'app-token',
        clientSecret: 'client-secret',
        sid: 'sid-1',
      });
      assert.strictEqual(
        h.requests[0].url,
        'https://matrix.example.test/_matrix/client/v3/account/3pid/add',
      );
      assert.deepEqual(h.requests[0].body, {
        auth: {
          type: 'm.login.password',
          session: 'session-1',
          password: 'the-password',
        },
        client_secret: 'client-secret',
        sid: 'sid-1',
      });
    });

    test('makes requests one at a time, in the order asked', async function (assert) {
      let order: string[] = [];
      let h = harness('login', {
        respond: (_path, body) => {
          order.push(body.identifier.type);
          return { status: 200, body: {} };
        },
      });
      fill(h, { username: 'example-user', password: 'a-long-password' });
      h.receive({ type: 'submit', id: 'first', operation: 'login' });
      h.receive({ type: 'submit', id: 'second', operation: 'login' });
      await h.frame.queue;
      assert.deepEqual(
        h.sentOfType('result').map((result) => result.id),
        ['first', 'second'],
      );
      assert.deepEqual(order, ['m.id.user', 'm.id.user']);
    });
  });
});
