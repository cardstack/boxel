import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, request as httpRequest, type Server } from 'http';
import type { AddressInfo } from 'net';
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import cors from '@koa/cors';
import {
  SearchAdmissionGate,
  getSearchInFlight,
  getRealmSearchRequestsInFlight,
  getSearchRequestsInFlight,
  getSearchShedCount,
  resetSearchAdmissionForTests,
  setSearchAdmissionForTests,
} from '../search-inflight.ts';
import {
  attributeSearchRequest,
  httpLogging,
  releaseSearchAdmission,
  searchAdmission,
} from '../middleware/index.ts';

// The admission gate is what stands between a burst of searches and a heap
// exhausted by their concurrent result sets. These tests pin the contract the
// middleware relies on — a hard ceiling, FIFO waiting for a bounded time, a
// cheap shed after it, unconditional admission for indexing traffic — and then
// the middleware's own behaviour over HTTP: which requests are gated, what a
// shed response looks like, and that a slot is handed back however the
// response ends.

// Realm keys only; nothing here resolves them. Encoded-safe in a query string.
const REALM_A = 'realm-a';
const REALM_B = 'realm-b';
const REALM_C = 'realm-c';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Settles `promise` if it resolves before `ms` elapses; otherwise reports it
// still pending. Lets a test assert that a waiter is genuinely blocked without
// depending on the wait timer firing.
async function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let pending = Symbol('pending');
  let result = await Promise.race([
    promise,
    wait(ms).then(() => pending as unknown as T),
  ]);
  return result === (pending as unknown as T)
    ? { settled: false }
    : { settled: true, value: result };
}

module(basename(import.meta.filename), function () {
  module('SearchAdmissionGate', function () {
    test('admits up to the limit and makes the next arrival wait', async function (assert) {
      let gate = new SearchAdmissionGate(2);
      let first = await gate.admit(1000);
      let second = await gate.admit(1000);
      assert.ok(first, 'the first is admitted');
      assert.ok(second, 'the second is admitted');
      assert.strictEqual(gate.inFlight, 2);

      let third = gate.admit(1000);
      assert.strictEqual(gate.waiting, 1, 'the third is queued');
      let blocked = await settledWithin(third, 30);
      assert.false(blocked.settled, 'the third has not been admitted');

      first!();
      let admitted = await settledWithin(third, 200);
      assert.true(admitted.settled, 'a release admits the waiter');
      assert.ok(
        (admitted as { value: unknown }).value,
        'with a release of its own',
      );
      assert.strictEqual(gate.inFlight, 2, 'the slot changed hands');
      assert.strictEqual(gate.waiting, 0);
      assert.strictEqual(gate.shedCount, 0);
    });

    test('a waiter still queued when its wait runs out is shed', async function (assert) {
      let gate = new SearchAdmissionGate(1);
      let held = await gate.admit(1000);
      let result = await gate.admit(20);
      assert.strictEqual(result, null, 'shed');
      assert.strictEqual(gate.shedCount, 1);
      assert.strictEqual(gate.waiting, 0, 'the shed waiter left the queue');
      assert.strictEqual(gate.inFlight, 1, 'the running search is untouched');
      held!();
      assert.strictEqual(gate.inFlight, 0);
    });

    test('a zero wait sheds immediately when the gate is full', async function (assert) {
      let gate = new SearchAdmissionGate(1);
      let held = await gate.admit(0);
      assert.ok(held, 'admitted while a slot is free');
      let result = await gate.admit(0);
      assert.strictEqual(result, null);
      assert.strictEqual(gate.shedCount, 1);
      held!();
    });

    test('waiters are admitted in arrival order', async function (assert) {
      let gate = new SearchAdmissionGate(1);
      let held = await gate.admit(1000);
      let order: string[] = [];
      let a = gate.admit(1000).then((r) => (order.push('a'), r));
      let b = gate.admit(1000).then((r) => (order.push('b'), r));
      let c = gate.admit(1000).then((r) => (order.push('c'), r));
      assert.strictEqual(gate.waiting, 3);

      held!();
      let releaseA = await a;
      assert.deepEqual(order, ['a'], 'one release, one admission');
      releaseA!();
      let releaseB = await b;
      assert.deepEqual(order, ['a', 'b']);
      releaseB!();
      let releaseC = await c;
      assert.deepEqual(order, ['a', 'b', 'c']);
      releaseC!();
      assert.strictEqual(gate.inFlight, 0);
    });

    test('a release hands back exactly one slot however often it is called', async function (assert) {
      let gate = new SearchAdmissionGate(2);
      let release = await gate.admit(0);
      release!();
      release!();
      release!();
      assert.strictEqual(gate.inFlight, 0, 'not negative');
      let again = await gate.admit(0);
      assert.ok(again);
      assert.strictEqual(gate.inFlight, 1);
    });

    test('unconditional admission exceeds the limit and is counted', async function (assert) {
      let gate = new SearchAdmissionGate(1);
      let held = await gate.admit(1000);
      let indexing = gate.admitUnconditionally();
      assert.strictEqual(gate.inFlight, 2, 'past the limit');

      let interactive = gate.admit(1000);
      let blocked = await settledWithin(interactive, 30);
      assert.false(blocked.settled, 'an interactive arrival waits behind it');

      indexing();
      let stillBlocked = await settledWithin(interactive, 30);
      assert.false(
        stillBlocked.settled,
        'one release leaves the gate at its limit',
      );
      held!();
      let admitted = await settledWithin(interactive, 200);
      assert.true(admitted.settled, 'the second release admits the waiter');
      (admitted as { value: () => void }).value();
    });

    test('raising the limit admits queued waiters', async function (assert) {
      let gate = new SearchAdmissionGate(1);
      let held = await gate.admit(1000);
      let queued = gate.admit(1000);
      assert.strictEqual(gate.waiting, 1);
      gate.setLimit(2);
      let admitted = await settledWithin(queued, 200);
      assert.true(admitted.settled);
      assert.strictEqual(gate.inFlight, 2);
      held!();
      (admitted as { value: () => void }).value();
    });

    test('a non-finite or sub-1 limit is clamped to 1', function (assert) {
      assert.strictEqual(new SearchAdmissionGate(0).limit, 1);
      assert.strictEqual(new SearchAdmissionGate(NaN).limit, 1);
      assert.strictEqual(new SearchAdmissionGate(2.7).limit, 2);
    });
  });

  module('searchAdmission middleware', function (hooks) {
    // Held searches wait on one of these until the test lets them go.
    let holds: Array<() => void> = [];
    let onHeld: (() => void) | undefined;

    function buildApp() {
      let app = new Koa();
      let router = new Router();
      let search = async (ctxt: Koa.Context) => {
        if (ctxt.query.releaseEarly) {
          releaseSearchAdmission(ctxt);
        }
        if (typeof ctxt.query.realms === 'string') {
          attributeSearchRequest(ctxt, ctxt.query.realms.split(','));
        }
        if (ctxt.query.hold) {
          await new Promise<void>((resolve) => {
            holds.push(resolve);
            onHeld?.();
          });
        }
        ctxt.status = 200;
        ctxt.body = JSON.stringify({ data: [] });
      };
      router.post('/_federated-search', search);
      router.options('/_federated-search', async (ctxt) => {
        ctxt.status = 204;
      });
      router.post('/some-realm/_search', search);
      router.post('/some-realm/cards', search);
      // The production order: logging, CORS, then admission, so a shed
      // response is a CORS-readable one.
      app.use(httpLogging);
      app.use(cors({ origin: '*' }));
      app.use(searchAdmission);
      app.use(router.routes());
      return app.callback();
    }

    // A supertest request is lazy: nothing is sent until it is awaited.
    // `.then` starts it now, so a test can hold several requests in flight at
    // once before awaiting any of them.
    function send(
      app: ReturnType<typeof buildApp>,
      path: string,
      headers: Record<string, string> = {},
    ) {
      let request = supertest(app).post(path);
      for (let [name, value] of Object.entries(headers)) {
        request = request.set(name, value);
      }
      return request.send({}).then((response) => response);
    }

    // Starts a search that the handler will hold, and resolves once the
    // handler is actually holding it — so a following request is guaranteed to
    // find the slot taken.
    function holdSearch(
      app: ReturnType<typeof buildApp>,
      path = '/_federated-search',
      headers: Record<string, string> = {},
    ) {
      let held = new Promise<void>((resolve) => (onHeld = resolve));
      let separator = path.includes('?') ? '&' : '?';
      let response = send(app, `${path}${separator}hold=1`, headers);
      return { response, held };
    }

    hooks.beforeEach(function () {
      holds = [];
      onHeld = undefined;
      setSearchAdmissionForTests({ limit: 2, waitMs: 50 });
    });

    hooks.afterEach(async function () {
      for (let release of holds) {
        release();
      }
      holds = [];
      resetSearchAdmissionForTests();
    });

    async function fillGate(app: ReturnType<typeof buildApp>) {
      let first = holdSearch(app);
      await first.held;
      let second = holdSearch(app);
      await second.held;
      assert_inFlight(2);
      return [first.response, second.response];
    }

    function assert_inFlight(
      expected: number,
      message = `inFlight=${expected}`,
    ) {
      QUnit.assert.strictEqual(getSearchInFlight(), expected, message);
    }

    test('a search arriving above the ceiling is shed with 429 and Retry-After', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);
      let shedBefore = getSearchShedCount();

      let shed = await send(app, '/_federated-search');
      assert.strictEqual(shed.status, 429);
      assert.strictEqual(shed.headers['retry-after'], '1');
      assert.strictEqual(
        shed.headers['access-control-allow-origin'],
        '*',
        'a cross-origin client can read the shed',
      );
      assert.strictEqual(shed.body.errors[0].status, '429');
      assert.strictEqual(shed.body.errors[0].title, 'Too Many Requests');
      assert.strictEqual(getSearchShedCount(), shedBefore + 1);
      assert_inFlight(2);

      for (let release of holds) {
        release();
      }
      let responses = await Promise.all(held);
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
        'the held searches complete normally',
      );
      assert_inFlight(0);
    });

    test('a waiting search is admitted when a slot frees within the wait', async function (assert) {
      setSearchAdmissionForTests({ limit: 2, waitMs: 2000 });
      let app = buildApp();
      let held = await fillGate(app);

      let waiting = send(app, '/_federated-search');
      // Long enough for the request to reach the gate and queue, well short
      // of its wait.
      await wait(50);
      let stillWaiting = await settledWithin(waiting, 20);
      assert.false(stillWaiting.settled, 'queued behind the full gate');
      holds.shift()!();
      let response = await waiting;
      assert.strictEqual(response.status, 200, 'served, not shed');
      assert.strictEqual(getSearchShedCount(), 0);

      holds.shift()!();
      await Promise.all(held);
      assert_inFlight(0);
    });

    test('the per-realm _search endpoint is gated too', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);
      let shed = await send(app, '/some-realm/_search');
      assert.strictEqual(shed.status, 429);
      for (let release of holds) {
        release();
      }
      await Promise.all(held);
    });

    test('every spelling of a search path the router accepts is gated', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);
      for (let path of [
        '/_federated-search/',
        '/_FEDERATED-SEARCH',
        '/some-realm/_search/',
        '/some-realm/_SEARCH',
      ]) {
        let shed = await send(app, path);
        assert.strictEqual(shed.status, 429, `${path} is shed`);
      }
      for (let release of holds) {
        release();
      }
      await Promise.all(held);
      assert_inFlight(0);
    });

    test('a preflight to a search path is neither counted nor shed', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);
      let preflight = await supertest(app).options('/_federated-search');
      assert.strictEqual(preflight.status, 204);
      assert_inFlight(2);
      for (let release of holds) {
        release();
      }
      await Promise.all(held);
    });

    test('a handler can hand its slot back before its response ends', async function (assert) {
      setSearchAdmissionForTests({ limit: 2, waitMs: 2000 });
      let app = buildApp();
      let releasing = holdSearch(app, '/_federated-search?releaseEarly=1');
      await releasing.held;
      assert_inFlight(0, 'released while the response is still open');

      // The freed slot is real: with the gate full again, a waiter is blocked
      // by the two computing searches, not by the early-released one.
      let held = await fillGate(app);
      let waiting = send(app, '/_federated-search');
      await wait(50);
      let blocked = await settledWithin(waiting, 20);
      assert.false(blocked.settled, 'the gate is full');

      // Ending the early-released response hands back nothing more.
      holds.shift()!();
      await releasing.response;
      let stillBlocked = await settledWithin(waiting, 20);
      assert.false(stillBlocked.settled, 'no second release on finish');
      assert_inFlight(2);

      holds.shift()!();
      assert.strictEqual(
        (await waiting).status,
        200,
        'a computing search ending admits the waiter',
      );
      for (let release of holds) {
        release();
      }
      await Promise.all(held);
      assert_inFlight(0);
    });

    // The slot and the request are two counts. The slot bounds computations,
    // so a request served from another's computation hands it back early; the
    // request is what the link-shape policy reads, and it is still waiting on
    // that computation until its own response ends.
    test('a search that hands its slot back early is still a request in flight until its response ends', async function (assert) {
      let app = buildApp();
      let releasing = holdSearch(app, '/_federated-search?releaseEarly=1');
      await releasing.held;
      assert_inFlight(0, 'the slot is back');
      assert.strictEqual(
        getSearchRequestsInFlight(),
        1,
        'while the request goes on counting',
      );

      holds.shift()!();
      assert.strictEqual((await releasing.response).status, 200);
      assert.strictEqual(
        getSearchRequestsInFlight(),
        0,
        'and stops when its response ends',
      );
    });

    test('a shed search is never counted as a request', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);
      assert.strictEqual(getSearchRequestsInFlight(), 2);

      let shed = await send(app, '/_federated-search');
      assert.strictEqual(shed.status, 429);
      assert.strictEqual(
        getSearchRequestsInFlight(),
        2,
        'only the two admitted searches are in flight',
      );

      for (let release of holds) {
        release();
      }
      await Promise.all(held);
      assert.strictEqual(getSearchRequestsInFlight(), 0);
    });

    test('indexing traffic is counted as requests too', async function (assert) {
      let app = buildApp();
      let indexing = holdSearch(app, '/_federated-search', {
        'x-boxel-job-id': '42.7',
      });
      await indexing.held;
      assert.strictEqual(getSearchRequestsInFlight(), 1);
      holds.shift()!();
      await indexing.response;
      assert.strictEqual(getSearchRequestsInFlight(), 0);
    });

    // The gate counts a request before anything knows its realms; the handler
    // that learns them attributes it. From then until its response ends it
    // counts toward each realm it names, and toward no other.
    test('a search attributed to its realms counts toward them until its response ends', async function (assert) {
      let app = buildApp();
      let searching = holdSearch(
        app,
        `/_federated-search?realms=${REALM_A},${REALM_B}`,
      );
      await searching.held;
      assert.strictEqual(getRealmSearchRequestsInFlight(REALM_A), 1);
      assert.strictEqual(
        getRealmSearchRequestsInFlight(REALM_B),
        1,
        'in full toward each realm it names',
      );
      assert.strictEqual(
        getRealmSearchRequestsInFlight(REALM_C),
        0,
        'and not toward a realm it does not',
      );
      assert.strictEqual(
        getSearchRequestsInFlight(),
        1,
        'while the process counts it once',
      );

      holds.shift()!();
      assert.strictEqual((await searching.response).status, 200);
      assert.strictEqual(getRealmSearchRequestsInFlight(REALM_A), 0);
      assert.strictEqual(getRealmSearchRequestsInFlight(REALM_B), 0);
    });

    // A client that goes away mid-response never produces a `finish`, so the
    // request has to be counted out on `close` or the reading would ratchet
    // upward with every abandoned tab.
    test('a request whose connection is torn down stops counting', async function (assert) {
      let server: Server = createServer(buildApp());
      await new Promise<void>((resolve) => server.listen(0, resolve));
      try {
        let { port } = server.address() as AddressInfo;
        let held = new Promise<void>((resolve) => (onHeld = resolve));
        let client = httpRequest({
          port,
          method: 'POST',
          path: `/_federated-search?releaseEarly=1&hold=1&realms=${REALM_A}`,
        });
        client.on('error', () => {});
        client.end('{}');
        await held;
        assert.strictEqual(getSearchRequestsInFlight(), 1, 'counted');
        assert.strictEqual(
          getRealmSearchRequestsInFlight(REALM_A),
          1,
          'toward its realm too',
        );

        client.destroy();
        let deadline = Date.now() + 2000;
        while (getSearchRequestsInFlight() !== 0 && Date.now() < deadline) {
          await wait(10);
        }
        assert.strictEqual(
          getSearchRequestsInFlight(),
          0,
          'counted out when the connection closed, with the handler still holding',
        );
        assert.strictEqual(
          getRealmSearchRequestsInFlight(REALM_A),
          0,
          'and out of its realm with it',
        );
      } finally {
        for (let release of holds) {
          release();
        }
        holds = [];
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    // The close listener is what ends both counts, so a request that goes away
    // while it is still queued for a slot has to be kept from starting either
    // one when the slot finally comes; otherwise the count it starts after its
    // close would never be ended.
    test('a search whose client leaves while queued is counted in neither', async function (assert) {
      setSearchAdmissionForTests({ limit: 2, waitMs: 2000 });
      let server: Server = createServer(buildApp());
      await new Promise<void>((resolve) => server.listen(0, resolve));
      try {
        let { port } = server.address() as AddressInfo;
        let hold = (): Promise<void> => {
          let held = new Promise<void>((resolve) => (onHeld = resolve));
          let client = httpRequest({
            port,
            method: 'POST',
            path: '/_federated-search?hold=1',
          });
          client.on('error', () => {});
          client.end('{}');
          return held;
        };
        await hold();
        await hold();
        assert_inFlight(2);

        let queued = httpRequest({
          port,
          method: 'POST',
          path: '/_federated-search',
        });
        queued.on('error', () => {});
        queued.end('{}');
        // Long enough to reach the gate and queue, well short of its wait.
        await wait(100);
        queued.destroy();
        await wait(50);

        // Free a slot: the queued arrival is admitted into it, finds its
        // client gone, and must hand everything straight back.
        holds.shift()!();
        let deadline = Date.now() + 2000;
        while (getSearchInFlight() !== 1 && Date.now() < deadline) {
          await wait(10);
        }
        assert_inFlight(1, 'only the search still held keeps a slot');
        assert.strictEqual(
          getSearchRequestsInFlight(),
          1,
          'and only it is counted as a request',
        );
      } finally {
        for (let release of holds) {
          release();
        }
        holds = [];
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('a non-search request is not counted', async function (assert) {
      let app = buildApp();
      let { response, held } = holdSearch(app, '/some-realm/cards');
      await held;
      assert_inFlight(0);
      holds.shift()!();
      assert.strictEqual((await response).status, 200);
    });

    test('indexing traffic is admitted past a full gate', async function (assert) {
      let app = buildApp();
      let held = await fillGate(app);

      let byJobId = await send(app, '/_federated-search', {
        'x-boxel-job-id': '42.7',
      });
      assert.strictEqual(byJobId.status, 200, 'a job-stamped search runs');

      let duringPrerender = await send(app, '/_federated-search', {
        'x-boxel-during-prerender': '1',
      });
      assert.strictEqual(
        duringPrerender.status,
        200,
        'an in-render search runs',
      );
      assert.strictEqual(getSearchShedCount(), 0);
      assert_inFlight(2);

      for (let release of holds) {
        release();
      }
      await Promise.all(held);
      assert_inFlight(0);
    });

    test('indexing traffic counts toward the load interactive arrivals see', async function (assert) {
      let app = buildApp();
      // One interactive hold plus one indexing hold fills a gate of two.
      let first = holdSearch(app);
      await first.held;
      let indexing = holdSearch(app, '/_federated-search', {
        'x-boxel-job-id': '42.7',
      });
      await indexing.held;
      assert_inFlight(2);

      let shed = await send(app, '/_federated-search');
      assert.strictEqual(shed.status, 429, 'the gate is full');

      for (let release of holds) {
        release();
      }
      await Promise.all([first.response, indexing.response]);
      assert_inFlight(0);
    });
  });
});
