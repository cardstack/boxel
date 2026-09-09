import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import cors from '@koa/cors';
import {
  SearchAdmissionGate,
  getSearchInFlight,
  getSearchShedCount,
  resetSearchAdmissionForTests,
  setSearchAdmissionForTests,
} from '../search-inflight.ts';
import { httpLogging, searchAdmission } from '../middleware/index.ts';

// The admission gate is what stands between a burst of searches and a heap
// exhausted by their concurrent result sets. These tests pin the contract the
// middleware relies on — a hard ceiling, FIFO waiting for a bounded time, a
// cheap shed after it, unconditional admission for indexing traffic — and then
// the middleware's own behaviour over HTTP: which requests are gated, what a
// shed response looks like, and that a slot is handed back however the
// response ends.

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
      let response = send(app, `${path}?hold=1`, headers);
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

    function assert_inFlight(expected: number) {
      QUnit.assert.strictEqual(
        getSearchInFlight(),
        expected,
        `inFlight=${expected}`,
      );
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
