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

// Where two writers of one card stop excluding each other, and why a removal
// is the exception.
//
// The write locks order the read-merge-write of the files a write touches. For
// a write that ordering is settled once its bytes are durable — everything
// after it is indexing, which reads the files back off disk and is correct
// whatever another writer does meanwhile. For a REMOVAL it is not settled
// there: an index pass resolves a removal and a write of one url as the
// removal whichever reached it first, and then skips the visit without asking
// whether the file came back. A writer that recreated the path while the
// removal's pass was still pending would be folded into it, and the row
// dropped for a file that is on disk.
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

    test('a removal holds the card against the next writer until its pass has run', async function (assert) {
      assert.timeout(30000);
      // The carve-out, and the contrast with the save above is what gives it
      // its meaning: the same harness, the same window, a different answer.
      // A writer that reached its own pass while the removal's was still
      // pending would have that pass fold its write into the removal.
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

        let recreateSettled = false;
        let recreateDone = patch(request, 'Recreated').then((response) => {
          recreateSettled = true;
          return response;
        });

        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.strictEqual(
          passes.reached(),
          1,
          'the next writer is queued on the files rather than reaching a ' +
            'pass the removal could absorb it into',
        );
        assert.false(recreateSettled, 'so it has answered nothing either');

        // Letting the removal's pass finish frees the files, and the writer
        // behind it proceeds — which is what says it was queued rather than
        // wedged.
        passes.releaseAll();
        await removalDone;
        await resolveAfter(WAIT_OBSERVATION_MS);
        assert.true(
          recreateSettled,
          'the writer behind the removal proceeds once it has been indexed',
        );

        // And it is ordered after the removal rather than racing it: by the
        // time it holds the files the card is gone, so it refuses instead of
        // writing a row back for a card the realm no longer stores. That
        // refusal is the ordering, stated from the other end — it is only
        // possible because the removal went first and completely.
        let recreate = await recreateDone;
        assert.true(
          recreate.status >= 400,
          `the write behind a removal finds the card gone — status ${recreate.status}`,
        );
        assert.strictEqual(
          passes.reached(),
          1,
          'and never reached an index pass, having nothing to index',
        );
      } finally {
        passes.releaseAll();
        passes.restore();
      }
    });
  });
});
