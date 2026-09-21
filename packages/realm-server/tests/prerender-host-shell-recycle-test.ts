import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RenderVisitResponse } from '@cardstack/runtime-common';
import { isMissingExportMessage } from '@cardstack/runtime-common/package-shim-handler';
import {
  createDrainSubscriber,
  decideHostShellRecycle,
  raceAgainstDrain,
  shouldRerenderForStaleShell,
  stampGatewayFailure,
  stampHostShellTokens,
  stampStaleShellFailure,
} from '../prerender/prerender-app.ts';
import { parseHostShellGeneration } from '../prerender/prerender-constants.ts';
import { hostShellConvergenceState } from '../prerender/manager-app.ts';
import {
  awaitHostShellBeforeRender,
  hostShellGateTimeoutMs,
} from '@cardstack/runtime-common/worker';
import type {
  HostShellConvergence,
  Prerenderer,
} from '@cardstack/runtime-common';

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

  module('shouldRerenderForStaleShell', function () {
    // A pool on the current shell for the whole render, and one that is not.
    // Most cases below differ only in which of these they pass, because that
    // is the only thing the decision reads besides the error itself.
    const CURRENT = 'b778fe76';
    const OUTGOING = 'babf3612';
    const onCurrentShell = {
      warmedAtStart: CURRENT,
      warmedAtCompletion: CURRENT,
      reportedAtCompletion: CURRENT,
    };
    const poolBehind = {
      warmedAtStart: OUTGOING,
      warmedAtCompletion: OUTGOING,
      reportedAtCompletion: CURRENT,
    };

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

    test("the same error on a pool that is current is the card's own", function (assert) {
      assert.false(
        shouldRerenderForStaleShell({
          response: visitResponse(MISSING_EXPORT),
          ...onCurrentShell,
        }),
        'the bundle that rendered it is the one being served, so the failure describes the card',
      );
    });

    // The case a token-move test cannot express, and the one that poisons
    // rows: the token moved before this render began, so nothing moves under
    // it, while the recycle it triggered is still running or has failed. The
    // page is on the outgoing bundle for the whole render.
    test('a pool that never caught up is stale even though nothing moved', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: visitResponse(MISSING_EXPORT),
          ...poolBehind,
        }),
      );
    });

    test('a recycle landing mid-render leaves the render suspect', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: visitResponse(MISSING_EXPORT),
          warmedAtStart: OUTGOING,
          warmedAtCompletion: CURRENT,
          reportedAtCompletion: CURRENT,
        }),
        'the page it started on was the outgoing one, however current the pool is by the end',
      );
    });

    test('a token learned mid-render outruns the pool', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: visitResponse(MISSING_EXPORT),
          warmedAtStart: CURRENT,
          warmedAtCompletion: CURRENT,
          reportedAtCompletion: 'c0ffee00',
        }),
        'a newly reported token the pool has not been re-warmed against is a stale pool',
      );
    });

    test('a stale pool alone does not re-render', function (assert) {
      assert.false(
        shouldRerenderForStaleShell({
          response: visitResponse(),
          ...poolBehind,
        }),
        'a render on a stale pool that succeeded is left alone',
      );
      assert.false(
        shouldRerenderForStaleShell({
          response: visitResponse('Card is not found at http://example/x'),
          ...poolBehind,
        }),
        'only module resolution is suspect when the pool is behind',
      );
    });

    // The deploy shape this exists for: the train restarts prerender before the
    // realm server, so a server booting mid-train warms against the outgoing
    // bundle and the first token it hears is the new one. Until the recycle
    // that token triggers completes, the pool has not been re-warmed against
    // anything this server has heard — the same transition
    // `decideHostShellRecycle` treats as a definite change.
    test('a pool never re-warmed against a known token is stale', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: visitResponse(MISSING_EXPORT),
          warmedAtStart: undefined,
          warmedAtCompletion: undefined,
          reportedAtCompletion: CURRENT,
        }),
      );
    });

    test('a server that has heard no token at all is left alone', function (assert) {
      for (let warmed of [undefined, OUTGOING]) {
        assert.false(
          shouldRerenderForStaleShell({
            response: visitResponse(MISSING_EXPORT),
            warmedAtStart: warmed,
            warmedAtCompletion: warmed,
            reportedAtCompletion: undefined,
          }),
          `warmed=${warmed} with nothing reported says nothing about which bundle rendered`,
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
          shouldRerenderForStaleShell({
            response: {
              [key]: { error: { error: { message: MISSING_EXPORT } } },
            } as unknown as RenderVisitResponse,
            ...poolBehind,
          }),
          `${key}.error is checked`,
        );
        assert.false(
          shouldRerenderForStaleShell({
            response: {
              [key]: { error: { error: { message: 'Card is not found' } } },
            } as unknown as RenderVisitResponse,
            ...poolBehind,
          }),
          `${key} is still only suspect for module resolution`,
        );
      }
    });

    test('the error also counts when it made the page unusable', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: {
            pageUnusableError: { error: { message: MISSING_EXPORT } },
          } as unknown as RenderVisitResponse,
          ...poolBehind,
        }),
      );
    });

    // A render whose own failure is a timeout or a wedge can carry the module
    // error only in the console errors `RenderRunner` merges onto
    // `additionalErrors` — and the row is persisted with it either way.
    test('the error counts when it is only among the merged console errors', function (assert) {
      assert.true(
        shouldRerenderForStaleShell({
          response: {
            card: {
              error: {
                error: {
                  message: 'Render timed out after 30000ms',
                  additionalErrors: [{ message: MISSING_EXPORT }],
                },
              },
            },
          } as unknown as RenderVisitResponse,
          ...poolBehind,
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
    // Under `diagnostics`, because that is the only meta key
    // `flattenPrerenderMeta` carries onto the persisted row — a token stamped
    // beside it never reaches the row an operator inspects.
    test('records both tokens under diagnostics, beside the render breakdown', function (assert) {
      let response = {
        meta: { requestId: 'abc', diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'babf3612',
        atCompletion: 'b778fe76',
      });
      assert.deepEqual(response.meta, {
        requestId: 'abc',
        diagnostics: {
          renderMs: 12,
          hostShellHash: 'babf3612',
          hostShellHashAtCompletion: 'b778fe76',
        },
      } as unknown as typeof response.meta);
    });

    // The pool's tokens are the predicate's actual inputs, so a row without
    // them records the conclusion's context but not the conclusion's basis.
    test("records the pool's tokens too, so the verdict is checkable", function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
        warmedAtStart: 'babf3612',
        warmedAtCompletion: 'babf3612',
      });
      assert.deepEqual(response.meta, {
        diagnostics: {
          renderMs: 12,
          hostShellHash: 'b778fe76',
          hostShellHashAtCompletion: 'b778fe76',
          warmedHostShellHash: 'babf3612',
          warmedHostShellHashAtCompletion: 'babf3612',
        },
      } as unknown as typeof response.meta);
    });

    // The shape a reported-token-only row cannot express, and the reason these
    // fields exist: one steady reported token across the whole render, and a
    // pool that never reached it. Reading `hostShellHash*` alone, this is
    // indistinguishable from a render that was perfectly current.
    test('a steady reported token with a lagging pool is legible on the row', function (assert) {
      let response = { meta: {} } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
        warmedAtStart: 'babf3612',
        warmedAtCompletion: 'babf3612',
      });
      let d = (response.meta as any).diagnostics;
      assert.strictEqual(
        d.hostShellHash,
        d.hostShellHashAtCompletion,
        'nothing moved under the render',
      );
      assert.notStrictEqual(
        d.warmedHostShellHash,
        d.hostShellHash,
        'yet the pool was never on the shell being served',
      );
    });

    // The distinction a reader has to be able to make. Both of these describe
    // a pool that is not on the current shell, but only one of them is an
    // answer: `null` was sampled, absence was not. A reader that conflates
    // them suppresses a row for a genuinely broken card whenever it meets a
    // response from something that does not sample — a server predating these
    // fields, which a worker sees throughout a rolling deploy.
    test('a sampled-but-unwarmed pool stamps null, not absence', function (assert) {
      let response = { meta: {} } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
        warmedAtStart: null,
        warmedAtCompletion: null,
      });
      let d = (response.meta as any).diagnostics;
      assert.true(
        'warmedHostShellHash' in d,
        'the key is present, so a reader knows a verdict was reached',
      );
      assert.strictEqual(d.warmedHostShellHash, null);
      assert.strictEqual(d.warmedHostShellHashAtCompletion, null);
    });

    test('an unsampled pool stamps no warmed keys at all', function (assert) {
      let response = { meta: {} } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
      });
      let d = (response.meta as any).diagnostics;
      assert.false(
        'warmedHostShellHash' in d,
        'absent rather than null — there is no verdict to read',
      );
      assert.false('warmedHostShellHashAtCompletion' in d);
      assert.strictEqual(
        d.hostShellHash,
        'b778fe76',
        'the reported tokens are unaffected',
      );
    });

    test('a server that knows no token stamps nothing', function (assert) {
      let response = {
        meta: { requestId: 'abc' },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: undefined,
        atCompletion: undefined,
        warmedAtStart: undefined,
        warmedAtCompletion: undefined,
      });
      assert.deepEqual(
        response.meta,
        { requestId: 'abc' } as unknown as typeof response.meta,
        'no empty keys, and no diagnostics object invented',
      );
    });
  });

  module('the warmed generation a row is stamped with', function () {
    // The one value here a write site reads rather than an operator: it
    // becomes the row's `host_shell_generation`, so a repair pass selects on
    // it. Stamped from the start sample, which names the bundle the page was
    // running when the render began.
    test('rides beside the warmed token it orders', function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
        warmedAtStart: 'b778fe76',
        warmedAtCompletion: 'b778fe76',
        warmedGenerationAtStart: 7,
      });
      let d = (response.meta as any).diagnostics;
      assert.strictEqual(d.warmedHostShellGeneration, 7);
      assert.strictEqual(
        d.warmedHostShellHash,
        'b778fe76',
        'the token it orders is still on the row',
      );
    });

    // A realm server whose database could not answer reports the token alone,
    // and the two services deploy separately, so a render sees this state
    // throughout a rolling deploy. The row has to read as unknown, not as
    // generation zero — the repair predicate is `< current`, and a zero would
    // put every such row in the first repair that runs.
    test('is absent, not zero, when no number reached the render', function (assert) {
      let response = { meta: {} } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: 'b778fe76',
        atCompletion: 'b778fe76',
        warmedAtStart: 'b778fe76',
        warmedAtCompletion: 'b778fe76',
      });
      let d = (response.meta as any).diagnostics;
      assert.false('warmedHostShellGeneration' in d);
    });

    // Generation 0 is the seeded "no shell observed yet" value, and it is a
    // real answer rather than a missing one, so it has to survive the same
    // presence check the tokens get.
    test('survives being zero', function (assert) {
      let response = { meta: {} } as unknown as RenderVisitResponse;
      stampHostShellTokens(response, {
        atStart: undefined,
        atCompletion: undefined,
        warmedGenerationAtStart: 0,
      });
      assert.strictEqual(
        (response.meta as any).diagnostics.warmedHostShellGeneration,
        0,
        'a generation alone is enough to stamp — the early return must not swallow it',
      );
    });
  });

  module('parseHostShellGeneration', function () {
    test('accepts a non-negative integer, as text or as a number', function (assert) {
      assert.strictEqual(parseHostShellGeneration('7'), 7);
      assert.strictEqual(parseHostShellGeneration(7), 7);
      assert.strictEqual(parseHostShellGeneration('0'), 0);
    });

    // Every rejection below would otherwise be stamped onto a row and compared
    // against the current generation, where it orders nothing. Discarding
    // leaves the column null, which reads as unknown.
    test('rejects anything that would not order', function (assert) {
      assert.strictEqual(parseHostShellGeneration(undefined), undefined);
      assert.strictEqual(parseHostShellGeneration(null), undefined);
      assert.strictEqual(parseHostShellGeneration(''), undefined);
      assert.strictEqual(parseHostShellGeneration('nope'), undefined);
      assert.strictEqual(parseHostShellGeneration('1.5'), undefined);
      assert.strictEqual(parseHostShellGeneration(-1), undefined);
      assert.strictEqual(parseHostShellGeneration(Number.NaN), undefined);
      assert.strictEqual(parseHostShellGeneration(Infinity), undefined);
    });
  });

  // Whether every server that could take a render is running the shell the
  // realm server says it is serving. This is what the indexing gate waits on,
  // so each case below is a reason a render job either starts, holds, or stops
  // asking.
  module('hostShellConvergenceState', function () {
    let active = (warmedHostShellHash?: string | null) =>
      ({ status: 'active', warmedHostShellHash }) as const;

    test('every eligible server on the reported shell is convergence', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [active('aaa'), active('aaa')],
        }),
        'converged',
      );
    });

    test('one server still behind holds the whole fleet', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [active('aaa'), active('bbb')],
        }),
        'behind',
        'a render can land on either, so either being behind is the answer',
      );
    });

    // The distinction the heartbeat's three states carry. `null` is a server
    // saying it has warmed against nothing it has heard; absence is a server
    // that cannot say. Neither is a claim to be current, and reading either as
    // one would open the gate during the deploy it exists for.
    test('a server that has not said it is current is not current', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [active('aaa'), active(null)],
        }),
        'behind',
        'null is a sampled answer, and the answer is "behind"',
      );
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [active('aaa'), active(undefined)],
        }),
        'behind',
        'an older server that omits the field has made no claim',
      );
    });

    // A draining server takes no new work, so a render cannot land on it and
    // its shell cannot reach a row. Counting it would hold every gate for the
    // length of every prerender roll.
    test('a draining server is not counted', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [
            active('aaa'),
            { status: 'draining', warmedHostShellHash: 'bbb' },
          ],
        }),
        'converged',
      );
    });

    // The state that keeps the gate from becoming an outage of its own. A
    // manager holding no token has restarted since the last realm-server
    // report and cannot answer at all; a caller that read this as "behind"
    // would spend its whole bound on every job until the next report.
    test('no reported token is unknown, not behind', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: undefined,
          servers: [active('aaa')],
        }),
        'unknown',
      );
    });

    // Distinct from `unknown`: the manager can answer, and the answer is that
    // nothing here can take a render.
    test('a fleet with nothing able to render is behind, not unknown', function (assert) {
      assert.strictEqual(
        hostShellConvergenceState({ hostShellHash: 'aaa', servers: [] }),
        'behind',
        'an empty registry renders nothing, which is not the same as being ready',
      );
      assert.strictEqual(
        hostShellConvergenceState({
          hostShellHash: 'aaa',
          servers: [{ status: 'draining', warmedHostShellHash: 'aaa' }],
        }),
        'behind',
        'a fleet that is entirely draining has no server that can take a render',
      );
    });
  });

  // The gate a render job passes through before it starts. Every case here is
  // about when it declines to wait: waiting forever is the outage class this
  // is most at risk of introducing.
  module('awaitHostShellBeforeRender', function () {
    let stub = (
      convergence: HostShellConvergence | Error | undefined,
    ): { prerenderer: Prerenderer; calls: number } => {
      let state = { calls: 0 };
      let prerenderer = {
        prerenderModule: async () => {
          throw new Error('not used');
        },
        prerenderVisit: async () => {
          throw new Error('not used');
        },
        runCommand: async () => {
          throw new Error('not used');
        },
        ...(convergence === undefined
          ? {}
          : {
              awaitHostShellConvergence: async () => {
                state.calls++;
                if (convergence instanceof Error) {
                  throw convergence;
                }
                return convergence;
              },
            }),
      } as unknown as Prerenderer;
      return {
        prerenderer,
        get calls() {
          return state.calls;
        },
      };
    };
    let silent = { info: () => {}, warn: () => {} };

    test('a converged fleet lets the job start', async function (assert) {
      let s = stub({ converged: true, waitedMs: 0, outcome: 'converged' });
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 1000,
        log: silent,
      });
      assert.strictEqual(s.calls, 1, 'the fleet was asked');
    });

    // The expiry behaviour, which is the design rather than a fallback: a
    // stalled indexer is its own outage class, and proceeding is what would
    // happen with no gate at all.
    test('an expired bound returns rather than holding the job', async function (assert) {
      let warnings: string[] = [];
      let s = stub({ converged: false, waitedMs: 1234, outcome: 'timeout' });
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 1000,
        log: { info: () => {}, warn: (m: string) => warnings.push(m) },
      });
      assert.strictEqual(warnings.length, 1, 'giving up is never silent');
      assert.true(
        warnings[0].includes('1234ms'),
        `the duration is in the line; got: ${warnings[0]}`,
      );
      assert.true(
        warnings[0].includes('timeout'),
        `and so is the cause; got: ${warnings[0]}`,
      );
    });

    test('a zero bound disables the gate without asking anything', async function (assert) {
      let s = stub({ converged: false, waitedMs: 0, outcome: 'timeout' });
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 0,
        log: silent,
      });
      assert.strictEqual(s.calls, 0);
    });

    test('a prerenderer with no fleet to ask does not wait', async function (assert) {
      let s = stub(undefined);
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 1000,
        log: silent,
      });
      assert.strictEqual(
        s.calls,
        0,
        'the optional method is absent, so no gate',
      );
    });

    // The contract says it does not throw. A caller that trusted that and was
    // wrong would fail a render job over a diagnostic.
    test('a throwing fleet check does not fail the job', async function (assert) {
      let warnings: string[] = [];
      let s = stub(new Error('manager exploded'));
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'prerender_html',
        timeoutMs: 1000,
        log: { info: () => {}, warn: (m: string) => warnings.push(m) },
      });
      assert.strictEqual(warnings.length, 1);
      assert.true(warnings[0].includes('proceeding'));
    });

    test('a wait below the log floor is not narrated', async function (assert) {
      let infos: string[] = [];
      let s = stub({ converged: true, waitedMs: 12, outcome: 'converged' });
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 1000,
        log: { info: (m: string) => infos.push(m), warn: () => {} },
      });
      assert.strictEqual(
        infos.length,
        0,
        'the steady state is every job, and it stays quiet',
      );
    });

    test('a wait worth naming is narrated', async function (assert) {
      let infos: string[] = [];
      let s = stub({ converged: true, waitedMs: 30_000, outcome: 'converged' });
      await awaitHostShellBeforeRender({
        prerenderer: s.prerenderer,
        jobType: 'incremental-index',
        timeoutMs: 120_000,
        log: { info: (m: string) => infos.push(m), warn: () => {} },
      });
      assert.strictEqual(infos.length, 1);
      assert.true(infos[0].includes('30000ms'));
    });
  });

  module('hostShellGateTimeoutMs', function (hooks) {
    let saved: string | undefined;
    hooks.beforeEach(function () {
      saved = process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS;
    });
    hooks.afterEach(function () {
      if (saved === undefined) {
        delete process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS;
      } else {
        process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS = saved;
      }
    });

    test('defaults to a bound several times the measured convergence', function (assert) {
      delete process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS;
      assert.strictEqual(hostShellGateTimeoutMs(), 120_000);
    });

    test('zero is an off switch, not a malformed value', function (assert) {
      process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS = '0';
      assert.strictEqual(hostShellGateTimeoutMs(), 0);
    });

    // A malformed value must not read as zero, which would silently remove the
    // gate — the one outcome an operator setting this would not expect.
    test('a malformed value falls back to the default rather than to off', function (assert) {
      for (let bad of ['banana', '-5', '']) {
        process.env.INDEX_HOST_SHELL_GATE_TIMEOUT_MS = bad;
        assert.strictEqual(
          hostShellGateTimeoutMs(),
          120_000,
          `${JSON.stringify(bad)} falls back`,
        );
      }
    });
  });

  module('stampStaleShellFailure', function () {
    // The write site tests only for this field's presence, so its encoding is
    // the whole contract: absence has to mean "no verdict" rather than
    // "attributable", or a response from anything that does not stamp it would
    // read as a licence to withhold a row.
    test('names the rows it covers and leaves the rest of diagnostics alone', function (assert) {
      let response = {
        meta: { requestId: 'abc', diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampStaleShellFailure(response, ['instance']);
      assert.deepEqual(response.meta, {
        requestId: 'abc',
        diagnostics: { renderMs: 12, staleShellFailure: ['instance'] },
      } as unknown as typeof response.meta);
    });

    // A visit's rows fail independently, so a verdict that named the response
    // rather than the rows would let one row's stale failure withhold
    // another's genuine one. The write site tests membership, so an empty
    // verdict must not be written at all.
    test('an empty verdict stamps nothing', function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampStaleShellFailure(response, []);
      assert.false(
        'staleShellFailure' in ((response.meta as any).diagnostics ?? {}),
        'absent rather than an empty array a reader might mis-test',
      );
    });

    test('an unmarked response carries no verdict at all', function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      assert.false(
        'staleShellFailure' in ((response.meta as any).diagnostics ?? {}),
        'absent rather than false — a reader must require presence',
      );
    });
  });

  module('stampGatewayFailure', function () {
    // Same contract as the stale-shell stamp: the write site tests only for
    // this field's presence, so absence must mean "no verdict" rather than
    // "attributable", and the field carries the row types it covers because a
    // visit's rows fail independently.
    test('names the rows it covers and leaves the rest of diagnostics alone', function (assert) {
      let response = {
        meta: { requestId: 'abc', diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampGatewayFailure(response, ['instance']);
      assert.deepEqual(response.meta, {
        requestId: 'abc',
        diagnostics: { renderMs: 12, gatewayFailure: ['instance'] },
      } as unknown as typeof response.meta);
    });

    test('an empty verdict stamps nothing', function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      stampGatewayFailure(response, []);
      assert.false(
        'gatewayFailure' in ((response.meta as any).diagnostics ?? {}),
        'absent rather than an empty array a reader might mis-test',
      );
    });

    test('an unmarked response carries no verdict at all', function (assert) {
      let response = {
        meta: { diagnostics: { renderMs: 12 } },
      } as unknown as RenderVisitResponse;
      assert.false(
        'gatewayFailure' in ((response.meta as any).diagnostics ?? {}),
        'absent rather than false — a reader must require presence',
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
