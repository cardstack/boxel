import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  INHERITED_NAMES,
  type Mistake,
  type Q,
  T,
  type UnknownMember,
  acceptedTests,
  binding,
  f,
  kind,
  many,
  on,
  table,
  top,
  unknownMemberTests,
  usingA,
  viaAssert,
} from './helpers/query-refusals.ts';

// What a malformed query is refused with, for let bindings. See
// query-refusals-test.ts for how a row is read.

// ---- codes no test asserted -----------------------------------------------

const UNASSERTED_CODES: Mistake[] = [
  {
    // "$topp" names no binding, so it is text, and an `in` takes a list
    name: 'an `in` of a string that names no declared binding',
    query: top({
      let: { $top: binding },
      filter: { in: { kind: '$topp' } },
    }),
    code: 'invalid-value',
  },
  {
    name: 'a binding declared without its $',
    query: top({
      let: { anchor: { from: { type: T, filter: kind }, one: true } },
      filter: { range: { price: { lt: '$anchor.price' } } },
    }),
    code: 'invalid-value',
  },
  ...['$this', '$literal'].map((name) => ({
    name: `a binding named ${name}, which is reserved`,
    query: top({ let: { [name]: binding } }),
    code: 'invalid-value',
  })),
  {
    name: 'a binding read with the { $let } object',
    query: top({
      let: { $top: binding },
      filter: { in: { kind: { $let: 'top' } } },
    }),
    code: 'unknown-key',
  },
  {
    name: 'a one-card binding read with the { $let, path } object',
    query: top({
      let: { $it: { from: { type: T, filter: kind }, one: true } },
      filter: { eq: { kind: { $let: 'it', path: 'kind' } } },
    }),
    code: 'unknown-key',
  },
  ...[3, null, ['$a'], { text: 'x' }].map((v) => ({
    name: `a $literal of ${JSON.stringify(v)}`,
    query: f({ eq: { kind: { $literal: v } } }),
    code: 'invalid-value',
  })),
  {
    name: 'a $literal beside another member',
    query: f({ eq: { kind: { $literal: 'lamp', also: 1 } } }),
    code: 'invalid-value',
  },
];

// ---- a wrong kind of value, member by member ------------------------------

const WRONG_KIND: Mistake[] = [
  // linkedFrom
  ...[
    'x',
    null,
    3,
    {},
    { card: 'Wishlist/mine', field: 'items' },
    { card: '@scope', field: 'items' },
    { card: '$REALM/', field: 'items' },
    { card: 'http://a.test/Wishlist /mine', field: 'items' },
    { card: 3, field: 'items' },
    { card: 'http://a.test/Wishlist/mine' },
    { card: 'http://a.test/Wishlist/mine', field: 3 },
    { card: 'http://a.test/Wishlist/mine', field: 'a..b' },
  ].map((v) => ({
    name: `linkedFrom: ${JSON.stringify(v)}`,
    query: f({ linkedFrom: v }),
    code: 'invalid-value',
  })),
  // let
  ...[[], 3, 'a', null].map((v) => ({
    name: `let: ${JSON.stringify(v)}`,
    query: top({ let: v }),
    code: 'invalid-value',
  })),
  ...['1a', 'a-b', 'a b', 'a.b', ''].map((v) => ({
    name: `a binding named ${JSON.stringify(v)}`,
    query: top({ let: { [v]: binding } }),
    code: 'invalid-value',
  })),
  ...[3, null, 'kind', []].map((v) => ({
    name: `a binding is ${JSON.stringify(v)}`,
    query: top({ let: { $a: v } }),
    code: 'invalid-value',
  })),
  ...[3, null, ['kind'], 'a..b', ''].map((v) => ({
    name: `a binding's select is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { ...binding, select: v } }, filter: usingA }),
    code: 'invalid-value',
  })),
  ...[false, 1, 'yes', null].map((v) => ({
    name: `a binding's one is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { from: binding.from, one: v } } }),
    code: 'invalid-value',
  })),
  ...[3, null, 'Listing', []].map((v) => ({
    name: `a binding's from is ${JSON.stringify(v)}`,
    query: top({ let: { $a: { from: v, select: 'kind' } }, filter: usingA }),
    code: 'invalid-value',
  })),
  ...[3, null, [], {}, { size: '10' }, { size: 1.5 }].map((v) => ({
    name: `a binding's page is ${JSON.stringify(v)}`,
    query: top({
      let: { $a: { from: { ...binding.from, page: v }, select: 'kind' } },
      filter: usingA,
    }),
    code: 'invalid-value',
  })),
];

// ---- members that cannot go together --------------------------------------

const CONFLICTS: Mistake[] = [
  {
    name: 'a binding that is one card and a list',
    query: top({ let: { $a: { ...binding, one: true } } }),
    code: 'invalid-value',
  },
];

const LIMITS: Mistake[] = [
  {
    name: 'five bindings',
    query: top({
      let: Object.fromEntries(many(5, (i) => [`$b${i}`, binding])),
    }),
    code: 'limit-exceeded',
  },
  ...[0, -1, 10_001, 100_000].map((size) => ({
    name: `a binding's page of ${size}`,
    query: top({
      let: {
        $a: { from: { ...binding.from, page: { size } }, select: 'kind' },
      },
      filter: usingA,
    }),
    code: 'invalid-value',
  })),
  {
    name: "a binding's page with a number",
    query: top({
      let: {
        $a: {
          from: { ...binding.from, page: { size: 10, number: 1 } },
          select: 'kind',
        },
      },
      filter: usingA,
    }),
    code: 'invalid-value',
  },
  {
    name: "a binding whose query reads another binding's list",
    query: top({
      let: {
        $a: binding,
        $b: { from: { type: T, filter: usingA }, select: 'kind' },
      },
      filter: { in: { kind: '$b' } },
    }),
    code: 'invalid-nesting',
  },
  {
    name: "a binding whose query reads another binding's card",
    query: top({
      let: {
        $a: { from: { type: T, filter: kind }, one: true },
        $b: {
          from: {
            type: T,
            filter: { eq: { kind: '$a.kind' } },
          },
          select: 'kind',
        },
      },
      filter: { in: { kind: '$b' } },
    }),
    code: 'invalid-nesting',
  },
];

const UNKNOWN_MEMBERS: UnknownMember[] = [
  {
    level: 'a let binding',
    newer: top({ let: { $a: { ...binding, onee: true } }, filter: usingA }),
    unknown: 'onee',
    nearest: 'one',
    older: {
      let: {
        $a: {
          from: { filter: { on, ...kind } },
          select: 'kind',
          onee: true,
        },
      },
      filter: { on, in: { kind: '$a' } },
    },
    olderIs: 'refused',
  },
  {
    level: "a let binding's query",
    newer: top({
      let: { $a: { from: { ...binding.from, sorrt: [] }, select: 'kind' } },
      filter: usingA,
    }),
    unknown: 'sorrt',
    nearest: 'sort',
  },
];

// ---- accepted --------------------------------------------------------------

// The other side of each limit, and values that look wrong and are not.
const ACCEPTED: [string, Q][] = [
  [
    'four bindings',
    top({ let: Object.fromEntries(many(4, (i) => [`$b${i}`, binding])) }),
  ],
  [
    "a binding's page of 1,000",
    top({
      let: {
        $a: { from: { ...binding.from, page: { size: 1000 } }, select: 'kind' },
      },
      filter: usingA,
    }),
  ],
];

module(basename(import.meta.filename), function () {
  module('refused at validation', function () {
    table('a code no test asserted', UNASSERTED_CODES);
    table('a wrong kind of value', WRONG_KIND);
    table('members that cannot go together', CONFLICTS);
    table('out of range or over a limit', LIMITS);

    unknownMemberTests(UNKNOWN_MEMBERS);

    acceptedTests(ACCEPTED);

    test('[validation] an inherited name as a binding name', function (assert) {
      for (let name of INHERITED_NAMES) {
        // A string naming no declared binding is text: the lookup must not
        // find the name on the object every object inherits from, so the
        // query is checked as an `in` of that one literal value.
        let got = viaAssert(
          top({
            let: { $a: binding },
            filter: {
              every: [{ in: { kind: '$a' } }, { in: { kind: [`$${name}`] } }],
            },
          }),
        );
        assert.false(
          got.refused,
          `"$${name}" is text (${got.message.slice(0, 140)})`,
        );
      }
    });
  });
});
