// The `transform` profile and its runner: what an operation's `input` and
// `output` stages may do, what they may not, and how a refusal is spelled.
//
// Every case runs the real entry point rather than the profile tables, so a
// call that is classified one way and evaluated another shows up here.

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import type { BxlTransformError } from '../../src/transform.ts';
import {
  checkBxlTransform,
  isBxlTransformError,
  prepareBxlTransform,
  runBxlTransform,
  type BxlTransformContext,
} from '../../src/transform.ts';
import {
  NativeJqDialectError,
  prepareNativeJq,
} from '../../src/bxl/bridge/native.ts';
import { requestContextBuiltinLibraries } from '../../src/bxl/registry/index.ts';
import { withRequestContext } from '../../src/jqtools/evaluate/runtimeState.ts';

interface Case {
  name: string;
  run: () => void;
}

function caught(body: () => unknown): BxlTransformError {
  try {
    body();
  } catch (error) {
    ok(isBxlTransformError(error), `expected a transform error, got ${error}`);
    return error as BxlTransformError;
  }
  throw new Error('expected the program to be refused, and it was not');
}

const ACTOR = '@someone:example.com';
const CONTEXT: BxlTransformContext = {
  actor: ACTOR,
  params: { body: 'a comment', status: undefined as unknown as string },
  instance: { title: 'Q3 report', status: 'open' },
};

// What a run answered, or the phase and message it was refused with, so a
// prepared program and a one-shot run can be compared value for value.
function outcome(body: () => unknown): unknown {
  try {
    return { value: body() };
  } catch (error) {
    ok(isBxlTransformError(error), `expected a transform error, got ${error}`);
    return { phase: error.phase, message: error.message };
  }
}

// A policy predicate's shape: it reads the caller, the stored card and the
// realm's settings, and throws on a card whose `owners` cannot be searched.
const PREDICATE =
  '(.owners | index(actor())) != null or .status == realmConfig().openStatus or instance("public") == true';

const ACTOR_MISSING =
  "actor() needs the caller identity, which the host did not supply in this request's context.";

const PREDICATE_RUNS: {
  input: unknown;
  context: BxlTransformContext;
  expected: unknown;
}[] = [
  {
    input: { owners: [ACTOR], status: 'closed' },
    context: { actor: ACTOR, instance: { public: false }, realmConfig: {} },
    expected: { value: true },
  },
  {
    input: { owners: ['@other:example.com'], status: 'closed' },
    context: { actor: ACTOR, instance: { public: false }, realmConfig: {} },
    expected: { value: false },
  },
  {
    input: { owners: [], status: 'open' },
    context: {
      actor: ACTOR,
      instance: { public: false },
      realmConfig: { openStatus: 'open' },
    },
    expected: { value: true },
  },
  {
    input: { owners: [], status: 'closed' },
    context: { actor: ACTOR, instance: { public: true }, realmConfig: {} },
    expected: { value: true },
  },
  {
    input: { owners: 42, status: 'closed' },
    context: { actor: ACTOR, instance: { public: false }, realmConfig: {} },
    expected: {
      phase: 'evaluate',
      message: 'Cannot index number with string',
    },
  },
  {
    input: { owners: [ACTOR], status: 'closed' },
    context: { instance: { public: false }, realmConfig: {} },
    expected: { phase: 'evaluate', message: ACTOR_MISSING },
  },
];

function isNativeJqDialectError(error: unknown): error is NativeJqDialectError {
  return error instanceof NativeJqDialectError;
}

// Freezes every object reachable from `value`, so a later write to any of
// them throws (these modules are strict mode).
function deepFreeze(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (let key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  Object.freeze(value);
}

const cases: Case[] = [
  {
    name: 'a prepared program answers each run as a one-shot run of the same source does',
    run: () => {
      let prepared = prepareBxlTransform(PREDICATE, { syntax: 'readable' });
      let expected = PREDICATE_RUNS.map((entry) => entry.expected);
      deepStrictEqual(
        PREDICATE_RUNS.map(({ input, context }) =>
          outcome(() =>
            runBxlTransform(PREDICATE, input, context, { syntax: 'readable' }),
          ),
        ),
        expected,
      );
      deepStrictEqual(
        PREDICATE_RUNS.map(({ input, context }) =>
          outcome(() => prepared.run(input, context)),
        ),
        expected,
      );
      // The same program run again, in the opposite order, gives each value
      // the same answer.
      deepStrictEqual(
        [...PREDICATE_RUNS]
          .reverse()
          .map(({ input, context }) =>
            outcome(() => prepared.run(input, context)),
          ),
        [...expected].reverse(),
      );
    },
  },
  {
    name: 'evaluation never writes to a prepared program',
    run: () => {
      // Annotated for the evaluator when it is prepared, then frozen: any
      // write a run makes to the tree throws rather than carrying over into
      // the next run.
      let prepared = prepareNativeJq(PREDICATE, {
        readableSyntax: true,
        libraries: requestContextBuiltinLibraries(),
      });
      deepFreeze(prepared.ast);
      // The runner wraps whatever a run throws, a write to a frozen node
      // included, so each refusal is compared by its message.
      let nativeOutcome = (body: () => unknown[]) => {
        try {
          let outputs = body();
          return { value: outputs[0] };
        } catch (error) {
          ok(isNativeJqDialectError(error), `unexpected ${error}`);
          return { phase: error.phase, message: error.message };
        }
      };
      for (let pass = 0; pass < 2; pass++) {
        deepStrictEqual(
          PREDICATE_RUNS.map(({ input, context }) =>
            nativeOutcome(() =>
              withRequestContext(context, () => prepared.run(input).outputs),
            ),
          ),
          PREDICATE_RUNS.map(({ expected }) => expected),
        );
      }
    },
  },
  {
    name: 'a prepared program refuses several values, or none',
    run: () => {
      let prepared = prepareBxlTransform('.[]');
      deepStrictEqual(
        [[1], [1, 2], []].map((input) => outcome(() => prepared.run(input))),
        [
          { value: 1 },
          {
            phase: 'evaluate',
            message:
              'a transform produces one value, and this program produced 2',
          },
          {
            phase: 'evaluate',
            message:
              'a transform produces one value, and this program produced 0',
          },
        ],
      );
    },
  },
  {
    name: 'preparing refuses a program that does not parse or leaves the profile',
    run: () => {
      let parse = caught(() => prepareBxlTransform('{'));
      strictEqual(parse.phase, 'parse');
      ok(parse.message.startsWith('Expected punctuation'), parse.message);
      let assignment = caught(() => prepareBxlTransform('.a = 1'));
      strictEqual(assignment.phase, 'profile');
      ok(
        assignment.message.startsWith('transform-assignment-banned:'),
        assignment.message,
      );
      let call = caught(() => prepareBxlTransform('input'));
      strictEqual(call.phase, 'profile');
      ok(call.message.startsWith('transform-call-banned:'), call.message);
    },
  },
  {
    name: 'a prepared program keeps the runtime budget it was prepared with',
    run: () => {
      let prepared = prepareBxlTransform('[range(1000000)] | length', {
        runtimeLimits: { maxSteps: 50 },
      });
      strictEqual(caught(() => prepared.run(null)).phase, 'evaluate');
    },
  },
  {
    name: 'a projection keeps the keys it names and drops the rest',
    run: () => {
      deepStrictEqual(
        runBxlTransform(
          '{data: {type: .data.type, id: .data.id, attributes: {title: .data.attributes.title}}}',
          {
            data: {
              type: 'card',
              id: 'http://example.com/reports/1',
              attributes: { title: 'Q3 report', salary: 120_000 },
            },
          },
        ),
        {
          data: {
            type: 'card',
            id: 'http://example.com/reports/1',
            attributes: { title: 'Q3 report' },
          },
        },
      );
    },
  },
  {
    name: 'an input fills a default the caller left out',
    run: () => {
      deepStrictEqual(
        runBxlTransform('. + {status: (.status // "open")}', {
          body: 'a comment',
        }),
        { body: 'a comment', status: 'open' },
      );
    },
  },
  {
    name: 'the caller, the payload and the stored document are all readable',
    run: () => {
      deepStrictEqual(
        runBxlTransform(
          '{who: actor(), what: params("body"), on: instance("title")}',
          null,
          CONTEXT,
        ),
        { who: ACTOR, what: 'a comment', on: 'Q3 report' },
      );
    },
  },
  {
    name: 'a program that reads the caller with no caller supplied is refused',
    run: () => {
      let error = caught(() => runBxlTransform('{who: actor()}', null, {}));
      strictEqual(error.phase, 'evaluate');
      ok(
        error.message.includes('actor()'),
        `the refusal names the call: ${error.message}`,
      );
    },
  },
  {
    name: 'a realm setting is readable where the host supplies one',
    run: () => {
      deepStrictEqual(
        runBxlTransform('{at: realmConfig("timezone")}', null, {
          realmConfig: { timezone: 'UTC' },
        }),
        { at: 'UTC' },
      );
    },
  },
  {
    name: 'a realm setting the host did not supply is refused at evaluation',
    run: () => {
      let error = caught(() =>
        runBxlTransform('{at: realmConfig("timezone")}', null),
      );
      strictEqual(error.phase, 'evaluate');
      ok(
        error.message.includes('realmConfig(key)'),
        `the refusal names the call: ${error.message}`,
      );
    },
  },
  {
    name: 'a volatile call is allowed — a transform is not stored or replayed',
    run: () => {
      let now = runBxlTransform('{at: NOW()}', null) as { at: unknown };
      ok(now.at != null, 'NOW() produced a value');
    },
  },
  {
    name: 'an assignment is refused: a transform shapes a value, it writes none',
    run: () => {
      strictEqual(caught(() => runBxlTransform('.a = 1', {})).phase, 'profile');
    },
  },
  {
    name: 'try/catch, loops, helpers and recursive descent are all refused',
    run: () => {
      for (let source of [
        'try .a catch "x"',
        'reduce .[] as $i (0; . + $i)',
        'def f: .; f',
        '.. | numbers',
      ]) {
        strictEqual(
          caught(() => runBxlTransform(source, [])).phase,
          'profile',
          `refused: ${source}`,
        );
      }
    },
  },
  {
    name: 'a side-effecting call is refused',
    run: () => {
      strictEqual(caught(() => runBxlTransform('env', null)).phase, 'profile');
    },
  },
  {
    name: 'a program that does not parse is refused at the parse phase',
    run: () => {
      strictEqual(caught(() => runBxlTransform('{', null)).phase, 'parse');
    },
  },
  {
    name: 'a program that yields more than one value is refused',
    run: () => {
      let error = caught(() => runBxlTransform('.[]', [1, 2]));
      strictEqual(error.phase, 'evaluate');
      ok(
        error.message.includes('produced 2'),
        `the refusal counts the values: ${error.message}`,
      );
    },
  },
  {
    name: 'a program that yields no value is refused rather than yielding null',
    run: () => {
      strictEqual(caught(() => runBxlTransform('.[]', [])).phase, 'evaluate');
    },
  },
  {
    name: 'the one way to write a zero-output program is refused by the profile',
    run: () => {
      // `empty` is the deliberate spelling of "yield nothing", so it is
      // refused where it is written; a filter that happens to match nothing is
      // what the runtime check above is left holding.
      for (let source of ['empty', 'if .a then empty else . end']) {
        strictEqual(
          caught(() => runBxlTransform(source, { a: true })).phase,
          'profile',
          `refused: ${source}`,
        );
      }
      ok(
        checkBxlTransform('empty')[0]?.startsWith('transform-call-banned'),
        'and the check reports it without running the program',
      );
    },
  },
  {
    name: 'checking a program reports the profile findings without running it',
    run: () => {
      deepStrictEqual(checkBxlTransform('.a'), []);
      ok(
        checkBxlTransform('.a = 1')[0]?.startsWith(
          'transform-assignment-banned',
        ),
        'an assignment is reported by the check',
      );
      strictEqual(
        checkBxlTransform('{').length,
        1,
        'a parse error is reported',
      );
    },
  },
  {
    name: 'the runtime budget bounds a transform',
    run: () => {
      let error = caught(() =>
        runBxlTransform(
          '[range(1000000)] | length',
          null,
          {},
          {
            runtimeLimits: { maxSteps: 50 },
          },
        ),
      );
      strictEqual(error.phase, 'evaluate');
    },
  },
];

let failures = 0;
for (let testCase of cases) {
  try {
    testCase.run();
  } catch (error) {
    failures++;
    console.error(`FAIL ${testCase.name}`);
    console.error(`  ${error}`);
  }
}

if (failures > 0) {
  throw new Error(
    `BXL transform profile: ${failures} of ${cases.length} failed`,
  );
}

console.log(`BXL transform profile: ${cases.length} cases passed`);
