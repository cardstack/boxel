// Excel wildcard matching: what it answers, and how long it may take.
//
// The cost is part of the contract here, not a nicety. Compiling `*` to a
// regex's `.*` makes a pattern carrying several stars explore exponentially
// many ways to split the text, which turns a formula over an ordinary text
// field into a hang — in an indexing worker, or on the browser's main thread.
// A value assertion cannot catch that: the suite would stop rather than fail.
// So the patterns below are the exponential shapes, and they are given a
// deadline.
import { ok, strictEqual } from 'node:assert';
import {
  excelWildcardMatchesWhole,
  excelWildcardSearch,
} from '../../src/formulajs/wildcard.ts';

let checks = 0;

// Where the pattern first matches, zero-based, or -1. SEARCH reports this + 1.
const searchCases: [string, string, number][] = [
  ['b', 'abc', 1],
  ['B', 'abc', 1],
  ['b', 'xyz', -1],
  ['Mc*n', 'Miriam McGovern', 7],
  ['M?G', 'Miriam McGovern', 7],
  ['*', 'abc', 0],
  ['', 'abc', 0],
  ['*b', 'ab', 0],
  ['a*', 'ab', 0],
  ['a*c', 'abc', 0],
  ['a*c', 'ac', 0],
  ['~*', '3 * 4', 2],
  ['~?', 'a?b', 1],
  ['~~', 'a~b', 1],
  // Regex metacharacters are literal text to a wildcard pattern.
  ['[a]', 'x[a]y', 1],
  ['.', 'a.b', 1],
  ['a+', 'xa+y', 1],
  ['(b)', 'a(b)c', 1],
  // `?` spans any one character, newlines included.
  ['a?b', 'a\nb', 0],
  ['a*b', 'a\n\nb', 0],
];
for (const [pattern, text, expected] of searchCases) {
  strictEqual(
    excelWildcardSearch(pattern, text),
    expected,
    `search ${JSON.stringify(pattern)} in ${JSON.stringify(text)}`,
  );
  checks++;
}

// A criteria match is anchored at both ends instead.
const wholeCases: [string, string, boolean][] = [
  ['abc', 'abc', true],
  ['abc', 'abcd', false],
  ['ABC', 'abc', true],
  ['a?c', 'abc', true],
  ['a?c', 'ac', false],
  ['a*', 'ab', true],
  ['*b', 'ab', true],
  ['*', '', true],
  ['*', 'anything', true],
  ['a*c', 'ac', true],
  ['a*c', 'abbbc', true],
  ['a*c', 'abbb', false],
  ['*b*', 'abc', true],
  ['~*', '*', true],
  ['~*', 'x', false],
  ['a*a*a', 'aaa', true],
  ['a*a*a', 'aa', false],
];
for (const [pattern, text, expected] of wholeCases) {
  strictEqual(
    excelWildcardMatchesWhole(pattern, text),
    expected,
    `whole ${JSON.stringify(pattern)} against ${JSON.stringify(text)}`,
  );
  checks++;
}

// Every pattern here is one a backtracking engine takes exponential time on.
// The text is deliberately the worst case: nothing but the character the
// literal runs are made of, so every star has somewhere to go.
const BUDGET_MS = 1000;
const haystack = 'a'.repeat(400);
const pathological = [
  '********z',
  '**********z',
  '*a*a*a*a*a*a*a*a*a*a*a*ab',
  '*a*a*a*a*b',
  'a*a*a*a*a*a*a*a*a*a*a*a*z',
  '?*?*?*?*?*?*?*?*z',
];
const started = process.hrtime.bigint();
for (const pattern of pathological) {
  strictEqual(
    excelWildcardSearch(pattern, haystack),
    -1,
    `${pattern} cannot match a text with no z`,
  );
  strictEqual(
    excelWildcardMatchesWhole(pattern, haystack),
    false,
    `${pattern} cannot match the whole of a text with no z`,
  );
  checks += 2;
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
ok(
  elapsedMs < BUDGET_MS,
  `${pathological.length} star-heavy patterns over ${haystack.length} characters took ${elapsedMs.toFixed(1)}ms, over the ${BUDGET_MS}ms budget — matching has gone superlinear again`,
);
checks++;

console.log(`BXL wildcard matching: ${checks} checks passed`);
