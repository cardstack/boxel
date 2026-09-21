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

// A JSON-API card POST / PATCH normally blocks before responding on the
// in-flight indexing that can move what it resolves: the passes that touched
// an executable module or the realm's config document, which the updater
// exposes as `incrementalIndexingAffectingStaging()`. A caller can opt out
// with the `x-boxel-skip-index-wait` header: the write indexes deferred and
// answers from the serialized document.
//
// The updater's gates are stubbed per test rather than raced against a real
// job: a real incremental settles as fast as the worker runs it, so "the write
// did not wait" can't be asserted deterministically against one (the same
// reason read-index-drain-test.ts stubs it). A never-resolving gate lets a
// skip-index-wait write prove it returns without ever awaiting the gate, while
// a controllable gate proves the default write does await it.
//
// The wide gate is stubbed here too, in the opposite direction: a write that
// parked on every in-flight pass — rather than on the ones that can move what
// it resolves — would hang on a never-resolving `incrementalIndexing()`, which
// is what makes "one card's fan-out gates every other card's write" a failure
// rather than a slowdown nobody can see.

const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
  }
`;

// A gate that never settles. A write that awaits the gate it is installed on
// hangs forever; a write that doesn't consult that gate is unaffected.
const NEVER: Promise<void> = new Promise(() => {});

// Shadow one of the updater's quiescence gates with an instance property; the
// returned callback deletes it to restore the real implementation.
function stubGate(
  realm: Realm,
  name: 'incrementalIndexing' | 'incrementalIndexingAffectingStaging',
  gate: () => Promise<void> | undefined,
): () => void {
  let updater = realm.realmIndexUpdater as any;
  updater[name] = gate;
  return () => {
    delete updater[name];
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
      let restore = stubGate(
        realm,
        'incrementalIndexingAffectingStaging',
        () => NEVER,
      );
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
      let restore = stubGate(
        realm,
        'incrementalIndexingAffectingStaging',
        () => NEVER,
      );
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

    test('by default a PATCH waits for in-flight indexing that can move what it resolves', async function (assert) {
      assert.timeout(15000);
      // A gate the test resolves on demand, standing in for an in-flight pass
      // that has not drained yet.
      let gate = new Deferred<void>();
      let restore = stubGate(
        realm,
        'incrementalIndexingAffectingStaging',
        () => gate.promise,
      );
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

    test('a PATCH does not wait for indexing that cannot move what it resolves', async function (assert) {
      assert.timeout(15000);
      // Every in-flight pass parked forever, qualifying or not. A write that
      // waited on this set would never answer — which is what a hub card's
      // instance-only fan-out is to every other writer in the realm. The
      // narrower gate is left real, and has nothing pending.
      let restore = stubGate(realm, 'incrementalIndexing', () => NEVER);
      try {
        let response = await request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango', lastName: 'Unblocked' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status — ${JSON.stringify(response.body)}`,
        );
        // Read back out of the index, so the write also indexed its own pass
        // rather than merely skipping the wait.
        assert.strictEqual(
          response.body.data.attributes?.lastName,
          'Unblocked',
          'the patched card comes back from a write that never parked',
        );
      } finally {
        restore();
      }
    });
  });
});
