import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import { ANONYMOUS_REQUESTER, type Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  closeServer,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';

// The card read endpoints (card+json / card+html GET) gate on the
// requester's OWN in-flight incremental indexing — scoped and bounded — via
// Realm.drainRequestersOwnIndexing. These tests pin the gate's three
// behaviors at the HTTP boundary: another user's pending indexing never
// holds a read, the writer's own pending indexing does, and the hold is
// bounded by the realm's readIndexDrainBudgetMs.
//
// The updater's gates are stubbed per test rather than racing real jobs: a
// real incremental job settles as fast as the worker runs it, so "the read
// did not wait" could never be asserted deterministically against one.
// (RealmIndexUpdater's own tagging/filtering is covered in
// realm-index-updater-test.ts.)

const DRAIN_BUDGET_MS = 4_000;
// A stubbed gate that resolves after this long distinguishes "the read
// waited for the gate" (elapsed >= GATE_RESOLVE_MS) from "the read skipped
// it" (elapsed well under), with margin against a slow cold request.
const GATE_RESOLVE_MS = 500;
// "Did not wait" assertions allow up to this much for the request itself;
// far above a warm request's actual cost, far below the gate/budget.
const NO_WAIT_CEILING_MS = 2_000;

function resolveAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NEVER: Promise<void> = new Promise(() => {});

// Shadow the updater's gate methods with instance properties; delete them to
// restore the prototype implementations.
function stubUpdaterGates(
  realm: Realm,
  stubs: {
    initiatedBy?: (user: string) => Promise<void> | undefined;
    all?: () => Promise<void> | undefined;
  },
): () => void {
  let updater = realm.realmIndexUpdater as any;
  if (stubs.initiatedBy) {
    updater.incrementalIndexingInitiatedBy = stubs.initiatedBy;
  }
  if (stubs.all) {
    updater.incrementalIndexing = stubs.all;
  }
  return () => {
    delete updater.incrementalIndexingInitiatedBy;
    delete updater.incrementalIndexing;
  };
}

module(basename(import.meta.filename), function () {
  module('card read drain | permissioned realm', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      realmURL,
      permissions: {
        hassan: ['read', 'write'],
        john: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      readIndexDrainBudgetMs: DRAIN_BUDGET_MS,
      onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: any;
      }) {
        testRealm = args.testRealm;
        testRealmHttpServer = args.testRealmHttpServer;
        request = withRealmPath(args.request, realmURL);
      },
    });

    async function getPersonAs(
      user: string,
      permissions: ('read' | 'write')[],
      accept = 'application/vnd.card+json',
    ) {
      return request
        .get('/person-1')
        .set('Accept', accept)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, user, permissions)}`,
        );
    }

    test("a reader is not held by another user's in-flight indexing", async function (assert) {
      // Warm both endpoints so the timed requests below measure the drain,
      // not cold module/doc assembly.
      let warm = await getPersonAs('john', ['read']);
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);
      let warmHtml = await getPersonAs(
        'john',
        ['read'],
        'application/vnd.card+html',
      );
      assert.strictEqual(
        warmHtml.status,
        200,
        `card+html warm-up GET: ${warmHtml.text}`,
      );

      // hassan has a (never-settling) job in flight; the unscoped gate is
      // also held open, so a read that (wrongly) consulted it would hold for
      // the full budget.
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) => (user === 'hassan' ? NEVER : undefined),
        all: () => NEVER,
      });
      try {
        let startedAt = Date.now();
        let response = await getPersonAs('john', ['read']);
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          elapsed < NO_WAIT_CEILING_MS,
          `read returned without waiting on the writer's job (took ${elapsed}ms)`,
        );

        startedAt = Date.now();
        let htmlResponse = await getPersonAs(
          'john',
          ['read'],
          'application/vnd.card+html',
        );
        elapsed = Date.now() - startedAt;
        assert.strictEqual(
          htmlResponse.status,
          200,
          `card+html HTTP 200: ${htmlResponse.text}`,
        );
        assert.true(
          elapsed < NO_WAIT_CEILING_MS,
          `card+html read returned without waiting on the writer's job (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test("the writer's own read waits for their in-flight indexing", async function (assert) {
      let warm = await getPersonAs('hassan', ['read', 'write']);
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      let gateResolved = false;
      let gate = resolveAfter(GATE_RESOLVE_MS).then(() => {
        gateResolved = true;
      });
      // The unscoped gate must report the job as pending too: a real tagged
      // job always appears in both gates, and the drain's fast-path probe
      // reads the unscoped one.
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) => (user === 'hassan' ? gate : undefined),
        all: () => gate,
      });
      try {
        let startedAt = Date.now();
        let response = await getPersonAs('hassan', ['read', 'write']);
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          gateResolved,
          'the read did not return before the gate settled',
        );
        assert.true(
          elapsed >= GATE_RESOLVE_MS - 20,
          `read held until the writer's own job settled (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test("the writer's read proceeds on the current index generation once the budget expires", async function (assert) {
      let warm = await getPersonAs('hassan', ['read', 'write']);
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) => (user === 'hassan' ? NEVER : undefined),
        all: () => NEVER,
      });
      try {
        let startedAt = Date.now();
        let response = await getPersonAs('hassan', ['read', 'write']);
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          elapsed >= DRAIN_BUDGET_MS - 50,
          `read held for the drain budget (took ${elapsed}ms)`,
        );
        assert.true(
          elapsed < DRAIN_BUDGET_MS + NO_WAIT_CEILING_MS,
          `read was released by the budget, not the gate (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    // End-to-end (no stubs): the authenticated write handlers must tag their
    // deferred indexing jobs with the writer, or this same-user
    // write-then-read sees the pre-write schema. The public-writable variant
    // of this flow cannot cover the tagging — an unauthenticated write
    // produces an untagged job and an unidentified read takes the
    // conservative all-jobs hold, so it passes with the tags removed.
    test("an authenticated writer's follow-up read sees their own deferred write indexed", async function (assert) {
      let auth = () =>
        `Bearer ${createJWT(testRealm, 'hassan', ['read', 'write'])}`;
      let cardSource = (secondField: string) => `
        import { contains, field, CardDef } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';

        export class DrainTestCard extends CardDef {
          @field field1 = contains(StringField);
          @field ${secondField} = contains(StringField);
        }
      `;

      let createDef = await request
        .post('/drain-test-card.gts')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', auth())
        .send(cardSource('field2'));
      assert.strictEqual(createDef.status, 204, `HTTP 204: ${createDef.text}`);

      let createInstance = await request
        .post('/')
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', auth())
        .send({
          data: {
            type: 'card',
            attributes: { field1: 'a', field2: 'b' },
            meta: {
              adoptsFrom: {
                module: `${realmURL.href}drain-test-card`,
                name: 'DrainTestCard',
              },
            },
          },
        });
      assert.strictEqual(
        createInstance.status,
        201,
        `HTTP 201: ${createInstance.text}`,
      );
      let id = createInstance.body.data.id as string;

      // The +source POST answers once the bytes are durable; its indexing is
      // the deferred job the follow-up GET must wait out.
      let renameField = await request
        .post('/drain-test-card.gts')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', auth())
        .send(cardSource('field2a'));
      assert.strictEqual(
        renameField.status,
        204,
        `HTTP 204: ${renameField.text}`,
      );

      let readBack = await request
        .get(new URL(id).pathname)
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', auth());
      assert.strictEqual(readBack.status, 200, `HTTP 200: ${readBack.text}`);
      let attributes = readBack.body.data.attributes;
      assert.true(
        'field2a' in attributes,
        `post-rename schema is served: ${JSON.stringify(attributes)}`,
      );
      assert.false(
        'field2' in attributes,
        `pre-rename field is gone: ${JSON.stringify(attributes)}`,
      );
    });

    // Pins the wiring between requestContext.authenticatedUser and the job
    // tag for every HTTP write route: a handler that drops its
    // `initiatingUser` argument silently disables read-your-writes for that
    // route, which no black-box read test can catch deterministically. The
    // spy shadows `enqueueUpdate` (the synchronous `update` path calls
    // through it, so one spy covers both), delegates to the prototype, and
    // captures each job's `initiatedBy`.
    test('every HTTP write route tags its indexing job with the writer', async function (assert) {
      let auth = () =>
        `Bearer ${createJWT(testRealm, 'hassan', ['read', 'write'])}`;
      let updater = testRealm.realmIndexUpdater as any;
      let proto = Object.getPrototypeOf(updater);
      let tags = new Map<string, string | null | undefined>();
      let currentOp = 'none';
      updater.enqueueUpdate = function (urls: URL[], opts?: any) {
        tags.set(currentOp, opts?.initiatedBy);
        return proto.enqueueUpdate.call(this, urls, opts);
      };
      let drainJobs = async () => {
        let pending = testRealm.incrementalIndexing();
        if (pending) {
          await pending;
        }
      };
      try {
        currentOp = 'source POST';
        let sourcePost = await request
          .post('/tag-probe.gts')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', auth()).send(`
            import { contains, field, CardDef } from '@cardstack/base/card-api';
            import StringField from '@cardstack/base/string';

            export class TagProbe extends CardDef {
              @field name = contains(StringField);
            }
          `);
        assert.strictEqual(
          sourcePost.status,
          204,
          `source POST: ${sourcePost.text}`,
        );
        await drainJobs();

        currentOp = 'card POST';
        let cardPost = await request
          .post('/')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth())
          .send({
            data: {
              type: 'card',
              attributes: { name: 'probe' },
              meta: {
                adoptsFrom: {
                  module: `${realmURL.href}tag-probe`,
                  name: 'TagProbe',
                },
              },
            },
          });
        assert.strictEqual(cardPost.status, 201, `card POST: ${cardPost.text}`);
        let cardPath = new URL(cardPost.body.data.id as string).pathname;

        currentOp = 'card PATCH';
        let cardPatch = await request
          .patch(cardPath)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth())
          .send({
            data: {
              type: 'card',
              attributes: { name: 'probe2' },
              meta: {
                adoptsFrom: {
                  module: `${realmURL.href}tag-probe`,
                  name: 'TagProbe',
                },
              },
            },
          });
        assert.strictEqual(
          cardPatch.status,
          200,
          `card PATCH: ${cardPatch.text}`,
        );

        currentOp = '_invalidate POST';
        let invalidatePost = await request
          .post('/_invalidate')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', auth())
          .send({
            data: { attributes: { urls: [`${realmURL.href}tag-probe.gts`] } },
          });
        assert.strictEqual(
          invalidatePost.status,
          204,
          `_invalidate POST: ${invalidatePost.text}`,
        );

        currentOp = '_atomic POST';
        let atomicPost = await request
          .post('/_atomic')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', auth())
          .send({
            'atomic:operations': [
              {
                op: 'add',
                href: 'atomic-tag-probe.txt',
                data: {
                  type: 'source',
                  attributes: { content: 'tag probe payload' },
                  meta: {},
                },
              },
            ],
          });
        assert.strictEqual(
          atomicPost.status,
          201,
          `_atomic POST: ${atomicPost.text}`,
        );
        await drainJobs();

        currentOp = 'card DELETE';
        let cardDelete = await request
          .delete(cardPath)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth());
        assert.strictEqual(
          cardDelete.status,
          204,
          `card DELETE: ${cardDelete.text}`,
        );

        currentOp = 'source DELETE';
        let sourceDelete = await request
          .delete('/tag-probe.gts')
          .set('Accept', 'application/vnd.card+source')
          .set('Authorization', auth());
        assert.strictEqual(
          sourceDelete.status,
          204,
          `source DELETE: ${sourceDelete.text}`,
        );
        await drainJobs();

        for (let op of [
          'source POST',
          'card POST',
          'card PATCH',
          '_invalidate POST',
          '_atomic POST',
          'card DELETE',
          'source DELETE',
        ]) {
          assert.strictEqual(
            tags.get(op),
            'hassan',
            `${op} tagged its indexing job with the writer (got ${JSON.stringify(
              tags.get(op),
            )})`,
          );
        }
      } finally {
        await drainJobs();
        delete updater.enqueueUpdate;
      }
    });
  });

  module('card read drain | public readable realm', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let request: RealmRequest;

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      realmURL,
      permissions: {
        '*': ['read'],
        john: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      readIndexDrainBudgetMs: DRAIN_BUDGET_MS,
      onRealmSetup(args: {
        testRealm: Realm;
        testRealmHttpServer: Server;
        request: any;
      }) {
        testRealm = args.testRealm;
        testRealmHttpServer = args.testRealmHttpServer;
        request = withRealmPath(args.request, realmURL);
      },
    });

    test("an anonymous reader skips identified users' pending indexing", async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // A credential-less caller acts as the shared anonymous principal, so
      // an identified user's in-flight job holds nothing for them.
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) =>
          user === ANONYMOUS_REQUESTER ? undefined : NEVER,
        all: () => NEVER,
      });
      try {
        let startedAt = Date.now();
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          elapsed < NO_WAIT_CEILING_MS,
          `anonymous read skipped the identified user's hold (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test('an anonymous reader waits on anonymous-initiated indexing', async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // Anonymous write-then-read stays consistent: a credential-less write
      // tags its job with the anonymous principal, and a credential-less
      // read waits on jobs so tagged.
      let gateResolved = false;
      let gate = resolveAfter(GATE_RESOLVE_MS).then(() => {
        gateResolved = true;
      });
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) =>
          user === ANONYMOUS_REQUESTER ? gate : undefined,
        all: () => gate,
      });
      try {
        let startedAt = Date.now();
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json');
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          gateResolved,
          'the anonymous read did not return before the gate settled',
        );
        assert.true(
          elapsed >= GATE_RESOLVE_MS - 20,
          `anonymous read held for anonymous-initiated indexing (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test('a reader with an unverifiable token conservatively waits, bounded, on any pending indexing', async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // A token that fails verification leaves the requester unknown — they
      // presented credentials, so they might be the writer — and the drain
      // covers every pending incremental job.
      let gateResolved = false;
      let gate = resolveAfter(GATE_RESOLVE_MS).then(() => {
        gateResolved = true;
      });
      let restore = stubUpdaterGates(testRealm, {
        all: () => gate,
      });
      try {
        let startedAt = Date.now();
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', 'Bearer not-a-real-token');
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          gateResolved,
          'the unidentified read did not return before the gate settled',
        );
        assert.true(
          elapsed >= GATE_RESOLVE_MS - 20,
          `unidentified read held for pending indexing (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test('a token accompanied by X-Boxel-Assume-User is not trusted for identity on the public path', async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // Public read authorizes without the assume-user permission check, so
      // the indirection can't be honored — and recording the bearer instead
      // would desynchronize the read identity from the assumed-user tag the
      // same client's writes carry. The requester stays unknown and takes
      // the conservative bounded hold.
      let gateResolved = false;
      let gate = resolveAfter(GATE_RESOLVE_MS).then(() => {
        gateResolved = true;
      });
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: () => undefined,
        all: () => gate,
      });
      try {
        let startedAt = Date.now();
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set('X-Boxel-Assume-User', 'someone-else')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
          );
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          gateResolved,
          'the assume-user read did not return before the gate settled',
        );
        assert.true(
          elapsed >= GATE_RESOLVE_MS - 20,
          `assume-user read held for pending indexing (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });

    test("a token-carrying reader on a public realm is identified and skips other writers' indexing", async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // Public read authorizes without parsing the token, but the drain still
      // learns who the requester is from the token they sent — so john is
      // ruled out as the writer and skips both gates.
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) => (user === 'hassan' ? NEVER : undefined),
        all: () => NEVER,
      });
      try {
        let startedAt = Date.now();
        let response = await request
          .get('/person-1')
          .set('Accept', 'application/vnd.card+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
          );
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          elapsed < NO_WAIT_CEILING_MS,
          `identified reader skipped the pending-indexing hold (took ${elapsed}ms)`,
        );
      } finally {
        restore();
      }
    });
  });
});
