import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  INVALID_INVITE_CODE,
  NO_NETWORK_ERROR,
  nextStage,
  Registration,
  registrationErrorText,
  usernameError,
} from '../src/security/registration.ts';
import {
  fakeMatrix,
  type FakeMatrix,
  interactiveAuth,
  REALM_SERVER_URL,
} from './helpers/fake-matrix.ts';

const DETAILS = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  username: 'ada',
  password: 'a-password-1',
  nextLink: 'https://secure.test/secure/verify-email',
};

const CONFIG = { realmServerURL: new URL(REALM_SERVER_URL) };

// Sets the new account up and signs it in to Boxel, and returns what the
// sign-in sent the realm server.
async function setUpAndSignIn(
  registration: Registration,
  account: { user_id: string; access_token: string },
) {
  matrix.on(
    `profile/${encodeURIComponent(account.user_id)}/displayname`,
    () => ({}),
  );
  matrix.on('logout', () => ({}));
  matrix.on('realm-server:_secure-session', () => ({
    status: 201,
    body: {
      data: {
        attributes: {
          token: 'secure-1',
          user: account.user_id,
          expiresAt: 'x',
        },
      },
    },
  }));
  await registration.setUp(account);
  let session = await registration.signIn(CONFIG, 'window');
  assert.equal(session.token, 'secure-1');
  let [request] = matrix.requests('realm-server:_secure-session');
  return (request.body.data as { attributes: Record<string, unknown> })
    .attributes;
}

let matrix: FakeMatrix;
beforeEach(() => {
  matrix = fakeMatrix();
});
afterEach(() => {
  matrix.restore();
});

test('the next stage is the first uncompleted one of the flow the completed stages are in', () => {
  let flows = [
    { stages: ['m.login.registration_token', 'm.login.email.identity'] },
    { stages: ['m.login.email.identity', 'm.login.dummy'] },
  ];
  assert.equal(nextStage({ flows }), 'm.login.registration_token');
  assert.equal(
    nextStage({ flows, completed: ['m.login.registration_token'] }),
    'm.login.email.identity',
  );
  assert.equal(
    nextStage({ flows, completed: ['m.login.dummy'] }),
    'm.login.email.identity',
    'the second flow, the only one holding the completed stage',
  );
  assert.equal(nextStage({}), undefined);
});

test("the server's errors are put in the app's words", () => {
  assert.equal(registrationErrorText({ status: 0 }), NO_NETWORK_ERROR);
  assert.equal(
    registrationErrorText({
      status: 403,
      data: { error: 'Registration has been disabled. Sorry.' },
    }),
    'Registration has been disabled',
  );
  assert.equal(
    registrationErrorText({
      status: 400,
      data: { error: 'Unable to parse email address' },
    }),
    'Email address is invalid',
  );
  assert.equal(
    registrationErrorText({ status: 500, data: { error: 'Something odd' } }),
    'Something odd',
  );
});

test('usernames that could collide with the API or with realm users are refused', () => {
  assert.equal(usernameError(''), 'Username is missing');
  assert.equal(
    usernameError('_ada'),
    'Username cannot start with an underscore',
  );
  assert.equal(
    usernameError('realm/ada'),
    'Username cannot start with "realm/"',
  );
  assert.equal(usernameError('ada'), undefined);
});

test('registers with an invite code, polling until the email is validated', async () => {
  let emailValidated = false;
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', (body) => {
    let auth = body.auth as Record<string, unknown> | undefined;
    if (!auth) {
      return interactiveAuth([]);
    }
    if (auth.type === 'm.login.registration_token') {
      return auth.token === 'good-code'
        ? interactiveAuth(['m.login.registration_token'])
        : interactiveAuth([], 'Invalid token');
    }
    if (auth.type === 'm.login.email.identity') {
      if (!emailValidated) {
        emailValidated = true;
        return interactiveAuth(['m.login.registration_token']);
      }
      return { user_id: '@ada:localhost', access_token: 'reg-token' };
    }
    throw new Error(`unexpected auth ${JSON.stringify(auth)}`);
  });

  let awaiting = 0;
  let delays: number[] = [];
  let registration = new Registration(DETAILS, {
    onAwaitingEmail: () => awaiting++,
    delay: async (ms) => {
      delays.push(ms);
    },
  });

  assert.deepEqual(await registration.start(), { step: 'invite-code' });
  let [emailRequest] = matrix.requests('register/email/requestToken');
  assert.deepEqual(emailRequest.body, {
    email: 'ada@example.com',
    client_secret: emailRequest.body.client_secret,
    send_attempt: 1,
    next_link: DETAILS.nextLink,
  });

  assert.deepEqual(await registration.submitInviteCode('bad-code'), {
    step: 'invite-code',
    error: INVALID_INVITE_CODE,
  });
  assert.deepEqual(await registration.submitInviteCode('good-code'), {
    step: 'account',
    account: { user_id: '@ada:localhost', access_token: 'reg-token' },
  });
  assert.equal(awaiting, 2, 'the page heard the registration waiting twice');
  assert.deepEqual(delays, [1000], 'it waited between polls, not before');
  assert.deepEqual(
    await setUpAndSignIn(registration, {
      user_id: '@ada:localhost',
      access_token: 'reg-token',
    }),
    {
      username: '@ada:localhost',
      password: 'a-password-1',
      client: 'window',
      registrationToken: 'good-code',
    },
    "the account's first sign-in records the accepted invite code",
  );

  let registers = matrix.requests('register');
  for (let request of registers) {
    assert.equal(request.body.username, 'ada');
    assert.equal(request.body.password, 'a-password-1');
  }
  let last = registers.at(-1)!.body.auth as Record<string, unknown>;
  assert.deepEqual(last, {
    type: 'm.login.email.identity',
    session: 'session-1',
    threepid_creds: {
      sid: 'sid-1',
      client_secret: emailRequest.body.client_secret,
    },
  });
});

test('registers with no invite step when the server asks for none', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', (body) => {
    let auth = body.auth as Record<string, unknown> | undefined;
    if (!auth) {
      return interactiveAuth([], undefined, [
        { stages: ['m.login.email.identity', 'm.login.dummy'] },
      ]);
    }
    if (auth.type === 'm.login.email.identity') {
      return interactiveAuth(['m.login.email.identity'], undefined, [
        { stages: ['m.login.email.identity', 'm.login.dummy'] },
      ]);
    }
    return { user_id: '@ada:localhost', access_token: 'reg-token' };
  });
  let registration = new Registration(DETAILS, { delay: async () => {} });
  assert.deepEqual(await registration.start(), {
    step: 'account',
    account: { user_id: '@ada:localhost', access_token: 'reg-token' },
  });
  assert.deepEqual(
    matrix.requests('register').map((r) => (r.body.auth as any)?.type),
    [undefined, 'm.login.email.identity', 'm.login.dummy'],
  );
  assert.deepEqual(
    await setUpAndSignIn(registration, {
      user_id: '@ada:localhost',
      access_token: 'reg-token',
    }),
    {
      username: '@ada:localhost',
      password: 'a-password-1',
      client: 'window',
    },
    'no invite code to record',
  );
});

test('resending the validation email counts up its send attempt', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', () => interactiveAuth([]));
  let registration = new Registration(DETAILS);
  await registration.start();
  await registration.sendValidationEmail();
  let requests = matrix.requests('register/email/requestToken');
  assert.deepEqual(
    requests.map((r) => r.body.send_attempt),
    [1, 2],
  );
  assert.equal(
    requests[0].body.client_secret,
    requests[1].body.client_secret,
    'the same validation session',
  );
});

test('an email address another account holds is refused on its field', async () => {
  matrix.on('register/email/requestToken', () => ({
    status: 400,
    body: { errcode: 'M_THREEPID_IN_USE', error: 'Email is in use' },
  }));
  assert.deepEqual(await new Registration(DETAILS).start(), {
    step: 'form',
    field: 'email',
    error: 'Email address is already attached to a Boxel account',
  });
});

test('a username taken by the time the account is made is refused on its field', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', () => ({
    status: 400,
    body: { errcode: 'M_USER_IN_USE', error: 'User ID already taken' },
  }));
  assert.deepEqual(await new Registration(DETAILS).start(), {
    step: 'form',
    field: 'username',
    error: 'Username is already taken',
  });
});

test('an error from the register request is shown on the form', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', () => ({
    status: 403,
    body: { errcode: 'M_FORBIDDEN', error: 'Registration has been disabled' },
  }));
  assert.deepEqual(await new Registration(DETAILS).start(), {
    step: 'form',
    error: 'There was an error registering: Registration has been disabled',
  });
});

test('an error from submitting the invite code is shown on its field', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  let first = true;
  matrix.on('register', () => {
    if (first) {
      first = false;
      return interactiveAuth([]);
    }
    return { network: 'down' };
  });
  let registration = new Registration(DETAILS);
  await registration.start();
  assert.deepEqual(await registration.submitInviteCode('good-code'), {
    step: 'invite-code',
    error: NO_NETWORK_ERROR,
  });
});

test('stopping a registration ends its polling', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'sid-1' }));
  matrix.on('register', () =>
    interactiveAuth([], undefined, [{ stages: ['m.login.email.identity'] }]),
  );
  let registration: Registration = new Registration(DETAILS, {
    delay: async (): Promise<void> => registration.stop(),
  });
  assert.deepEqual(await registration.start(), { step: 'stopped' });
});

test('setting the account up names it and signs out the registration session', async () => {
  matrix.on('profile/%40ada%3Alocalhost/displayname', () => ({}));
  matrix.on('logout', () => ({}));
  await new Registration(DETAILS).setUp({
    user_id: '@ada:localhost',
    access_token: 'reg-token',
  });
  let [name] = matrix.requests('profile/%40ada%3Alocalhost/displayname');
  assert.equal(name.method, 'PUT');
  assert.equal(name.authorization, 'Bearer reg-token');
  assert.deepEqual(name.body, { displayname: 'Ada Lovelace' });
  let [logout] = matrix.requests('logout');
  assert.equal(logout.authorization, 'Bearer reg-token');
});

test('signing in before an account exists is refused', async () => {
  await assert.rejects(
    new Registration(DETAILS).signIn(CONFIG, 'window'),
    /no account/,
  );
});

test('setting the account up lets a failure go', async () => {
  matrix.on('profile/%40ada%3Alocalhost/displayname', () => ({
    status: 500,
    body: {},
  }));
  matrix.on('logout', () => ({ network: 'down' }));
  await new Registration(DETAILS).setUp({
    user_id: '@ada:localhost',
    access_token: 'reg-token',
  });
});
