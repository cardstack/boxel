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
  changes: Record<string, string>[];
  submitted: { count: number };
  styled: any[];
  receive(data: unknown, from?: { source?: unknown; origin?: string }): void;
  sentOfType(type: string): any[];
}

// A frame for `formName`, with everything it reaches outside itself
// recorded. `respond` answers each Matrix request, by its path, and
// `respondToChange` each password change the realm server is asked to make.
function harness(
  formName: keyof typeof FORMS,
  {
    respond = () => ({ status: 200, body: {} }),
    height = () => 100,
    rendered = () => Promise.resolve(),
    respondToChange = () => ({ status: 200, body: {} }),
  }: {
    respond?: (path: string, body: any) => { status: number; body: unknown };
    height?: () => number;
    rendered?: () => Promise<unknown>;
    respondToChange?: () => { status: number; body: any };
  } = {},
): Harness {
  let parent = {};
  let sent: any[] = [];
  let requests: Request[] = [];
  let changes: Record<string, string>[] = [];
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
    changePassword: async (change) => {
      changes.push(change);
      let answer = respondToChange();
      return { ok: answer.status === 200, ...answer };
    },
  });
  return {
    frame,
    parent,
    sent,
    requests,
    changes,
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
        'https://secure.example.test/credentials#form=change-password&origin=http%3A%2F%2Flocalhost%3A4200',
      );
      assert.strictEqual(params.formName, 'change-password');
      assert.strictEqual(params.form, FORMS['change-password']);
      assert.strictEqual(params.appOrigin, 'http://localhost:4200');
    });

    test('reads the query when the fragment names no form', function (assert) {
      let params = readParams(
        'https://secure.example.test/credentials?form=confirm-password&origin=https%3A%2F%2Fapp.example.test#other=1',
      );
      assert.strictEqual(params.form, FORMS['confirm-password']);
      assert.strictEqual(params.appOrigin, APP_ORIGIN);
    });

    test('names no form for one it does not know', function (assert) {
      for (let name of [
        'unknown',
        'login',
        'cli-login',
        'register',
        'reset',
        'toString',
        '__proto__',
        '',
      ]) {
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
          form: FORMS['change-password'],
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
      let h = harness('confirm-password');
      fill(h, { current: 'the-password' });
      for (let operation of ['set-password', 'login', 'register', 'toString']) {
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
      let h = harness('change-password');
      fill(h, {
        current: 'the-old-password',
        password: 'a-long-password',
        confirm: 'a-different-one',
      });
      h.frame.blur('confirm');
      let result = await submit(h, 'set-password', {
        accessToken: 'app-token',
      });
      assert.false(result.ok);
      assert.deepEqual(h.requests, []);
      assert.deepEqual(h.changes, []);
    });
  });

  module('messages', function () {
    test('answers only its parent window, on the app origin', function (assert) {
      let h = harness('change-password');
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
      assert.strictEqual(h.frame.hiddenUsername, '', 'nothing was taken');

      h.receive({ type: 'context', username: 'example-user' });
      assert.strictEqual(h.frame.hiddenUsername, 'example-user');
    });

    test('reports whether each field is filled in, never what is in it, and only on a change', function (assert) {
      let h = harness('change-password');
      h.frame.ready(['--credential-layout']);
      fill(h, { current: 'the-old-password' });
      fill(h, { current: 'the-old-password2' });
      fill(h, { password: 'a-long-password', confirm: 'a-long-password' });
      assert.deepEqual(h.sentOfType('state'), [
        {
          type: 'state',
          filled: { current: false, password: false, confirm: false },
          complete: false,
        },
        {
          type: 'state',
          filled: { current: true, password: false, confirm: false },
          complete: false,
        },
        {
          type: 'state',
          filled: { current: true, password: true, confirm: false },
          complete: false,
        },
        {
          type: 'state',
          filled: { current: true, password: true, confirm: true },
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
      let h = harness('confirm-password');
      fill(h, { current: 'a' });
      fill(h, { current: 'ab' });
      assert.deepEqual(h.sentOfType('input'), [
        { type: 'input', field: 'current' },
      ]);
      h.receive({
        type: 'field-error',
        field: 'current',
        message: 'Wrong password',
      });
      assert.strictEqual(h.frame.error('current'), 'Wrong password');
      assert.false(h.frame.isComplete());
      fill(h, { current: 'abc' });
      assert.strictEqual(h.frame.error('current'), undefined, 'cleared');
      assert.strictEqual(h.sentOfType('input').length, 2);
    });

    test('checks a new password and its confirmation as each field is left', function (assert) {
      let h = harness('change-password');
      fill(h, { password: 'short' });
      h.frame.blur('password');
      assert.strictEqual(
        h.frame.error('password'),
        'Password must be at least 8 characters long',
      );
      fill(h, { password: 'a-long-password', confirm: 'something-else' });
      h.frame.blur('confirm');
      assert.strictEqual(h.frame.error('confirm'), 'Passwords do not match');
      fill(h, { confirm: 'a-long-password' });
      h.frame.blur('confirm');
      assert.strictEqual(h.frame.error('confirm'), undefined, 'they match');
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

    test('Enter asks the app to submit', function (assert) {
      let h = harness('confirm-password');
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
    test("a response goes back with the fields' passwords cut out", async function (assert) {
      let h = harness('confirm-password', {
        respond: (_path, body) => ({
          status: 401,
          body: { error: `bad password ${body.auth.password}` },
        }),
      });
      fill(h, { current: 'a-long-password' });
      let result = await submit(h, 'add-threepid', {
        auth: { type: 'm.login.password', session: 'session-1' },
        accessToken: 'app-token',
      });
      assert.deepEqual(result.body, { error: 'bad password [redacted]' });
    });

    test("set-password asks the realm server to change the password, with the passwords from its fields and the app's token", async function (assert) {
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
      assert.deepEqual(h.requests, [], 'nothing goes to the Matrix server');
      assert.deepEqual(h.changes, [
        {
          newPassword: 'the-new-password',
          accessToken: 'app-token',
          currentPassword: 'the-old-password',
        },
      ]);
    });

    test('set-password makes a change only, whatever the app sends', async function (assert) {
      let h = harness('change-password');
      fill(h, {
        current: 'the-old-password',
        password: 'the-new-password',
        confirm: 'the-new-password',
      });
      let result = await submit(h, 'set-password', {
        auth: {
          type: 'm.login.email.identity',
          threepid_creds: { sid: 'sid-1', client_secret: 'client-secret' },
        },
        account: 'someone-else@example.test',
      });
      assert.false(result.ok, 'no change without the app’s token');
      assert.deepEqual(h.changes, [], 'and no reset in its place');
    });

    test("set-password answers with the Matrix server's refusal, with the passwords redacted", async function (assert) {
      let h = harness('change-password', {
        respondToChange: () => ({
          status: 401,
          body: {
            errcode: 'M_FORBIDDEN',
            error: 'the-old-password is not the-new-password',
          },
        }),
      });
      fill(h, {
        current: 'the-old-password',
        password: 'the-new-password',
        confirm: 'the-new-password',
      });
      let result = await submit(h, 'set-password', {
        auth: { type: 'm.login.password' },
        accessToken: 'app-token',
      });
      assert.false(result.ok);
      assert.strictEqual(result.status, 401);
      assert.deepEqual(result.body, {
        errcode: 'M_FORBIDDEN',
        error: '[redacted] is not [redacted]',
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
      let h = harness('confirm-password', {
        respond: (_path, body) => {
          order.push(body.sid);
          return { status: 200, body: {} };
        },
      });
      fill(h, { current: 'the-password' });
      h.receive({
        type: 'submit',
        id: 'first',
        operation: 'add-threepid',
        args: { sid: 'sid-1' },
      });
      h.receive({
        type: 'submit',
        id: 'second',
        operation: 'add-threepid',
        args: { sid: 'sid-2' },
      });
      await h.frame.queue;
      assert.deepEqual(
        h.sentOfType('result').map((result) => result.id),
        ['first', 'second'],
      );
      assert.deepEqual(order, ['sid-1', 'sid-2']);
    });
  });
});
