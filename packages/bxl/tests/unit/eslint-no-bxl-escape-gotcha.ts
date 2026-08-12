// Smoke test for the custom ESLint rule eslint-rules/no-bxl-escape-gotcha.
// We don't pull in the full RuleTester (avoid dragging in @types/eslint
// for one test); instead we directly exercise the rule with a handful
// of sample ASTs by invoking ESLint as a library.

import { strictEqual } from 'node:assert';
import { Linter } from 'eslint';
import noBxlEscapeGotcha from '../../eslint-rules/no-bxl-escape-gotcha.js';

const linter = new Linter();

// Register the rule under a synthetic plugin name so config can refer
// to it by `bxl/no-escape-gotcha`.
const config = {
  plugins: {
    bxl: { rules: { 'no-escape-gotcha': noBxlEscapeGotcha } },
  },
  rules: { 'bxl/no-escape-gotcha': 'error' },
  languageOptions: {
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const,
  },
};

interface Case {
  name: string;
  code: string;
  errors: number;
}

const cases: Case[] = [
  // ---- should flag ----
  {
    name: 'plain string with \\( inside expression()',
    code: `expression('"\\(.firstName)"')`,
    errors: 1,
  },
  {
    name: 'plain string with \\( inside expr()',
    code: `expr('"\\(.x)/\\(.y)"')`,
    errors: 1,
  },
  {
    name: 'plain string with \\( inside bxl()',
    code: `bxl('"\\(.foo)"')`,
    errors: 1,
  },
  {
    name: 'untagged template literal with \\(',
    code: 'expression(`"\\(.firstName)"`)',
    errors: 1,
  },

  // ---- should NOT flag ----
  {
    name: 'plain string without backslash',
    code: `expression('.firstName')`,
    errors: 0,
  },
  {
    name: 'PascalCase plain string',
    code: `expression('Severity == "High"')`,
    errors: 0,
  },
  {
    name: 'jq-tagged template with \\( (the recommended fix)',
    code: 'expression(jq`"\\(.firstName)"`)',
    errors: 0,
  },
  {
    name: 'fx-tagged template (no backslash gotcha)',
    code: 'expression(fx`ROUND(Salary / 2080, 2)`)',
    errors: 0,
  },
  {
    name: 'unrelated function call with backslash string',
    code: `unrelated('"\\(.foo)"')`,
    errors: 0,
  },
  {
    name: 'expression with non-string first arg',
    code: `expression(someVariable)`,
    errors: 0,
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const c of cases) {
  const messages = linter.verify(c.code, config);
  if (messages.length === c.errors) {
    pass++;
  } else {
    fail++;
    failures.push(
      `  ${c.name}\n    expected ${c.errors} error(s), got ${messages.length}: ${JSON.stringify(messages.map((m) => m.message))}`,
    );
  }
}

console.log(
  `BXL ESLint no-escape-gotcha: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}

// Sanity: confirm the linter actually loaded the rule under that key.
strictEqual(typeof noBxlEscapeGotcha.create, 'function');
