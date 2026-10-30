import { module, test } from 'qunit';

import {
  decideRoomInvite,
  getMatrixServerName,
} from '@cardstack/host/lib/room-invite-policy';

const inviter = '@example-person:localhost';

module('Unit | lib | room-invite-policy', function () {
  module('decideRoomInvite', function () {
    test('allows the platform service accounts on the inviter homeserver', function (assert) {
      for (let invitee of [
        '@aibot:localhost',
        '@submissionbot:localhost',
        '@realm/example-realm:localhost',
        '@example_realm:localhost',
        '@example_writer:localhost',
      ]) {
        assert.deepEqual(
          decideRoomInvite(invitee, inviter),
          { allowed: true },
          `${invitee} is allowed`,
        );
      }
    });

    test('refuses an end user on the inviter homeserver', function (assert) {
      let decision = decideRoomInvite('@another-person:localhost', inviter);
      assert.false(decision.allowed, 'refused');
      assert.ok(
        /service users/.test(decision.allowed ? '' : decision.reason),
        'reason names the service-user rule',
      );
    });

    test('refuses the inviter themselves', function (assert) {
      assert.false(decideRoomInvite(inviter, inviter).allowed);
    });

    test('refuses a service account on another homeserver', function (assert) {
      let decision = decideRoomInvite('@aibot:other.example', inviter);
      assert.false(decision.allowed, 'refused');
      assert.ok(
        /not on this homeserver/.test(decision.allowed ? '' : decision.reason),
        'reason names the homeserver',
      );
    });

    test('refuses a bare localpart', function (assert) {
      assert.false(decideRoomInvite('aibot', inviter).allowed);
      assert.false(decideRoomInvite('@aibot', inviter).allowed);
    });

    test('refuses a service-looking id with an empty server', function (assert) {
      assert.false(decideRoomInvite('@aibot:', inviter).allowed);
    });
  });

  module('getMatrixServerName', function () {
    test('returns the server part of a full id', function (assert) {
      assert.strictEqual(
        getMatrixServerName('@example-person:matrix.example'),
        'matrix.example',
      );
    });

    test('keeps a port in the server name', function (assert) {
      assert.strictEqual(
        getMatrixServerName('@example-person:localhost:8008'),
        'localhost:8008',
      );
    });

    test('is undefined for a bare localpart or an empty server', function (assert) {
      assert.strictEqual(getMatrixServerName('example-person'), undefined);
      assert.strictEqual(getMatrixServerName('@example-person:'), undefined);
    });
  });
});
