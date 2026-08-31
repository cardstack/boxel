import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RenderVisitResponse } from '@cardstack/runtime-common';
import { isMissingExportMessage } from '@cardstack/runtime-common/package-shim-handler';
import {
  createDrainSubscriber,
  decideHostShellRecycle,
  raceAgainstDrain,
  shouldRerenderForShellChange,
  stampHostShellTokens,
} from '../prerender/prerender-app.ts';

// Unit tests for the host-shell recycle decision a prerender server makes on
// every heartbeat: the manager echoes the current host-shell token, and the
// server recycles its browser for any token that isn't the one it warmed
// against — including the first token it ever sees, since a server that boots
// mid-deploy has warmed against the outgoing host bundle. See
// PRERENDER_HOST_SHELL_HASH_HEADER.
module(basename(import.meta.filename), function () {
  module('decideHostShellRecycle', function () {
    test('no token reported yet → no recycle, baseline unchanged', function (assert) {
      assert.deepEqual(decideHostShellRecycle(null, undefined), {
        recycle: false,
        nextWarmed: undefined,
      });
      assert.deepEqual(decideHostShellRecycle(null, 'aaa'), {
        recycle: false,
        nextWarmed: 'aaa',
      });
    });

    // The regression this guards is the one that disarms the whole mechanism.
    // A prerender server has no record of which host shell its pages loaded,
    // and the deploy train restarts it before the realm server it loads that
    // shell from — so on the first token it sees, "I warmed against something
    // else" is the assumption that keeps stale pages out of the pool. Silently
    // adopting the token as a baseline instead leaves a server rendering new
    // realm source against an old bundle until ordinary pool churn replaces
    // the tab.
    test('first token seen → recycle, since the warm predates knowing the token', function (assert) {
      assert.deepEqual(decideHostShellRecycle('aaa', undefined), {
        recycle: true,
        nextWarmed: 'aaa',
      });
    });

    test('token matches baseline → no-op', function (assert) {
      assert.deepEqual(decideHostShellRecycle('aaa', 'aaa'), {
        recycle: false,
        nextWarmed: 'aaa',
      });
    });

    test('token differs from baseline → recycle and advance baseline', function (assert) {
      assert.deepEqual(decideHostShellRecycle('bbb', 'aaa'), {
        recycle: true,
        nextWarmed: 'bbb',
      });
    });
  });

  module('shouldRerenderForShellChange', function () {
    // The message a page throws when it resolves current realm source against
    // a bundle that predates the export — the shape both production poisonings
    // took, minted in `package-shim-handler`.
    const MISSING_EXPORT =
      "Module 'https://packages/@cardstack/boxel-ui/components' has no " +
      "exported member 'MarkdownContentShell'. If this is a card, check the " +
      "import statement that names 'MarkdownContentShell'.";

    function visitResponse(message?: string): RenderVisitResponse {
      return (message === undefined
        ? { card: { isolatedHTML: '<div></div>' } }
        : {
            card: { error: { error: { message } } },
          }) as unknown as RenderVisitResponse;
    }

    test('a module error under a changed shell is re-rendered', function (assert) {
      assert.true(
        shouldRerenderForShellChange({
          response: visitResponse(MISSING_EXPORT),
          shellAtStart: 'babf3612',
          shellAtCompletion: 'b778fe76',
        }),
      );
    });

    test("the same error under a steady shell is the card's own", function (assert) {
      assert.false(
        shouldRerenderForShellChange({
          response: visitResponse(MISSING_EXPORT),
          shellAtStart: 'b778fe76',
          shellAtCompletion: 'b778fe76',
        }),
        'nothing moved under the render, so the failure describes the card',
      );
    });

    test('a changed shell alone does not re-render', function (assert) {
      assert.false(
        shouldRerenderForShellChange({
          response: visitResponse(),
          shellAtStart: 'babf3612',
          shellAtCompletion: 'b778fe76',
        }),
        'a render that straddled a deploy and succeeded is left alone',
      );
      assert.false(
        shouldRerenderForShellChange({
          response: visitResponse('Card is not found at http://example/x'),
          shellAtStart: 'babf3612',
          shellAtCompletion: 'b778fe76',
        }),
        'only module resolution is suspect when the bundle changes',
      );
    });

    test('an unknown token on either side is left alone', function (assert) {
      for (let [atStart, atCompletion] of [
        [undefined, 'b778fe76'],
        ['babf3612', undefined],
        [undefined, undefined],
      ] as [string | undefined, string | undefined][]) {
        assert.false(
          shouldRerenderForShellChange({
            response: visitResponse(MISSING_EXPORT),
            shellAtStart: atStart,
            shellAtCompletion: atCompletion,
          }),
          `(${atStart} -> ${atCompletion}) says nothing about which bundle rendered`,
        );
      }
    });

    // A FileDef render's failure is persisted on the same terms as a card's —
    // `prerender-html-visit` writes `fileRender.error` as a cached
    // `file-error` row — so leaving these sub-responses out would let Markdown
    // and friends stay poisoned by exactly the failure this recovers from.
    test('the error counts from any sub-response that gets persisted', function (assert) {
      for (let key of ['fileRender', 'fileExtract'] as const) {
        assert.true(
          shouldRerenderForShellChange({
            response: {
              [key]: { error: { error: { message: MISSING_EXPORT } } },
            } as unknown as RenderVisitResponse,
            shellAtStart: 'babf3612',
            shellAtCompletion: 'b778fe76',
          }),
          `${key}.error is checked`,
        );
        assert.false(
          shouldRerenderForShellChange({
            response: {
              [key]: { error: { error: { message: 'Card is not found' } } },
            } as unknown as RenderVisitResponse,
            shellAtStart: 'babf3612',
            shellAtCompletion: 'b778fe76',
          }),
          `${key} is still only suspect for module resolution`,
        );
      }
    });

    test('the error also counts when it made the page unusable', function (assert) {
      assert.true(
        shouldRerenderForShellChange({
          response: {
            pageUnusableError: { error: { message: MISSING_EXPORT } },
          } as unknown as RenderVisitResponse,
          shellAtStart: 'babf3612',
          shellAtCompletion: 'b778fe76',
        }),
      );
    });

    test('the message matcher tracks what the loader actually throws', function (assert) {
      assert.true(isMissingExportMessage(MISSING_EXPORT));
      assert.true(
        isMissingExportMessage(`ReferenceError: ${MISSING_EXPORT}`),
        'matches when the error was stringified with its class name',
      );
      assert.false(
        isMissingExportMessage('Module not found: @cardstack/boxel-ui'),
        'a missing module is a different failure from a missing export',
      );
    });
  });

  module('stampHostShellTokens', function () {
    test('records both tokens without disturbing the rest of meta', function (assert) {
      let response = {
        meta: { requestId: 'abc' },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'babf3612',
        atCompletion: 'b778fe76',
      });
      assert.deepEqual(response.meta, {
        requestId: 'abc',
        hostShellHash: 'babf3612',
        hostShellHashAtCompletion: 'b778fe76',
      });
    });

    test('a server that knows no token stamps nothing', function (assert) {
      let response = {
        meta: { requestId: 'abc' },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: undefined,
        atCompletion: undefined,
      });
      assert.deepEqual(
        response.meta,
        { requestId: 'abc' },
        'no empty keys added for what the server does not know',
      );
    });
  });

  module('raceAgainstDrain', function () {
    // Stands in for the server's drain subscription, counting how many are
    // outstanding. The count is the whole point: a subscription that survives
    // its request keeps the request's context, response and rendered HTML
    // reachable, so anything that leaves one behind grows the heap by a
    // render's worth per render.
    function fakeSubscriber() {
      let live = 0;
      let notifiers = new Set<() => void>();
      return {
        get live() {
          return live;
        },
        drain() {
          for (let notify of notifiers) {
            notify();
          }
        },
        subscribe: () => {
          live++;
          let notify!: () => void;
          let promise = new Promise<{ draining: true }>((resolve) => {
            notify = () => resolve({ draining: true });
          });
          notifiers.add(notify);
          return {
            promise,
            dispose: () => {
              live--;
              notifiers.delete(notify);
            },
          };
        },
      };
    }

    test('a completed render leaves no subscription behind', async function (assert) {
      let subscriber = fakeSubscriber();
      for (let i = 0; i < 50; i++) {
        let result = await raceAgainstDrain(
          Promise.resolve({ result: i }),
          subscriber.subscribe,
        );
        assert.deepEqual(result, { result: i }, `render ${i} returned`);
      }
      assert.strictEqual(
        subscriber.live,
        0,
        'no subscriptions outstanding after 50 renders',
      );
    });

    test('a failed render leaves no subscription behind', async function (assert) {
      let subscriber = fakeSubscriber();
      await assert.rejects(
        raceAgainstDrain(
          Promise.reject(new Error('boom')),
          subscriber.subscribe,
        ),
        /boom/,
        'the render error propagates',
      );
      assert.strictEqual(subscriber.live, 0, 'subscription released');
    });

    test('draining wins the race and still releases', async function (assert) {
      let subscriber = fakeSubscriber();
      let never = new Promise<{ result: string }>(() => {});
      let raced = raceAgainstDrain(never, subscriber.subscribe);
      subscriber.drain();
      assert.deepEqual(await raced, { draining: true }, 'reports draining');
      assert.strictEqual(subscriber.live, 0, 'subscription released');
    });

    test('with no subscriber it just awaits the render', async function (assert) {
      assert.deepEqual(
        await raceAgainstDrain(Promise.resolve({ result: 'ok' }), undefined),
        { result: 'ok' },
      );
    });
  });

  module('createDrainSubscriber', function () {
    function deferred() {
      let fulfil!: () => void;
      let promise = new Promise<void>((resolve) => {
        fulfil = resolve;
      });
      return { promise, fulfil };
    }

    test('a render started before draining runs to completion', async function (assert) {
      let drain = deferred();
      let subscribe = createDrainSubscriber(drain.promise);
      assert.deepEqual(
        await raceAgainstDrain(
          Promise.resolve({ result: 'rendered' }),
          subscribe,
        ),
        { result: 'rendered' },
      );
    });

    test('a render in flight when draining begins reports draining', async function (assert) {
      let drain = deferred();
      let subscribe = createDrainSubscriber(drain.promise);
      let raced = raceAgainstDrain(
        new Promise<{ result: string }>(() => {}),
        subscribe,
      );
      drain.fulfil();
      assert.deepEqual(await raced, { draining: true });
    });

    // The regression this guards: subscribing after the notification has
    // already gone out. A subscriber that only broadcast would hand back a
    // promise nobody ever settles, the race would decay into a plain await,
    // and the request would render on instead of reporting that the server is
    // leaving — holding shutdown open for the length of that render.
    test('a render arriving after draining reports draining rather than hanging', async function (assert) {
      let drain = deferred();
      let subscribe = createDrainSubscriber(drain.promise);
      drain.fulfil();
      await drain.promise;

      // Raced against a timer so the failure being guarded against — the
      // subscription never settling — reports as this assertion rather than
      // as a suite timeout.
      let result = await Promise.race([
        raceAgainstDrain(new Promise<{ result: string }>(() => {}), subscribe),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 250)),
      ]);
      assert.deepEqual(result, { draining: true }, 'settled rather than hung');
    });

    // The regression this PR exists to prevent, asserted against the shipping
    // subscriber rather than the stand-in above: a render that finishes must
    // leave nothing behind, because what it would leave behind holds that
    // render's output for the life of the process.
    test('a completed render leaves nothing on the subscriber', async function (assert) {
      let subscribe = createDrainSubscriber(new Promise<void>(() => {}));
      for (let i = 0; i < 50; i++) {
        await raceAgainstDrain(Promise.resolve({ result: i }), subscribe);
      }
      assert.strictEqual(subscribe.waiterCount(), 0, 'no waiters retained');
    });

    test('a failed render leaves nothing on the subscriber', async function (assert) {
      let subscribe = createDrainSubscriber(new Promise<void>(() => {}));
      await assert.rejects(
        raceAgainstDrain(Promise.reject(new Error('boom')), subscribe),
        /boom/,
      );
      assert.strictEqual(subscribe.waiterCount(), 0, 'no waiters retained');
    });

    test('a rejected shutdown signal still latches', async function (assert) {
      let rejected = Promise.reject(new Error('shutdown failed'));
      let subscribe = createDrainSubscriber(rejected);
      await rejected.catch(() => undefined);
      assert.deepEqual(
        await raceAgainstDrain(
          new Promise<{ result: string }>(() => {}),
          subscribe,
        ),
        { draining: true },
      );
    });

    test('every later render also reports draining', async function (assert) {
      let drain = deferred();
      let subscribe = createDrainSubscriber(drain.promise);
      drain.fulfil();
      await drain.promise;
      for (let i = 0; i < 3; i++) {
        assert.deepEqual(
          await raceAgainstDrain(
            new Promise<{ result: number }>(() => {}),
            subscribe,
          ),
          { draining: true },
          `render ${i}`,
        );
      }
    });
  });
});
