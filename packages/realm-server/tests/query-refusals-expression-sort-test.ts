import QUnit from 'qunit';
const { module } = QUnit;
import { basename } from 'path';

import { type Mistake, s, table } from './helpers/query-refusals.ts';

// What a malformed query is refused with, for expression sorts. See
// query-refusals-test.ts for how a row is read.

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  ...[3, null, '', '   ', ['price'], {}].map((v) => ({
    name: `expression: ${JSON.stringify(v)}`,
    query: s([{ expression: v }]),
    code: 'invalid-expression',
  })),
  {
    name: 'an expression with a text function',
    query: s([{ expression: 'LEN(name)' }]),
    code: 'expression-unsupported',
  },
  {
    name: 'an expression whose value can be text',
    query: s([{ expression: 'IF(price > 1, price, "")' }]),
    code: 'expression-unsupported',
  },
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a wrong kind of value', WRONG_KIND);
  });
});
