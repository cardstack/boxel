import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  isOperationFailure,
  requestDefinitionLookup,
  DEFINITION_RETRY_AFTER_SECONDS,
} from '@cardstack/runtime-common/card-operations';
import {
  systemInitiatedPriority,
  userInitiatedPriority,
  type Definition,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

// ============================================================================
// The definition lookup an operation reads through while a caller waits.
//
// A definition-cache miss renders the module on the prerenderer, and the page
// pool serves renders by priority. A realm re-indexing after a module push
// queues every card render at `systemInitiatedPriority`, and a lookup with no
// priority of its own enters at the pool's default of 0, below all of them.
// These pin that a request's lookup outranks that work, and that one which
// still cannot answer in time refuses with a retryable 503 rather than holding
// the request open.
// ============================================================================

const CODE_REF = {
  module: 'http://example.com/test/concept',
  name: 'Concept',
} as ResolvedCodeRef;
const DEFINITION = { type: 'card-def', codeRef: CODE_REF } as Definition;

function lookupAnswering(answer: () => Promise<Definition>) {
  let priorities: (number | undefined)[] = [];
  return {
    priorities,
    lookup: {
      async lookupDefinition(
        _codeRef: ResolvedCodeRef,
        opts?: { priority?: number },
      ) {
        priorities.push(opts?.priority);
        return await answer();
      },
      async lookupDefinitionEntry(
        _codeRef: ResolvedCodeRef,
        opts?: { priority?: number },
      ) {
        priorities.push(opts?.priority);
        return {
          type: 'definition' as const,
          moduleURL: CODE_REF.module,
          definition: await answer(),
          types: [],
        };
      },
    },
  };
}

module(basename(import.meta.filename), function () {
  module('request definition lookup', function () {
    test('a lookup renders at user priority, above background re-index work', async function (assert) {
      let { lookup, priorities } = lookupAnswering(async () => DEFINITION);
      let requests = requestDefinitionLookup(lookup);

      assert.strictEqual(await requests.lookupDefinition(CODE_REF), DEFINITION);
      await requests.lookupDefinitionEntry(CODE_REF);

      assert.deepEqual(priorities, [
        userInitiatedPriority,
        userInitiatedPriority,
      ]);
      assert.true(
        userInitiatedPriority > systemInitiatedPriority,
        'which outranks the priority a re-index renders cards at',
      );
    });

    test('a lookup that cannot answer in time refuses with a retryable 503', async function (assert) {
      let { lookup } = lookupAnswering(() => new Promise(() => {}));
      let requests = requestDefinitionLookup(lookup, { deadlineMs: 20 });

      let started = Date.now();
      try {
        await requests.lookupDefinition(CODE_REF);
        assert.ok(false, 'expected the lookup to be refused');
      } catch (err: unknown) {
        assert.true(isOperationFailure(err), 'an operation refusal');
        if (isOperationFailure(err)) {
          assert.strictEqual(err.error.status, 503);
          assert.strictEqual(err.error.code, 'target-not-indexed');
          assert.deepEqual(err.error.meta, {
            awaitingIndex: true,
            retryAfterSeconds: DEFINITION_RETRY_AFTER_SECONDS,
          });
        }
      }
      assert.true(Date.now() - started < 5_000, 'at the deadline, not later');
    });

    test('a lookup that fails after its deadline does not surface again', async function (assert) {
      let fail!: (err: Error) => void;
      let { lookup } = lookupAnswering(
        () => new Promise((_resolve, reject) => (fail = reject)),
      );
      let requests = requestDefinitionLookup(lookup, { deadlineMs: 10 });
      let unhandled: unknown[] = [];
      let onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        await requests.lookupDefinition(CODE_REF).catch(() => {});
        fail(new Error('render failed'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(unhandled, [], 'no unhandled rejection');
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    test('a lookup error inside the deadline reaches the caller as it was', async function (assert) {
      let { lookup } = lookupAnswering(async () => {
        throw new Error('module has an error');
      });
      let requests = requestDefinitionLookup(lookup);
      await assert.rejects(
        requests.lookupDefinition(CODE_REF),
        /module has an error/,
      );
    });
  });
});
