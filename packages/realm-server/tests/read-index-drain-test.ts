import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RealmHttpServer as Server } from '../server.ts';
import type { Realm } from '@cardstack/runtime-common';
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
      // Warm the endpoint so the timed request below measures the drain, not
      // cold module/doc assembly.
      let warm = await getPersonAs('john', ['read']);
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

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
      let restore = stubUpdaterGates(testRealm, {
        initiatedBy: (user) => (user === 'hassan' ? gate : undefined),
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

    test('an anonymous reader conservatively waits, bounded, on any pending indexing', async function (assert) {
      let warm = await request
        .get('/person-1')
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(warm.status, 200, `warm-up GET: ${warm.text}`);

      // With no verifiable identity the drain cannot rule the requester out
      // as the writer, so it covers every pending incremental job.
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
          .set('Accept', 'application/vnd.card+json');
        let elapsed = Date.now() - startedAt;
        assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
        assert.true(
          gateResolved,
          'the anonymous read did not return before the gate settled',
        );
        assert.true(
          elapsed >= GATE_RESOLVE_MS - 20,
          `anonymous read held for pending indexing (took ${elapsed}ms)`,
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
