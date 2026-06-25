import {
  CardError,
  coerceErrorMessage,
  stringifyErrorForLog,
} from '../error.ts';
import type { SharedTests } from '../helpers/index.ts';

const PLACEHOLDER = 'placeholder fallback message';

const tests = Object.freeze({
  'returns the existing non-empty message': async (assert) => {
    assert.strictEqual(
      coerceErrorMessage({ message: 'render failed' }, PLACEHOLDER),
      'render failed',
    );
  },

  'falls back to title when message is missing': async (assert) => {
    assert.strictEqual(
      coerceErrorMessage(
        { message: undefined, title: 'Internal Server Error' },
        PLACEHOLDER,
      ),
      'Internal Server Error',
    );
  },

  'falls back to title when message is empty string': async (assert) => {
    assert.strictEqual(
      coerceErrorMessage({ message: '', title: 'Bad Request' }, PLACEHOLDER),
      'Bad Request',
    );
  },

  'falls back to first stack line when message and title are missing': async (
    assert,
  ) => {
    assert.strictEqual(
      coerceErrorMessage(
        {
          message: undefined,
          stack:
            'TypeError: Cannot read properties of undefined\n    at foo (bar.ts:1:2)',
        },
        PLACEHOLDER,
      ),
      'TypeError: Cannot read properties of undefined',
    );
  },

  'returns the placeholder for an empty object': async (assert) => {
    assert.strictEqual(coerceErrorMessage({}, PLACEHOLDER), PLACEHOLDER);
  },

  'returns the placeholder for undefined': async (assert) => {
    assert.strictEqual(coerceErrorMessage(undefined, PLACEHOLDER), PLACEHOLDER);
  },

  'returns the placeholder for null': async (assert) => {
    assert.strictEqual(coerceErrorMessage(null, PLACEHOLDER), PLACEHOLDER);
  },

  'coerces a non-empty string thrown value': async (assert) => {
    assert.strictEqual(
      coerceErrorMessage('Something went wrong', PLACEHOLDER),
      'Something went wrong',
    );
  },

  'ignores whitespace-only message in favor of title': async (assert) => {
    assert.strictEqual(
      coerceErrorMessage({ message: '   ', title: 'Bad Gateway' }, PLACEHOLDER),
      'Bad Gateway',
    );
  },

  'preserves the message on a real CardError': async (assert) => {
    let err = new CardError('the underlying render error', { status: 500 });
    assert.strictEqual(
      coerceErrorMessage(err, PLACEHOLDER),
      'the underlying render error',
    );
  },

  // Reproduces the production scenario behind CS-11185: an
  // upstream entry-construction site (host window-error-handler or
  // render route) hands the indexer a serialized error whose
  // `message` is the JS value `undefined` (often because the host
  // built `{ message: reason.message }` for a non-Error thrown
  // value and JSON.stringify dropped the undefined key). The
  // indexer's index-writer guard would have rejected the upsert and
  // failed the whole from-scratch reindex job; the chokepoint
  // helper must now produce a usable placeholder string instead.
  'guarantees non-empty for the CS-11185 production shape': async (assert) => {
    let entry = { status: 500, additionalErrors: null };
    let result = coerceErrorMessage(entry, PLACEHOLDER);
    assert.ok(
      typeof result === 'string' && result.length > 0,
      'result is a non-empty string',
    );
    assert.strictEqual(result, PLACEHOLDER);
  },

  // Object with a custom toString() — codex review feedback: prefer
  // the real text the wrapper exposes over a generic placeholder.
  'prefers custom toString() output over placeholder': async (assert) => {
    let err = {
      toString() {
        return 'wrapper-specific failure text';
      },
    };
    assert.strictEqual(
      coerceErrorMessage(err, PLACEHOLDER),
      'wrapper-specific failure text',
    );
  },

  // Plain object's default String(err) is "[object Object]" — that's
  // less informative than the placeholder (which names the URL), so
  // it must NOT win. Same for the Object.prototype output of
  // objects with a tagged toStringTag.
  'skips the default "[object Object]" output': async (assert) => {
    assert.strictEqual(coerceErrorMessage({}, PLACEHOLDER), PLACEHOLDER);
    let tagged = { [Symbol.toStringTag]: 'TaggedError' };
    assert.strictEqual(coerceErrorMessage(tagged, PLACEHOLDER), PLACEHOLDER);
  },

  'stringifyErrorForLog returns the stack for an Error': async (assert) => {
    let err = new Error('boom');
    let out = stringifyErrorForLog(err);
    assert.true(out.includes('boom'), 'includes the message');
    assert.true(out.includes('Error'), 'includes the error name');
  },

  'stringifyErrorForLog falls back to name+message when an Error has no stack':
    async (assert) => {
      let err = new Error('no stack here');
      delete (err as { stack?: unknown }).stack;
      assert.strictEqual(stringifyErrorForLog(err), 'Error: no stack here');
    },

  'stringifyErrorForLog JSON-dumps a plain / JSON:API error object': async (
    assert,
  ) => {
    assert.strictEqual(
      stringifyErrorForLog({ status: 500, title: 'Internal Server Error' }),
      '{"status":500,"title":"Internal Server Error"}',
    );
  },

  'stringifyErrorForLog returns a string error unchanged': async (assert) => {
    assert.strictEqual(stringifyErrorForLog('plain message'), 'plain message');
  },

  'stringifyErrorForLog falls back to a placeholder for null': async (
    assert,
  ) => {
    assert.strictEqual(
      stringifyErrorForLog(null),
      '(no error detail available)',
    );
  },
} as SharedTests<{}>);

export default tests;
