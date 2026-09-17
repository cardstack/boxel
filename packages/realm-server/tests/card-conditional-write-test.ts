import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { join, basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync } = fsExtra;
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
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

// A conditional write: `If-Match` on a card+json `PATCH` or `DELETE`, which
// lets a client say "only apply this if the card is still the one I saw" and
// be refused rather than silently overwrite a card that moved underneath it.
//
// The validator it names is the card's `ETag` — the one a `GET` of the card
// hands out, built from the index row. That is what an HTTP conditional
// request names, and the realm's read-your-own-writes contract is what makes
// it usable: a client is served its own writes, so the validator it holds
// describes what it last read.
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

    // Both halves of an incremental index pass. The initiation event is
    // broadcast per written file *before* indexing runs, so it is the earliest
    // signal that something was staged — a test asserting a write was refused
    // has to count it, or it only checks that the refusal failed to finish.
    function indexEvents(messages: MatrixEvent[], indexType: string) {
      return messages.filter(
        (m) =>
          m.type === APP_BOXEL_REALM_EVENT_TYPE &&
          m.content.eventName === 'index' &&
          m.content.indexType === indexType,
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
        let setupSince = Date.now();
        let moved = await request
          .patch('/person-1')
          .send(patchPersonBody('Van Gogh'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(moved.status, 200, 'the card is moved past it');

        // Drain the setup write's own events before the window opens. A
        // write's index events are broadcast without await ordering, so the
        // `PATCH` above can return — having waited for its index job — while
        // its incremental event is still on its way. Opening the window
        // without flushing it first lets that event land inside the window and
        // be read as the refusal's, which names the same card.
        await waitForIncrementalIndexEvent(getMessagesSince, setupSince);

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

        // The control is a write to a DIFFERENT card. Its event proves the
        // window is one an event can arrive in — without a control, "no
        // event" is equally satisfied by a listener that sees nothing at all.
        // Aiming it elsewhere is what makes the two outcomes distinguishable:
        // a control over the same card with the same body would be a no-op if
        // the refused write had landed, and the commit writes nothing and
        // queues nothing for a no-op, so the counts would agree either way.
        let accepted = await request
          .patch('/person-2')
          .send(patchPersonBody('Paper'))
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(accepted.status, 200, 'the control write succeeds');
        await waitForIncrementalIndexEvent(getMessagesSince, since);

        let messages = await getMessagesSince(since);
        // Both halves are checked: the initiation event is broadcast per
        // written file *before* indexing runs, so a refusal that staged
        // anything shows up there first.
        //
        // The assertion is about which card the window's events name, not how
        // many there are: the control's presence proves the window is one an
        // event can arrive in, and the refused card's absence is the claim.
        for (let indexType of ['incremental-index-initiation', 'incremental']) {
          let named = indexEvents(messages, indexType).map((event) => {
            let content = event.content as {
              invalidations?: string[];
              updatedFile?: string;
            };
            return [
              ...(content.invalidations ?? []),
              ...(content.updatedFile ? [content.updatedFile] : []),
            ].join(' ');
          });
          assert.true(
            named.some((urls) => urls.includes('person-2')),
            `the control's ${indexType} event arrived in the window`,
          );
          assert.false(
            named.some((urls) => urls.includes('person-1')),
            `no ${indexType} event in the window names the refused card`,
          );
        }
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
