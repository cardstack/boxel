import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import { Deferred, rri, type Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// Where two writers of one card stop excluding each other: once the first
// one's bytes are durable, removal or not.
//
// The write locks order the read-merge-write of the files a write touches.
// That ordering is settled once the bytes are durable — everything after it is
// indexing, which reads the files back off disk and is correct whatever
// another writer does meanwhile. A removal is no exception: its pass indexes
// the url by whether the file is on disk when the pass runs, so a writer that
// recreates the path while the removal's pass is still pending keeps its card
// (covered through the routes in the operations endpoint's index-wait tests).
//
// Each pass is held open below so that no pass is ever in flight from the
// pre-staging drain's point of view. That is deliberate: the drain waits on
// every pass in the realm whoever produced it, so with it live the second
// writer parks there and these tests could not tell which gate held it. What
// they pin is the locks. The drain's own contract is covered by
// card-save-skip-index-wait-test.
const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
  }
`;

// Long enough past a warm write's real cost that a request still pending is
// unambiguous, short enough to keep the test quick.
const WAIT_OBSERVATION_MS = 800;

function resolveAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hold every index pass open, and count them as they arrive. A writer that has
// reached here has taken the locks, staged and made its bytes durable — so the
// count is how many writers got that far while the first was still waiting.
function stubIndexPasses(realm: Realm): {
  reached: () => number;
  releaseAll: () => void;
  restore: () => void;
} {
  let updater = realm.realmIndexUpdater as any;
  let arrivals = 0;
  let open: Deferred<void>[] = [];
  updater.updateChanges = async () => {
    arrivals++;
    let gate = new Deferred<void>();
    open.push(gate);
    await gate.promise;
  };
  return {
    reached: () => arrivals,
    releaseAll: () => {
      for (let gate of open) {
        gate.fulfill();
      }
      open = [];
    },
    restore: () => {
      delete updater.updateChanges;
    },
  };
}

function patch(request: RealmRequest, lastName: string) {
  return request
    .patch('/person-1')
    .send({
      data: {
        type: 'card',
        attributes: { firstName: 'Mango', lastName },
        meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
      },
    })
    .set('Accept', 'application/vnd.card+json');
}

module(basename(import.meta.filename), function () {
  module('concurrent writers of one card', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4452/concurrent-saves/');
    let realm: Realm;
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
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

    test('a second save writes while the first is still indexing', async function (assert) {
      assert.timeout(30000);
      // Stated as an arrival count rather than as a duration: a second writer
      // that reaches its own index pass has been through the locks, the
      // staging and the durable write of the card the first writer is still
      // indexing. Held across that wait it could not have — it would be queued
      // on the lock with nothing written.
      let passes = stubIndexPasses(realm);
      try {
        let firstSettled = false;
        let firstDone = patch(request, 'First').then((response) => {
          firstSettled = true;
          return response;
        });

        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.strictEqual(
          passes.reached(),
          1,
          'the first save is parked on its index pass',
        );
        assert.false(firstSettled, 'and has not answered');

        let secondSettled = false;
        let secondDone = patch(request, 'Second').then((response) => {
          secondSettled = true;
          return response;
        });

        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.strictEqual(
          passes.reached(),
          2,
          'the second save reached its own index pass rather than queueing ' +
            'behind the first one for the files',
        );
        assert.false(
          secondSettled,
          'and is parked on that pass, not answering ahead of it',
        );

        passes.releaseAll();
        let [first, second] = await Promise.all([firstDone, secondDone]);
        assert.strictEqual(
          first.status,
          200,
          `first save answered 200 — ${JSON.stringify(first.body)}`,
        );
        assert.strictEqual(
          second.status,
          200,
          `second save answered 200 — ${JSON.stringify(second.body)}`,
        );
      } finally {
        passes.releaseAll();
        passes.restore();
      }
    });

    test('a removal frees the card for the next writer once its bytes are gone', async function (assert) {
      assert.timeout(30000);
      // The same harness and window as the save above, and the same answer:
      // the next writer is not held behind the removal's index pass.
      let passes = stubIndexPasses(realm);
      try {
        let removalSettled = false;
        let removalDone = request
          .delete('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .then((response) => {
            removalSettled = true;
            return response;
          });

        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.strictEqual(
          passes.reached(),
          1,
          'the removal is parked on its index pass',
        );
        assert.false(removalSettled, 'and has not answered');

        // It takes the files while the removal's pass is still held, and
        // finds the card already gone: the removal's bytes are what the
        // locks ordered it after.
        let recreate = await patch(request, 'Recreated');
        assert.true(
          recreate.status >= 400,
          `the write behind a removal finds the card gone — status ${recreate.status}`,
        );
        assert.false(
          removalSettled,
          "and answered while the removal's pass was still pending",
        );
        assert.strictEqual(
          passes.reached(),
          1,
          'having written nothing, it reached no index pass of its own',
        );

        passes.releaseAll();
        let removal = await removalDone;
        assert.strictEqual(
          removal.status,
          204,
          `the removal answers once its pass is let through — ${JSON.stringify(removal.body)}`,
        );
      } finally {
        passes.releaseAll();
        passes.restore();
      }
    });
  });
});
