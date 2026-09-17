import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync } = fsExtra;
import type { Realm } from '@cardstack/runtime-common';
import { computeContentHash, rri } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  closeServer,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { PgAdapter } from '@cardstack/postgres';
import type { MatrixEvent } from '@cardstack/base/matrix-event';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { waitForIncrementalIndexEvent } from './helpers/indexing.ts';

// The two conditional-write behaviors of the card+json facade, kept together
// because they are the two halves of one client story: `version` is what a
// client holds while it edits, and `If-Match` is how it refuses to overwrite a
// card that moved underneath it.
//
// They name different validators on purpose. `version` is the fingerprint of
// the `.json` the realm stores, so it moves only when that file is rewritten.
// The `ETag` describes the served *document*, so it also moves when a card
// this one links to is re-indexed — which is what makes it the HTTP cache
// validator, and what `If-Match` compares against.
module(basename(import.meta.filename), function () {
  module('conditional card writes', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;
    // The realm-scoped `request` above prefixes the realm's path, which is
    // what the card URLs want and what `/_server-session` — a server route,
    // not a realm one — must not have.
    let serverRequest: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      request = withRealmPath(args.request, realmURL);
      serverRequest = args.request;
      dir = args.dir;
      dbAdapter = args.dbAdapter;
    }

    function getRealmSetup() {
      return {
        testRealm,
        testRealmHttpServer,
        request,
        serverRequest,
        dir,
        dbAdapter,
      };
    }

    function cardFile(name: string) {
      return join(dir.name, 'realm_server_1', 'test', name);
    }

    // The realm writes a card as `JSON.stringify(doc, null, 2)` and records
    // the hash of exactly those bytes, so the file on disk is the whole input
    // to the fingerprint a response reports.
    function storedVersion(name: string) {
      return computeContentHash(readFileSync(cardFile(name), 'utf8'));
    }

    function patchPersonBody(firstName: string) {
      return {
        data: {
          type: 'card',
          attributes: { firstName },
          meta: {
            adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
          },
        },
      };
    }

    function patchFriendBody(firstName: string) {
      return {
        data: {
          type: 'card',
          attributes: { firstName },
          meta: {
            adoptsFrom: { module: rri('./friend.gts'), name: 'Friend' },
          },
        },
      };
    }

    function incrementalIndexEvents(messages: MatrixEvent[]) {
      return messages.filter(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === 'incremental',
      );
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    module('public writable realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      let { getMessagesSince } = setupMatrixRoom(hooks, getRealmSetup);

      test('a PATCH naming a validator the card has moved past is refused, and writes nothing', async function (assert) {
        let firstRead = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let staleEtag = firstRead.get('etag') ?? '';
        assert.ok(staleEtag, 'the read hands out a validator');

        let moved = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          moved.status,
          200,
          `the unconditional write succeeds: ${moved.text}`,
        );
        assert.notStrictEqual(
          moved.get('etag'),
          staleEtag,
          'and moves the card past the validator read above',
        );
        let bytesBefore = readFileSync(cardFile('person-1.json'), 'utf8');

        let response = await request
          .patch('/person-1')
          .send(patchPersonBody('Paper'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', staleEtag);

        assert.strictEqual(response.status, 412, 'HTTP 412 status');
        assert.strictEqual(
          readFileSync(cardFile('person-1.json'), 'utf8'),
          bytesBefore,
          'the stored file is untouched',
        );
        let after = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          after.body?.data?.attributes?.firstName,
          'Van Gogh',
          'and the card still reads as the write before it left it',
        );
      });

      test('a PATCH naming the validator the card still carries is applied', async function (assert) {
        let read = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let etag = read.get('etag') ?? '';
        assert.ok(etag, 'the read hands out a validator');

        let response = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', etag);

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status: ${response.text}`,
        );
        assert.strictEqual(
          response.body?.data?.attributes?.firstName,
          'Van Gogh',
          'and answers with the patched card, as an unconditional PATCH does',
        );
      });

      test('a PATCH asking only that the card be there is applied', async function (assert) {
        let response = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', '*');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status: ${response.text}`,
        );
        assert.strictEqual(
          response.body?.data?.attributes?.firstName,
          'Van Gogh',
          'and the patch lands',
        );
      });

      test('a validator the realm never issued is refused whatever its spelling', async function (assert) {
        for (let ifMatch of [
          '"not-a-validator"',
          'W/"not-a-validator"',
          '"one", "two"',
        ]) {
          let response = await request
            .patch('/person-1')
            .send(patchPersonBody('Van Gogh'))
            .set('Accept', 'application/vnd.card+json')
            .set('If-Match', ifMatch);
          assert.strictEqual(
            response.status,
            412,
            `If-Match: ${ifMatch} is refused`,
          );
        }
      });

      test('a validator the realm issued matches when the client echoes it as weak', async function (assert) {
        let read = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let etag = read.get('etag') ?? '';
        assert.ok(etag, 'the read hands out a validator');

        let response = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', `W/${etag}`);

        assert.strictEqual(
          response.status,
          200,
          `the W/ prefix is ignored on both sides: ${response.text}`,
        );
      });

      test('a refused write enqueues no indexing and broadcasts no event', async function (assert) {
        let read = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let staleEtag = read.get('etag') ?? '';
        let moved = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(moved.status, 200, 'the card is moved past it');

        let since = Date.now();
        let refused = await request
          .patch('/person-1')
          .send(patchPersonBody('Paper'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', staleEtag);
        assert.strictEqual(
          refused.status,
          412,
          'the conditional write is refused',
        );

        // The control: a write the realm does accept, made after the refused
        // one and in the same window. Its event is what proves the window is
        // one an event can arrive in — without it, "no event" would also be
        // satisfied by a listener that sees nothing at all. The refused write
        // came first, so anything it broadcast is already visible by the time
        // this one's event is.
        let accepted = await request
          .patch('/person-1')
          .send(patchPersonBody('Paper'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(accepted.status, 200, 'the control write succeeds');
        await waitForIncrementalIndexEvent(getMessagesSince, since);

        let events = incrementalIndexEvents(await getMessagesSince(since));
        assert.strictEqual(
          events.length,
          1,
          'exactly one write in the window reached the index',
        );
        assert.deepEqual(
          (events[0].content as { invalidations?: string[] }).invalidations,
          [`${realmURL.href}person-1`],
          'and it is the one the realm accepted',
        );
      });

      test('a DELETE naming a validator the card has moved past is refused, and removes nothing', async function (assert) {
        let read = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let staleEtag = read.get('etag') ?? '';
        let moved = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(moved.status, 200, 'the card is moved past it');

        let response = await request
          .delete('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', staleEtag);

        assert.strictEqual(response.status, 412, 'HTTP 412 status');
        assert.true(
          existsSync(cardFile('person-1.json')),
          'the card is still on disk',
        );
        let after = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(after.status, 200, 'and still serves');
      });

      test('a DELETE naming the validator the card still carries removes it', async function (assert) {
        let read = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let etag = read.get('etag') ?? '';
        assert.ok(etag, 'the read hands out a validator');

        let response = await request
          .delete('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', etag);

        assert.strictEqual(
          response.status,
          204,
          `HTTP 204 status: ${response.text}`,
        );
        assert.false(
          existsSync(cardFile('person-1.json')),
          'and the card is gone',
        );
      });

      test('a DELETE asking only that the card be there removes it', async function (assert) {
        let response = await request
          .delete('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', '*');

        assert.strictEqual(
          response.status,
          204,
          `HTTP 204 status: ${response.text}`,
        );
        assert.false(
          existsSync(cardFile('person-1.json')),
          'and the card is gone',
        );
      });

      test('asking only that a card be there says nothing about one that is not', async function (assert) {
        // `*` is a question about existence, which these handlers answer for
        // themselves — so it reaches the 404 an unconditional request would,
        // rather than a 412 that would say less.
        let unconditional = await request
          .delete('/no-such-card')
          .set('Accept', 'application/vnd.card+json');
        let conditional = await request
          .delete('/no-such-card')
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', '*');

        assert.strictEqual(
          conditional.status,
          unconditional.status,
          'the two answer alike',
        );
        assert.strictEqual(conditional.status, 404, 'with a 404');
      });

      test('a body the realm would refuse anyway is still answered by what is wrong with it', async function (assert) {
        let response = await request
          .patch('/person-1')
          .send({ data: 'not a card resource' })
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', '"not-a-validator"');

        assert.strictEqual(
          response.status,
          400,
          'the payload is reported before the precondition it would also fail',
        );
      });

      test('a write carrying no If-Match is unaffected by any of this', async function (assert) {
        let response = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status: ${response.text}`,
        );
        let removal = await request
          .delete('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(removal.status, 204, 'and so is the removal');
      });

      test('a PATCH reports the version of the file it wrote, and it moves with the bytes', async function (assert) {
        let first = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(first.status, 200, `HTTP 200 status: ${first.text}`);
        assert.strictEqual(
          first.body?.data?.meta?.version,
          storedVersion('person-1.json'),
          'the version is the fingerprint of the stored file',
        );

        let second = await request
          .patch('/person-1')
          .send(patchPersonBody('Paper'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          second.status,
          200,
          `HTTP 200 status: ${second.text}`,
        );
        assert.strictEqual(
          second.body?.data?.meta?.version,
          storedVersion('person-1.json'),
          'and again after the second write',
        );
        assert.notStrictEqual(
          second.body?.data?.meta?.version,
          first.body?.data?.meta?.version,
          'a write that changes the card changes its version',
        );
      });

      test('a PATCH that changes nothing reports the version the card already held', async function (assert) {
        let write = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(write.status, 200, `HTTP 200 status: ${write.text}`);
        let version = write.body?.data?.meta?.version;
        assert.ok(version, 'the write reports a version');

        let noop = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(noop.status, 200, `HTTP 200 status: ${noop.text}`);
        assert.strictEqual(
          noop.body?.data?.meta?.version,
          version,
          'a patch that leaves the file alone leaves the version alone',
        );
        assert.strictEqual(
          noop.body?.data?.meta?.version,
          storedVersion('person-1.json'),
          'and it is still the fingerprint of what is stored',
        );
      });

      test('a POST reports the version of the file it created', async function (assert) {
        let response = await request
          .post('/')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          201,
          `HTTP 201 status: ${response.text}`,
        );
        let id: string = response.body?.data?.id;
        assert.ok(id, 'the create reports the id it minted');
        assert.strictEqual(
          response.body?.data?.meta?.version,
          storedVersion(`Person/${id.split('/').pop()}.json`),
          'the version is the fingerprint of the file it wrote',
        );
      });

      test('a GET reports the version the realm last wrote for the card', async function (assert) {
        // Only the realm's own write path records a content hash, so a card
        // that reached disk another way — as this realm's cards did — carries
        // no version until it is next written.
        let beforeAnyWrite = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(beforeAnyWrite.status, 200, 'the card serves');
        assert.strictEqual(
          beforeAnyWrite.body?.data?.meta?.version,
          undefined,
          'and reports no version for a file the realm has never written',
        );

        let write = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(write.status, 200, `HTTP 200 status: ${write.text}`);

        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          response.body?.data?.meta?.version,
          storedVersion('person-1.json'),
          'the read reports the fingerprint of the stored file',
        );
        assert.strictEqual(
          response.body?.data?.meta?.version,
          write.body?.data?.meta?.version,
          'which is the version the write that produced it reported',
        );
      });

      test("a linked card's change moves the validator and leaves the version alone", async function (assert) {
        // The whole reason there are two: `hassan` links to `jade`, so writing
        // `jade` re-indexes `hassan` and changes what a GET of it serves — but
        // `hassan.json` is not rewritten, so the base an optimistic client
        // holds for it must not move.
        let write = await request
          .patch('/hassan')
          .send(patchFriendBody('Hassan'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(write.status, 200, `HTTP 200 status: ${write.text}`);

        let before = await request
          .get('/hassan')
          .set('Accept', 'application/vnd.card+json');
        let etagBefore = before.get('etag') ?? '';
        let versionBefore = before.body?.data?.meta?.version;
        assert.ok(etagBefore, 'the card carries a validator');
        assert.ok(versionBefore, 'and a version');

        let linked = await request
          .patch('/jade')
          .send(patchFriendBody('Jade Vincent'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          linked.status,
          200,
          `the linked card is written: ${linked.text}`,
        );

        let after = await request
          .get('/hassan')
          .set('Accept', 'application/vnd.card+json');
        assert.notStrictEqual(
          after.get('etag'),
          etagBefore,
          'the re-index moves the cache validator',
        );
        assert.strictEqual(
          after.body?.data?.meta?.version,
          versionBefore,
          'and leaves the version, which describes only this card’s own file',
        );
      });

      test('a client echoing a version back does not persist it', async function (assert) {
        let response = await request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Van Gogh' },
              meta: {
                adoptsFrom: { module: rri('./person.gts'), name: 'Person' },
                version: 'a-version-the-client-was-served',
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status: ${response.text}`,
        );
        let stored = JSON.parse(
          readFileSync(cardFile('person-1.json'), 'utf8'),
        );
        assert.strictEqual(
          stored.data.meta.version,
          undefined,
          'the stored file names no version',
        );
        assert.strictEqual(
          response.body?.data?.meta?.version,
          storedVersion('person-1.json'),
          'and the response reports the one the realm computed',
        );
      });
    });

    // A card read picks its link shape per request, and the shapes take
    // different variants of one validator so a client holding either is never
    // 304'd to the other. That distinction is about representations; a
    // conditional write asks about the card, so a client that read it under
    // the narrower shape must not be refused for it.
    module('a realm serving the narrower read shape', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'realistic',
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        liveReadsResolveLinksOnly: true,
        onRealmSetup,
      });

      test('a validator issued by a links-only read still names the card', async function (assert) {
        let read = await request
          .get('/hassan')
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(read.status, 200, `HTTP 200 status: ${read.text}`);
        assert.strictEqual(
          (read.body?.included ?? []).length,
          0,
          'the read answered the link without side-loading its target',
        );
        let etag = read.get('etag') ?? '';
        assert.ok(etag, 'and handed out a validator');

        let response = await request
          .patch('/hassan')
          .send(patchFriendBody('Hassan'))
          .set('Accept', 'application/vnd.card+json')
          .set('If-Match', etag);

        assert.strictEqual(
          response.status,
          200,
          `the write is not refused over the shape it was read in: ${response.text}`,
        );
      });
    });
  });
});
