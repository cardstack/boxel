import { module, test } from 'qunit';

import { getMatrixServerName } from '@cardstack/runtime-common';

import { decideRoomInvite } from '@cardstack/host/lib/room-invite-policy';

const inviter = '@example-person:localhost';

module('Unit | lib | room-invite-policy', function () {
  module('decideRoomInvite', function () {
    test('allows the AI bot and the submission bot on the inviter homeserver', function (assert) {
      for (let invitee of ['@aibot:localhost', '@submissionbot:localhost']) {
        assert.deepEqual(
          decideRoomInvite(invitee, inviter),
          { allowed: true },
          `${invitee} is allowed`,
        );
      }
    });

    test('allows a bot on an inviter homeserver whose name has a port', function (assert) {
      assert.deepEqual(
        decideRoomInvite(
          '@submissionbot:localhost:8008',
          '@example-person:localhost:8008',
        ),
        { allowed: true },
      );
    });

    test('refuses an end user on the inviter homeserver', function (assert) {
      let decision = decideRoomInvite('@another-person:localhost', inviter);
      assert.false(decision.allowed, 'refused');
      assert.ok(
        /not the AI bot or the submission bot/.test(
          decision.allowed ? '' : decision.reason,
        ),
        'reason names the rule',
      );
    });

    test('refuses names that match the realm and writer account conventions, which a person can register', function (assert) {
      for (let invitee of [
        '@realm/example-realm:localhost',
        '@example_realm:localhost',
        '@example_writer:localhost',
      ]) {
        assert.false(
          decideRoomInvite(invitee, inviter).allowed,
          `${invitee} is refused`,
        );
      }
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

    test('refuses a bot id with an empty server', function (assert) {
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
