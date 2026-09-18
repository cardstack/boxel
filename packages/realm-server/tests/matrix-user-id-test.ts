import QUnit from 'qunit';
import {
  ensureFullMatrixUserId,
  userIdFromUsername,
} from '../../runtime-common/matrix-client.ts';

const { module, test } = QUnit;

module('Matrix user identity configuration', function (hooks) {
  let originalURL: string | undefined;
  let originalName: string | undefined;
  hooks.beforeEach(function () {
    originalURL = process.env.MATRIX_URL;
    originalName = process.env.MATRIX_SERVER_NAME;
    delete process.env.MATRIX_URL;
    delete process.env.MATRIX_SERVER_NAME;
  });
  hooks.afterEach(function () {
    for (let [key, value] of [
      ['MATRIX_URL', originalURL],
      ['MATRIX_SERVER_NAME', originalName],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('uses the configured identity for the matching hosted endpoint', function (assert) {
    process.env.MATRIX_URL = 'https://matrix.example.net';
    process.env.MATRIX_SERVER_NAME = 'matrix.example.net';
    assert.strictEqual(
      userIdFromUsername('realm_service', `${process.env.MATRIX_URL}/`),
      '@realm_service:matrix.example.net',
    );
  });

  test('supports a server name distinct from the transport hostname', function (assert) {
    process.env.MATRIX_URL = 'https://matrix.example.net/';
    process.env.MATRIX_SERVER_NAME = 'example.org:8448';
    assert.strictEqual(
      ensureFullMatrixUserId('alice', process.env.MATRIX_URL),
      '@alice:example.org:8448',
    );
    assert.strictEqual(
      ensureFullMatrixUserId('@alice:other.org', process.env.MATRIX_URL),
      '@alice:other.org',
    );
  });

  test('does not apply local identity configuration to another endpoint', function (assert) {
    process.env.MATRIX_URL = 'https://matrix.example.net';
    process.env.MATRIX_SERVER_NAME = 'example.org';
    assert.strictEqual(
      userIdFromUsername('alice', 'https://matrix.other.net'),
      '@alice:other.net',
    );
    assert.strictEqual(
      userIdFromUsername('alice', 'https://matrix.example.net:8448'),
      '@alice:example.net',
    );
  });

  test('preserves existing hostname and localhost behavior without configuration', function (assert) {
    assert.strictEqual(
      userIdFromUsername('alice', 'https://matrix.example.org'),
      '@alice:example.org',
    );
    assert.strictEqual(
      userIdFromUsername('alice', 'https://matrix.branch.localhost'),
      '@alice:localhost',
    );
    assert.strictEqual(
      userIdFromUsername('alice', 'http://localhost:8008'),
      '@alice:localhost',
    );
  });

  test('does not use an unscoped server name', function (assert) {
    process.env.MATRIX_SERVER_NAME = 'example.org';
    assert.strictEqual(
      userIdFromUsername('alice', 'https://matrix.other.net'),
      '@alice:other.net',
    );
  });
});
