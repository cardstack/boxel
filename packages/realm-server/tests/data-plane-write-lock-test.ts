import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import type { Realm } from '@cardstack/runtime-common';
import {
  SupportedMimeType,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

// CS-11125 regression coverage: per-realm advisory lock on the data-plane
// write paths. These tests reach the realm-server HTTP API the same way a
// real client would, and rely on Node's event-loop interleaving + the
// Postgres advisory lock to serialize critical sections that pre-CS-11125
// raced. Without the lock applied to PATCH and /_atomic, the assertions
// below detect the lost update / TOCTOU directly.
module(basename(import.meta.filename), function () {
  module('CS-11125: data-plane write serialization', function () {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let request: RealmRequest;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
    }) {
      testRealm = args.testRealm;
      request = withRealmPath(args.request, realmURL);
    }

    module('concurrent PATCH on same card', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('two concurrent PATCHes preserve both non-overlapping field changes', async function (assert) {
        // Replica A patches `firstName`; Replica B patches a different
        // attribute path (`cardInfo.summary`). Pre-CS-11125, both
        // handlers would read `indexEntry.instance` from the same
        // pre-state, compute independent merges, and the second writer
        // would clobber the first's field — last-writer-wins on disk
        // with the loser's change silently dropped. With the per-realm
        // advisory lock around the indexEntry read + writeMany, the
        // second PATCH waits until the first commits, then sees the
        // updated `original` and merges on top of it.
        let auth = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
        let firstNamePatch = request
          .patch('/person-1')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', auth)
          .send({
            data: {
              type: 'card',
              attributes: {
                firstName: 'ConcurrentA',
              },
              meta: {
                adoptsFrom: { module: './person.gts', name: 'Person' },
              },
            },
          });
        let summaryPatch = request
          .patch('/person-1')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', auth)
          .send({
            data: {
              type: 'card',
              attributes: {
                cardInfo: {
                  summary: 'ConcurrentB summary',
                },
              },
              meta: {
                adoptsFrom: { module: './person.gts', name: 'Person' },
              },
            },
          });

        let [firstNameResponse, summaryResponse] = await Promise.all([
          firstNamePatch,
          summaryPatch,
        ]);

        assert.strictEqual(
          firstNameResponse.status,
          200,
          'firstName PATCH succeeds',
        );
        assert.strictEqual(
          summaryResponse.status,
          200,
          'summary PATCH succeeds',
        );

        // Final state on disk must reflect BOTH patches. Without the
        // lock the second writer would have written a merge based on
        // the pre-first-writer state and dropped the other field.
        let finalResponse = await request
          .get('/person-1')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', auth);
        assert.strictEqual(finalResponse.status, 200, 'final GET succeeds');
        let finalDoc = finalResponse.body as LooseSingleCardDocument;
        assert.strictEqual(
          finalDoc.data.attributes?.firstName,
          'ConcurrentA',
          'firstName from PATCH A persisted',
        );
        let cardInfo = finalDoc.data.attributes?.cardInfo as
          | { summary?: string }
          | undefined;
        assert.strictEqual(
          cardInfo?.summary,
          'ConcurrentB summary',
          'cardInfo.summary from PATCH B persisted',
        );
      });
    });

    module('concurrent /_atomic add on same href', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      test('exactly one of two concurrent `add` ops succeeds; the other gets 409', async function (assert) {
        // Pre-CS-11125, two replicas calling POST /_atomic with op=add
        // for the same href could both pass `checkBeforeAtomicWrite`
        // (file doesn't exist yet on either) and proceed to write —
        // last writer silently wins on disk and `boxel_index` ends up
        // interleaved. With the per-realm advisory lock taken at the
        // handler entry, the second request blocks until the first
        // commits, then re-runs the exists check inside the lock and
        // correctly returns 409.
        let auth = `Bearer ${createJWT(testRealm, 'user', ['read', 'write'])}`;
        let makeAddBody = (firstName: string) => ({
          'atomic:operations': [
            {
              op: 'add',
              href: 'concurrent-add.json',
              data: {
                type: 'card',
                attributes: { firstName },
                meta: {
                  adoptsFrom: { module: './person.gts', name: 'Person' },
                },
              },
            },
          ],
        });
        // `?waitForIndex=true` makes the POST return only once indexing
        // has caught up to the write. Without it, `/_atomic` resolves on
        // durability and the GET below races the indexer (404 or stale).
        let postA = request
          .post('/_atomic?waitForIndex=true')
          .set('Accept', SupportedMimeType.JSONAPI)
          .set('Authorization', auth)
          .send(JSON.stringify(makeAddBody('AddA')));
        let postB = request
          .post('/_atomic?waitForIndex=true')
          .set('Accept', SupportedMimeType.JSONAPI)
          .set('Authorization', auth)
          .send(JSON.stringify(makeAddBody('AddB')));

        let [respA, respB] = await Promise.all([postA, postB]);

        let statuses = [respA.status, respB.status].sort();
        assert.deepEqual(
          statuses,
          [201, 409],
          'exactly one add succeeds (201), the other is rejected (409); without the lock both would 201 and silently last-writer-win',
        );

        // The card that did land must come from the winning request,
        // not a torn write. Both POSTs above used waitForIndex=true so
        // the read here is deterministic.
        let winning = respA.status === 201 ? 'AddA' : 'AddB';
        let finalResponse = await request
          .get('/concurrent-add')
          .set('Accept', SupportedMimeType.CardJson)
          .set('Authorization', auth);
        assert.strictEqual(finalResponse.status, 200, 'card readable');
        let finalDoc = finalResponse.body as LooseSingleCardDocument;
        assert.strictEqual(
          finalDoc.data.attributes?.firstName,
          winning,
          'final card matches the winning concurrent add',
        );
      });
    });
  });
});
