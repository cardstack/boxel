/**
 * The function-coverage case tables, one file per function family.
 *
 * Each `NAME/arity` the registry exposes needs a case in exactly one of these
 * tables. The families partition the surface: jq's own builtins split into
 * structural and numeric halves, the eager Excel library splits by Excel
 * category, and each lazily chunked family and the validator.js and
 * authorization libraries get a file of their own.
 */
import type { CoverageCase } from './case.ts';
import { authorizationCases } from './authorization.ts';
import { coreJqCases } from './core-jq.ts';
import { coreMathCases } from './core-math.ts';
import { formulaBesselCases } from './formula-bessel.ts';
import { formulaDateCases } from './formula-date.ts';
import { formulaEngineeringCases } from './formula-engineering.ts';
import { formulaFinancialCases } from './formula-financial.ts';
import { formulaLogicCases } from './formula-logic.ts';
import { formulaLookupCases } from './formula-lookup.ts';
import { formulaMathCases } from './formula-math.ts';
import { formulaStatisticalCases } from './formula-statistical.ts';
import { formulaStatsCases } from './formula-stats.ts';
import { formulaTextCases } from './formula-text.ts';
import { validationCases } from './validation.ts';

export const functionCoverageCases: CoverageCase[] = [
  ...coreJqCases,
  ...coreMathCases,
  ...formulaMathCases,
  ...formulaStatsCases,
  ...formulaTextCases,
  ...formulaDateCases,
  ...formulaLogicCases,
  ...formulaLookupCases,
  ...formulaStatisticalCases,
  ...formulaBesselCases,
  ...formulaEngineeringCases,
  ...formulaFinancialCases,
  ...validationCases,
  ...authorizationCases,
];

/**
 * Exposed names no program can reach, each with the reason. Anything listed
 * here is checked against the registry: a name that stops being exposed, or
 * that gains a coverage case, has to come off the list.
 */
export const UNREACHABLE_BUILTINS = new Map<string, string>([
  [
    'modulemeta/0',
    'the tokenizer reserves `modulemeta` as a keyword, so naming it is a ' +
      'parse error before dispatch is reached — and the filter itself only ' +
      'raises "not implemented", since BXL has no module system',
  ],
]);

export type { CoverageCase };
