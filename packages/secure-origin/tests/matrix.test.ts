import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
  isUsernameAvailable,
  MatrixError,
  register,
  requestEmailToken,
  resetPassword,
} from '../src/security/matrix.js';
import { fakeMatrix, type FakeMatrix } from './helpers/fake-matrix.ts';

let matrix: FakeMatrix;
beforeEach(() => {
  matrix = fakeMatrix();
});
afterEach(() => {
  matrix.restore();
});

test('a username is available only when the server says so', async () => {
  matrix.on('register/available', () => ({ available: true }));
  assert.equal(await isUsernameAvailable('ada'), true);
  matrix.on('register/available', () => ({
    status: 400,
    body: { errcode: 'M_USER_IN_USE', error: 'User ID already taken.' },
  }));
  assert.equal(await isUsernameAvailable('ada'), false);
  matrix.on('register/available', () => ({ available: 'yes' }));
  assert.equal(await isUsernameAvailable('ada'), false);
  assert.deepEqual(
    matrix.requests('register/available').map(({ method }) => method),
    ['GET', 'GET', 'GET'],
  );
});

test('a username check that fails for another reason is thrown', async () => {
  matrix.on('register/available', () => ({
    status: 429,
    body: { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests' },
  }));
  await assert.rejects(isUsernameAvailable('ada'), MatrixError);
});

test('validation emails for registration and for a password reset go to their own endpoints', async () => {
  matrix.on('register/email/requestToken', () => ({ sid: 'reg-sid' }));
  matrix.on('account/password/email/requestToken', () => ({
    sid: 'reset-sid',
  }));
  let args = {
    email: 'ada@example.com',
    clientSecret: 'secret',
    sendAttempt: 2,
    nextLink: 'https://secure.test/next',
  };
  assert.equal(await requestEmailToken('registration', args), 'reg-sid');
  assert.equal(await requestEmailToken('password', args), 'reset-sid');
  for (let path of [
    'register/email/requestToken',
    'account/password/email/requestToken',
  ]) {
    assert.deepEqual(matrix.requests(path)[0].body, {
      email: 'ada@example.com',
      client_secret: 'secret',
      send_attempt: 2,
      next_link: 'https://secure.test/next',
    });
  }
});

test('a registration request names its device, and sends auth only when there is a stage to answer', async () => {
  matrix.on('register', () => ({ user_id: '@ada:localhost' }));
  await register({ username: 'ada', password: 'pw', auth: undefined });
  await register({
    username: 'ada',
    password: 'pw',
    auth: { type: 'm.login.dummy', session: 's' },
  });
  let [first, second] = matrix.requests('register');
  assert.deepEqual(first.body, {
    username: 'ada',
    password: 'pw',
    initial_device_display_name: 'Boxel sign-in',
  });
  assert.deepEqual(second.body.auth, { type: 'm.login.dummy', session: 's' });
});

test('a password reset always signs every other device out', async () => {
  matrix.on('account/password', () => ({}));
  await resetPassword({
    sid: 'sid-1',
    clientSecret: 'secret',
    newPassword: 'a-new-password',
  });
  assert.deepEqual(matrix.requests('account/password')[0].body, {
    auth: {
      type: 'm.login.email.identity',
      threepid_creds: { sid: 'sid-1', client_secret: 'secret' },
    },
    new_password: 'a-new-password',
    logout_devices: true,
  });
});

test('an error carries its status, code and body, and a request that never arrives has status 0', async () => {
  matrix.on('account/password', () => ({
    status: 401,
    body: { errcode: 'M_UNAUTHORIZED', error: 'Not validated' },
  }));
  await assert.rejects(
    resetPassword({ sid: 's', clientSecret: 'c', newPassword: 'p' }),
    (e: MatrixError) =>
      e.status === 401 &&
      e.errcode === 'M_UNAUTHORIZED' &&
      e.message === 'Not validated',
  );
  matrix.on('account/password', () => ({ network: 'down' }));
  await assert.rejects(
    resetPassword({ sid: 's', clientSecret: 'c', newPassword: 'p' }),
    (e: MatrixError) =>
      e.status === 0 && e.message === 'Could not connect to server',
  );
});
