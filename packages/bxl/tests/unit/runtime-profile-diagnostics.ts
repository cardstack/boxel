import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { bxl, evaluateBxl, prepareBxlSafe } from '../../src/index.ts';
import { evaluateBxlBare } from '../../src/runtime-bare.ts';
import {
  currentRequestContext,
  withRequestContext,
} from '../../src/jqtools/evaluate/runtimeState.ts';

const preparedDef = prepareBxlSafe('def twice(x): x * 2; twice(3)');
ok(preparedDef.ok, 'the unrestricted prepare/evaluate surface accepts jq def');
if (preparedDef.ok) {
  strictEqual(preparedDef.value.evaluate({}).value, 6);
}

throws(
  () => bxl('def twice(x): x * 2; twice(3)'),
  /derive-def-banned:.*does not allow user-defined helpers/,
  'computeVia rejects def with an explicit derive-profile capability diagnostic',
);

throws(
  () => evaluateBxlBare('AND([true, true])', {}),
  /runtime-bare contains jq core only; AND\/1 is a spreadsheet formula.*@cardstack\/bxl\/runtime/,
  'runtime-bare points formula callers to the full runtime',
);

strictEqual(
  evaluateBxl('DAYS(DATE(2026, 4, 30), DATE(2026, 4, 22))', {}).value,
  8,
  'DATE and DAYS are supported despite the stale dialect inventory',
);

// A request context is scoped on a synchronous stack, so it is unwound before
// a deferred callback resumes or a lazy result is drained — an evaluation
// inside one would read whatever context is current by then, which under
// concurrent requests is another request's. Evaluation is synchronous
// throughout, so both shapes are refused rather than left as a silent
// cross-request read.
throws(
  () => withRequestContext({ params: { a: 1 } }, async () => 'later'),
  /scopes a request context synchronously.*returned a promise/s,
  'withRequestContext refuses a promise-returning callback',
);

throws(
  () =>
    withRequestContext({ params: { a: 1 } }, function* () {
      yield currentRequestContext();
    }),
  /scopes a request context synchronously.*returned a lazy iterator/s,
  'withRequestContext refuses a callback that returns a lazy iterator',
);

// A refused promise is abandoned, so nothing else will ever settle it. Its
// rejection has to be claimed here or it surfaces as an unhandled rejection
// that terminates the process — after the throw above has been caught, which
// makes the crash look unrelated to its cause.
let unhandled: unknown;
const recordUnhandled = (reason: unknown) => {
  unhandled = reason;
};
process.on('unhandledRejection', recordUnhandled);
throws(
  () =>
    withRequestContext({ params: { a: 1 } }, async () => {
      throw new Error('inner async failure');
    }),
  /returned a promise/,
);
await new Promise((resolve) => setTimeout(resolve, 10));
process.off('unhandledRejection', recordUnhandled);
strictEqual(
  unhandled,
  undefined,
  'the abandoned promise is claimed, so its rejection cannot kill the process',
);

// Iterability alone is not deferral: an array and a string are returned
// as-is, or every ordinary result would be refused.
deepStrictEqual(
  withRequestContext({ params: { a: 1 } }, () => [1, 2, 3]),
  [1, 2, 3],
  'an array result is not mistaken for a lazy iterator',
);

strictEqual(
  withRequestContext({ params: { a: 1 } }, () => 'now'),
  'now',
  'a synchronous callback returns its value',
);

// The scope pops even when the callback throws, so a failed evaluation leaves
// no context behind for the next one to read.
throws(() =>
  withRequestContext({ params: { a: 1 } }, () => {
    throw new Error('boom');
  }),
);
strictEqual(
  currentRequestContext(),
  undefined,
  'a throwing callback still unwinds the request-context scope',
);

console.log('BXL runtime profile diagnostics: all checks passed');
