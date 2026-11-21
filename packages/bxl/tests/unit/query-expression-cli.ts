import { deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  queryExpressionIssues,
  type BxlProfileIssue,
} from '../../src/compiler.ts';
import { parseBxlAst } from '../../src/index.ts';
import { spreadsheetFormulaCalls } from '../../src/bxl/profiles/query-expression.ts';
import { classifyBxlProfileFunction } from '../../src/bxl/profiles/function-safety.ts';
import { prepareSpreadsheetFormula } from '../../src/sql.ts';
import { functionCoverageCases } from './fixtures/function-coverage/index.ts';

// The query profile's check on a search expression is light: it reads the
// source's shape as the spreadsheet interpreter would, without loading the
// interpreter or the score compiler, so a browser can run it. Here it is held
// to the interpreter's own answer, and its modules to staying light.

let checks = 0;
const check = (fn: () => void) => {
  fn();
  checks++;
};

// What the interpreter takes, and the functions it hands to its caller.
function interpreterCalls(source: string): string[] | undefined {
  let calls: string[] = [];
  try {
    prepareSpreadsheetFormula(source, {
      callFunction(name) {
        calls.push(name);
        return () => null;
      },
    });
  } catch {
    return undefined;
  }
  return calls;
}

// The check as it read before it was made light: through the interpreter.
function interpreterIssues(source: string): BxlProfileIssue[] {
  let called = interpreterCalls(source);
  if (called) {
    let issues: BxlProfileIssue[] = [];
    for (let name of new Set(called)) {
      let decision = classifyBxlProfileFunction('query', name);
      if (decision.safety === 'deny') {
        issues.push({
          code: 'query-call-banned',
          severity: 'error',
          message: `Profile.query computes one value from a row in a query and cannot use ${name}${decision.message ? `: ${decision.message}` : ''}.`,
          nodeType: 'call',
        });
      }
    }
    return issues;
  }
  let program;
  try {
    program = parseBxlAst(source.trim(), { profile: 'query' });
  } catch (e) {
    let word = /"(import|include)" is a reserved word/.exec(
      String((e as Error)?.message),
    )?.[1];
    return word
      ? [
          {
            code: 'query-module-banned',
            severity: 'error',
            message: `Profile.query computes one value from a row in a query and cannot use jq \`${word}\`.`,
          },
        ]
      : [];
  }
  return program.profileIssues.filter((issue) => issue.severity === 'error');
}

const SHAPES = [
  // spreadsheet formulas, and their edges
  'rating / LN(priceMin + 1)',
  'IF(onSale, rating * 1.2, rating)',
  'IFERROR(rating / priceMin, 0) + MAX(rating, 0)',
  'input * 2',
  'env + 1',
  '.rating * 2',
  '.["end"] + 1',
  '."end" + 1',
  'brand.name',
  '.items[0] + 1',
  '.items[] + 1',
  'RAND()',
  'RAND() + rand',
  'NOW',
  'NOW() - 1',
  'PI + 1',
  'TRUE + FALSE',
  'DAYS(NOW(), publishedAt)',
  'DAYS(TODAY(), "2026-01-01")',
  'DAYS(publishedAt)',
  'DAYS(rating + 1, publishedAt)',
  'IFS(rating > 3, 1, TRUE, 2)',
  'IFS(rating > 3, 1, 2)',
  'IFS(rating)',
  'IF(rating)',
  'IF(rating, 1, 2, 3)',
  'ROUND()',
  'ROUND(rating, 1, 2)',
  'ROUND(input, 1, 2)',
  'MIN()',
  'MIN(rating)',
  'SUM(rating, price, 3)',
  'COUNT(tags, 1 > 0)',
  'AVERAGE([1, 2, 3])',
  'SUM([])',
  'NOT(rating)',
  'rating | not',
  'title & "x"',
  '"x" & title & 1',
  'title | tostring',
  'rating and inStock',
  'rating or onSale',
  'rating == 1',
  'rating != 1',
  'rating <> 1',
  '-rating',
  '+rating',
  'not rating',
  'rating ^ 2',
  'POWER(rating, 2)',
  'VLOOKUP(rating, table, 2)',
  'XLOOKUP(rating)',
  'MEDIAN(peers.price)',
  'PERCENTRANK_INC(peers.price, price)',
  'COUNTIF(peers.kind, "<>rug")',
  'NA()',
  'ISNUMBER(rating)',
  'LET(x, 1, x + 1)',
  'if rating > 3 then 1 else 2 end',
  'if rating > 3 then 1 elif rating > 1 then 2 else 3 end',
  'if rating > 3 then 1 end',
  '[1, 2]',
  '{a: 1}',
  'null',
  '"text"',
  '1.5',
  'true',
  '. | length',
  'map(. + 1)',
  'reduce .[] as $x (0; . + $x)',
  '$__loc__',
  'input',
  'inputs',
  'env.HOME',
  '$ENV.HOME',
  'now',
  'now + 1',
  'error("x")',
  'ERROR(1) * 2',
  'ENV() + 1',
  'input | length',
  'debug',
  'import "a" as a; 1',
  'include "a"; 1',
  'def f: 1; f',
  'rating |= 1',
  'rating // 0',
  'rating?',
  '.. | numbers',
  'first(.[])',
  '',
  '   ',
  'rating +',
  '(rating',
  'x'.repeat(2001),
  'rating + 1 // a comment',
  'IF(rating, # not a call(\n 1, 2)',
  'a.b(1)',
  'SUM(a.b(1))',
];

check(() => {
  let corpus = [
    ...new Set([...SHAPES, ...functionCoverageCases.map((c) => c.source)]),
  ];
  let mismatches: string[] = [];
  for (let source of corpus) {
    let light = spreadsheetFormulaCalls(source);
    let interpreter = interpreterCalls(source);
    if (JSON.stringify(light) !== JSON.stringify(interpreter)) {
      mismatches.push(
        `${JSON.stringify(source.slice(0, 80))}: light ${JSON.stringify(light)}, interpreter ${JSON.stringify(interpreter)}`,
      );
    }
    let issues = JSON.stringify(queryExpressionIssues(source));
    if (issues !== JSON.stringify(interpreterIssues(source))) {
      mismatches.push(`${JSON.stringify(source.slice(0, 80))}: issues differ`);
    }
  }
  deepStrictEqual(
    mismatches,
    [],
    'the light check reads every source as the interpreter does',
  );
  ok(corpus.length > 500, `a corpus worth the name (${corpus.length})`);
});

check(() => {
  deepStrictEqual(spreadsheetFormulaCalls('input * 2'), []);
  deepStrictEqual(spreadsheetFormulaCalls('VLOOKUP(a, b) + RAND()'), [
    'VLOOKUP',
    'RAND',
  ]);
  deepStrictEqual(spreadsheetFormulaCalls('. | length'), undefined);
  deepStrictEqual(
    queryExpressionIssues('ERROR(1) * 2').map((i) => i.code),
    ['query-call-banned'],
    'a banned function is refused',
  );
  deepStrictEqual(
    queryExpressionIssues('input | length').map((i) => i.code),
    ['query-operator-banned', 'query-call-banned'],
    'a jq construct is checked node by node',
  );
  deepStrictEqual(
    queryExpressionIssues('input * 2'),
    [],
    'a bare name in a spreadsheet formula is a field',
  );
});

// The light modules and the entries browser code reaches BXL through import
// nothing under src/bxl/sql/, so a browser bundle leaves the compilers out.
check(() => {
  let src = resolve(import.meta.dirname, '../../src');
  let seen = new Set<string>();
  let reached: string[] = [];
  let visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let code = readFileSync(file, 'utf8');
    for (let [, spec] of code.matchAll(
      /(?:^|\n)\s*(?:import|export)\s(?!type\b)[^;]*?from\s+'(\.[^']+)'/g,
    )) {
      let target = join(dirname(file), spec);
      reached.push(relative(src, target));
      visit(target);
    }
  };
  for (let entry of ['index.ts', 'compiler.ts']) visit(join(src, entry));
  let sql = reached.filter((f) => f.startsWith('bxl/sql/'));
  deepStrictEqual(
    [...new Set(sql)],
    [],
    'no browser entry reaches the SQL push-down',
  );
});

console.log(`query-expression: ${checks} checks passed`);
