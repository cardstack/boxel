import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { CallApiSlot } from '@cardstack/runtime-common/card-operations';

import { keyOfferedForSlot, type SlotSend } from '../lib/slot-fill.ts';

const VENDOR = 'https://api.vendor.example/';
const OTHER = 'https://api.other.example/';
const SHEETS = 'https://sheets.googleapis.com/';

function slot(fields: Partial<CallApiSlot> = {}): CallApiSlot {
  return {
    name: 'userKey',
    key: 'userKey',
    placement: 'header',
    at: 'headers.authorization',
    ...fields,
  } as CallApiSlot;
}

function sentTo(destination: string, fields?: Partial<CallApiSlot>): SlotSend {
  return { slot: slot(fields), callApi: { destination } };
}

module(basename(import.meta.filename), function () {
  test('a pasted key is offered wherever a slot takes one', function (assert) {
    assert.true(
      keyOfferedForSlot({ kind: 'static', apiHosts: null }, [
        sentTo(VENDOR),
        sentTo(OTHER),
      ]),
    );
  });

  test('an OAuth key is offered only when its API hosts reach every destination the slot is sent to', function (assert) {
    let vendorOnly = { kind: 'oauth-connection', apiHosts: [VENDOR] };
    assert.true(
      keyOfferedForSlot(vendorOnly, [sentTo(VENDOR)]),
      'offered for a slot sent only to its host',
    );
    assert.false(
      keyOfferedForSlot(vendorOnly, [sentTo(VENDOR), sentTo(OTHER)]),
      'not offered once one operation sends the slot elsewhere',
    );
    assert.true(
      keyOfferedForSlot({ kind: 'oauth-client', apiHosts: null }, [
        sentTo(VENDOR),
        sentTo(OTHER),
      ]),
      'a client that names no API hosts is held to none',
    );
  });

  test('a key is offered only when every operation sending the slot takes its kind', function (assert) {
    let pasted = { kind: 'static', apiHosts: null };
    assert.false(
      keyOfferedForSlot(pasted, [
        sentTo(VENDOR),
        sentTo(VENDOR, { keyKind: 'oauth' }),
      ]),
      'one operation declaring another kind rules it out for the slot',
    );
    assert.true(
      keyOfferedForSlot(pasted, [sentTo(VENDOR, { transform: 'basic' })]),
      'a basic-auth slot takes a pasted key',
    );
    assert.false(
      keyOfferedForSlot({ kind: 'oauth-connection', apiHosts: null }, [
        sentTo(VENDOR, { transform: 'basic' }),
      ]),
      'and not an OAuth token',
    );
  });

  test("a service account is offered only for Google's services", function (assert) {
    let robot = { kind: 'google-service-account', apiHosts: null };
    assert.true(keyOfferedForSlot(robot, [sentTo(SHEETS)]));
    assert.false(keyOfferedForSlot(robot, [sentTo(VENDOR)]));
  });

  test('a key of a kind no slot takes is never offered', function (assert) {
    assert.false(
      keyOfferedForSlot({ kind: 'not-a-kind', apiHosts: null }, [
        sentTo(VENDOR),
      ]),
    );
  });
});
