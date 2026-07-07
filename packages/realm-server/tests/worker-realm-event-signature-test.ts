import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  workerRealmEventSignature,
  verifyWorkerRealmEventRequest,
  WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS,
} from '@cardstack/runtime-common/worker-realm-event';

const secret = "shhh! it's a secret";

module(basename(import.meta.filename), function () {
  module('worker-realm-event signature', function () {
    test('a freshly signed request verifies', function (assert) {
      let now = 1_000_000;
      let rawBody = JSON.stringify({ event: { hello: 'world' } });
      let timestamp = String(now);
      let signature = workerRealmEventSignature(secret, timestamp, rawBody);

      let result = verifyWorkerRealmEventRequest({
        secret,
        timestamp,
        signature,
        rawBody,
        now,
      });
      assert.deepEqual(result, { ok: true }, 'valid signature verifies');
    });

    test('the signature covers the body — a tampered body is rejected', function (assert) {
      let now = 1_000_000;
      let timestamp = String(now);
      let signature = workerRealmEventSignature(
        secret,
        timestamp,
        JSON.stringify({ event: { hello: 'world' } }),
      );

      let result = verifyWorkerRealmEventRequest({
        secret,
        timestamp,
        signature,
        rawBody: JSON.stringify({ event: { hello: 'tampered' } }),
        now,
      });
      assert.false(result.ok, 'tampered body fails verification');
    });

    test('a signature made with the wrong secret is rejected', function (assert) {
      let now = 1_000_000;
      let timestamp = String(now);
      let rawBody = JSON.stringify({ event: {} });
      let signature = workerRealmEventSignature(
        'not-the-shared-secret',
        timestamp,
        rawBody,
      );

      let result = verifyWorkerRealmEventRequest({
        secret,
        timestamp,
        signature,
        rawBody,
        now,
      });
      assert.false(result.ok, 'wrong-secret signature fails verification');
    });

    test('missing timestamp or signature is rejected', function (assert) {
      let rawBody = JSON.stringify({ event: {} });
      assert.false(
        verifyWorkerRealmEventRequest({
          secret,
          timestamp: undefined,
          signature: 'x',
          rawBody,
          now: 0,
        }).ok,
        'missing timestamp rejected',
      );
      assert.false(
        verifyWorkerRealmEventRequest({
          secret,
          timestamp: '0',
          signature: undefined,
          rawBody,
          now: 0,
        }).ok,
        'missing signature rejected',
      );
    });

    test('a malformed (non-numeric) timestamp is rejected', function (assert) {
      let rawBody = JSON.stringify({ event: {} });
      let signature = workerRealmEventSignature(
        secret,
        'not-a-number',
        rawBody,
      );
      let result = verifyWorkerRealmEventRequest({
        secret,
        timestamp: 'not-a-number',
        signature,
        rawBody,
        now: 0,
      });
      assert.false(result.ok, 'non-numeric timestamp rejected');
    });

    test('a timestamp outside the ±window is rejected in both directions', function (assert) {
      let now = 10_000_000;
      let rawBody = JSON.stringify({ event: {} });
      for (let skew of [
        WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS + 1_000,
        -(WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS + 1_000),
      ]) {
        let timestamp = String(now + skew);
        let signature = workerRealmEventSignature(secret, timestamp, rawBody);
        let result = verifyWorkerRealmEventRequest({
          secret,
          timestamp,
          signature,
          rawBody,
          now,
        });
        assert.false(result.ok, `timestamp skewed by ${skew}ms rejected`);
      }
    });

    test('a timestamp at the edge of the window is accepted', function (assert) {
      let now = 10_000_000;
      let rawBody = JSON.stringify({ event: {} });
      let timestamp = String(now - WORKER_REALM_EVENT_TIMESTAMP_WINDOW_MS);
      let signature = workerRealmEventSignature(secret, timestamp, rawBody);
      let result = verifyWorkerRealmEventRequest({
        secret,
        timestamp,
        signature,
        rawBody,
        now,
      });
      assert.true(result.ok, 'edge-of-window timestamp accepted');
    });
  });
});
