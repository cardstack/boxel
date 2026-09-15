import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import {
  Deferred,
  SKIP_INDEX_WAIT_HEADER,
  rri,
  type Realm,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// A JSON-API card POST / PATCH normally blocks on the realm's
// in-flight incremental indexing before responding — `createCard` /
// `patchCardInstance` await `incrementalIndexing()`, which settles only once
// EVERY incremental/copy job for the realm drains. A caller can now opt out
// with the `x-boxel-skip-index-wait` header: the write indexes deferred and
// answers from the serialized document.
//
// The updater's gate is stubbed per test rather than raced against a real job:
// a real incremental settles as fast as the worker runs it, so "the write did
// not wait" can't be asserted deterministically against one (the same reason
// read-index-drain-test.ts stubs it). A never-resolving gate lets a
// skip-index-wait write prove it returns without ever awaiting the gate, while
// a controllable gate proves the default write does await it.

const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
  }
`;

// A gate that never settles. A write that awaits `incrementalIndexing()` hangs
// on it forever; a write that doesn't consult the gate is unaffected.
const NEVER: Promise<void> = new Promise(() => {});

// Shadow the updater's quiescence gate with an instance property; the returned
// callback deletes it to restore the real implementation.
function stubIncrementalIndexingGate(
  realm: Realm,
  gate: () => Promise<void> | undefined,
): () => void {
  let updater = realm.realmIndexUpdater as any;
  updater.incrementalIndexing = gate;
  return () => {
    delete updater.incrementalIndexing;
  };
}

// A default (waiting) write parks on the gate, so it never settles on its own —
// long enough past a warm write's real cost that an unsettled request is
// unambiguous, short enough to keep the test quick.
const WAIT_OBSERVATION_MS = 800;

function resolveAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module(basename(import.meta.filename), function () {
  module('card save skip-index-wait', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4451/skip-index-wait/');
    let realm: Realm;
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
        // Wildcard write so the supertest requests below need no token, matching
        // the card write tests elsewhere in this suite.
        '*': ['read', 'write'],
      },
      fileSystem: {
        'person.gts': personGts,
        'person-1.json': {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango', lastName: 'Abdel-Rahman' },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        },
      },
      onRealmSetup(args: { testRealm: Realm; request: SuperTest<Test> }) {
        realm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      },
    });

    test('a POST with x-boxel-skip-index-wait returns without awaiting the indexing gate', async function (assert) {
      assert.timeout(15000);
      // If the write consulted the gate it would hang here forever.
      let restore = stubIncrementalIndexingGate(realm, () => NEVER);
      try {
        let response = await request
          .post('/')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Van Gogh', lastName: 'Tangle' },
              meta: {
                adoptsFrom: {
                  // Absolute: createCard serializes relative to the new
                  // instance's own directory.
                  module: rri(`${realmURL.href}person`),
                  name: 'Person',
                },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .set(SKIP_INDEX_WAIT_HEADER, 'true');

        assert.strictEqual(
          response.status,
          201,
          `HTTP 201 status — ${JSON.stringify(response.body)}`,
        );
        // Echoed from the serialization, not read back out of the index, so the
        // fields the client sent come straight back.
        assert.strictEqual(
          response.body.data.attributes?.lastName,
          'Tangle',
          'the created card is echoed from the serialized document',
        );
      } finally {
        restore();
      }
    });

    test('a PATCH with x-boxel-skip-index-wait returns without awaiting the indexing gate', async function (assert) {
      assert.timeout(15000);
      let restore = stubIncrementalIndexingGate(realm, () => NEVER);
      try {
        let response = await request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango', lastName: 'Tangle' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .set(SKIP_INDEX_WAIT_HEADER, 'true');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status — ${JSON.stringify(response.body)}`,
        );
        assert.strictEqual(
          response.body.data.attributes?.lastName,
          'Tangle',
          'the patched card is echoed from the serialized document',
        );
      } finally {
        restore();
      }
    });

    test('by default a PATCH waits for the indexing gate before responding', async function (assert) {
      assert.timeout(15000);
      // A gate the test resolves on demand, standing in for an in-flight
      // incremental that has not drained yet.
      let gate = new Deferred<void>();
      let restore = stubIncrementalIndexingGate(realm, () => gate.promise);
      try {
        let settled = false;
        let responsePromise = request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango', lastName: 'Waited' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .then((response) => {
            settled = true;
            return response;
          });

        // No skip-index-wait header: the default synchronous-indexing contract
        // parks the write on the gate, so it cannot settle while it is pending.
        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.false(
          settled,
          'the default save is still blocked on the in-flight indexing gate',
        );

        // Draining the gate lets the write finish.
        gate.fulfill();
        let response = await responsePromise;
        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 once the gate drained — ${JSON.stringify(response.body)}`,
        );
      } finally {
        gate.fulfill();
        restore();
      }
    });
  });
});
