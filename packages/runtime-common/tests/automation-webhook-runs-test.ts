import {
  isWebhookDeliverySlot,
  webhookDeliverySlot,
} from '../automation-run-command.ts';
import { webhookDeliveryId } from '../automation-webhook-runs.ts';
import type { SharedTests } from '../helpers/index.ts';

const tests = Object.freeze({
  "reads GitHub's delivery id from its header": async (assert) => {
    assert.deepEqual(
      webhookDeliveryId({ 'x-github-delivery': ' 72d3162e ' }, {}),
      { id: '72d3162e', fromSender: true },
    );
  },

  'reads a Standard Webhooks id from its header': async (assert) => {
    assert.deepEqual(webhookDeliveryId({ 'webhook-id': 'msg_2KWP' }, {}), {
      id: 'msg_2KWP',
      fromSender: true,
    });
  },

  "joins a Google push notification's channel and message number": async (
    assert,
  ) => {
    assert.deepEqual(
      webhookDeliveryId(
        { 'x-goog-channel-id': 'chan-1', 'x-goog-message-number': '42' },
        {},
      ),
      { id: 'chan-1:42', fromSender: true },
    );
    let channelOnly = webhookDeliveryId({ 'x-goog-channel-id': 'chan-1' }, {});
    assert.false(
      channelOnly.fromSender,
      'a channel without a message number names no delivery',
    );
  },

  "reads a Stripe event's id from the body, only on an event": async (
    assert,
  ) => {
    assert.deepEqual(
      webhookDeliveryId({}, { object: 'event', id: 'evt_1Nq' }),
      { id: 'evt_1Nq', fromSender: true },
    );
    assert.false(
      webhookDeliveryId({}, { object: 'charge', id: 'ch_1' }).fromSender,
      "another object's id is no delivery id",
    );
    assert.false(
      webhookDeliveryId({}, [{ object: 'event', id: 'evt_1' }]).fromSender,
      'a list body names no delivery',
    );
  },

  'a header outranks the body': async (assert) => {
    assert.strictEqual(
      webhookDeliveryId(
        { 'x-github-delivery': 'gh-1' },
        { object: 'event', id: 'evt_1' },
      ).id,
      'gh-1',
    );
  },

  'an empty, list-valued or overlong id counts as none, and the delivery gets a fresh id':
    async (assert) => {
      for (let headers of [
        { 'x-github-delivery': '   ' },
        { 'x-github-delivery': ['a', 'b'] },
        { 'x-github-delivery': 'x'.repeat(257) },
      ]) {
        let first = webhookDeliveryId(headers, 'not json');
        let second = webhookDeliveryId(headers, 'not json');
        assert.false(first.fromSender);
        assert.notStrictEqual(
          first.id,
          second.id,
          'each delivery without an id gets its own',
        );
      }
      assert.true(
        webhookDeliveryId({ 'x-github-delivery': 'x'.repeat(256) }, {})
          .fromSender,
        'an id of 256 characters is kept',
      );
    },

  "a delivery's slot carries its prefix, and nothing else's does": async (
    assert,
  ) => {
    assert.strictEqual(webhookDeliverySlot('gh-1'), 'delivery:gh-1');
    assert.true(isWebhookDeliverySlot(webhookDeliverySlot('gh-1')));
    assert.false(isWebhookDeliverySlot('2026-11-24T09:00:00.000Z'));
    assert.false(isWebhookDeliverySlot('12345'));
  },
}) as SharedTests<{}>;

export default tests;
