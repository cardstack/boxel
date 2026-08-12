import { deepStrictEqual, strictEqual, ok } from 'node:assert';
import {
  bxlToJqExpression,
  evaluateBxl,
  lintBxlExpression,
  solidifyBxlExpression,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'email', label: 'Email' },
    { key: 'name', label: 'Name' },
    { key: 'value', label: 'Value' },
  ],
};

function jq(source: string): string {
  return bxlToJqExpression(source, { schema }).source;
}

function solid(source: string): string {
  return solidifyBxlExpression(source, { schema }).source;
}

function value(source: string, input: unknown = {}) {
  return evaluateBxl(source, input, { schema }).value;
}

strictEqual(
  jq('Email | match("\\d+")'),
  '.email | match("\\\\d+")',
  'match/1 keeps jq regex semantics',
);
strictEqual(
  jq('Email | match("\\d+"; "i")'),
  '.email | match("\\\\d+"; "i")',
  'match/2 with semicolon keeps jq regex semantics',
);
strictEqual(
  jq('MATCH("b", ["a", "b"], 0)'),
  'MATCH("b"; ["a", "b"]; 0)',
  'MATCH/3 keeps Excel lookup semantics',
);
strictEqual(value('MATCH("b", ["a", "b"], 0)'), 2);
strictEqual(value('"abc123" | match("\\d+").string'), '123');

strictEqual(value('["a", "b"] | index("b")'), 1);
strictEqual(value('INDEX(["a", "b"], 2)'), 'b');

strictEqual(value('"x" | type'), 'string');
strictEqual(value('TYPE("x")'), 2);

strictEqual(value('LOG(100)'), 2);
strictEqual(value('100 | log'), Math.log(100));

strictEqual(value('TRIM("  a   b  ")'), 'a b');
strictEqual(value('"  a   b  " | trim'), 'a   b');

const excelNow = value('now()');
const jqNow = value('NOW');
strictEqual(typeof excelNow, 'number');
strictEqual(typeof jqNow, 'number');
ok(
  (excelNow as number) > 40_000 && (excelNow as number) < 100_000,
  'now() dispatches to Excel NOW() serial shape',
);
ok(
  (jqNow as number) > 1_000_000_000,
  'bare NOW dispatches to jq epoch seconds shape',
);

strictEqual(value('ATAN2(1, 2)'), Math.atan2(2, 1));
strictEqual(value('atan2(1; 2)'), Math.atan2(1, 2));

strictEqual(
  solid('Email | match("\\d+"; "i")'),
  'Email | match("\\d+"; "i")',
  'solidify preserves jq semicolon calls',
);
strictEqual(
  solid('MATCH("b"; ["a", "b"])'),
  'match("b"; ["a", "b"])',
  'semicolon wins ambiguous MATCH/2 and solidify lowercases jq intent',
);
strictEqual(
  solid('match("b", ["a", "b"])'),
  'MATCH("b", ["a", "b"])',
  'comma wins ambiguous match/2 and solidify uppercases Excel intent',
);
strictEqual(
  solid('LOG(8; 2)'),
  'LOG(8, 2)',
  'Excel-only arity normalizes semicolon back to comma',
);
strictEqual(solid('NOW'), 'now');
strictEqual(solid('now()'), 'NOW()');
strictEqual(solid('ATAN2(1; 2)'), 'atan2(1; 2)');

deepStrictEqual(
  lintBxlExpression('NOW', { schema }).issues.map((issue) => issue.code),
  ['jq-name-lowercase-preferred'],
  'bare uppercase NOW lints as jq style',
);
ok(
  lintBxlExpression('match("b", ["a", "b"])', { schema }).issues.some(
    (issue) => issue.code === 'excel-name-uppercase-preferred',
  ),
  'lowercase comma match/2 lints as Excel style',
);
ok(
  lintBxlExpression('MATCH("\\d+"; "i")', { schema }).issues.some(
    (issue) => issue.code === 'jq-name-lowercase-preferred',
  ),
  'uppercase semicolon MATCH/2 lints as jq style',
);

console.log('BXL function dispatch hardening passed');
