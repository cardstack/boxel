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
  runBxlTransform,
  type BxlTransformContext,
} from '../../src/transform.ts';

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

const cases: Case[] = [
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
    name: 'a realm setting is refused by the profile, not at evaluation',
    run: () => {
      let error = caught(() => runBxlTransform('{r: realmConfig("x")}', null));
      strictEqual(error.phase, 'profile');
      ok(
        error.message.includes('transform-call-banned'),
        `the refusal names the profile finding: ${error.message}`,
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
