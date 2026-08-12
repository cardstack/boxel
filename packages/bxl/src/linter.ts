/**
 * @cardstack/bxl/linter — sub-entry.
 *
 * Parser-only diagnostics. No evaluator, no formulajs. This entry transitively
 * pulls in src/jqtools/parser/ for native-syntax validation but NOT
 * src/jqtools/evaluate/ or src/formulajs/.
 *
 * NB: Current linter.ts imports from bridge/native.ts which does pull in the
 * evaluator. A follow-up task is to split a parser-only native module and
 * point the linter at it so this sub-entry stays minimal. Tracked in the
 * RELEASE-PLAN as pre-release blocker #3.
 */

export {
  lintBxlExpression,
} from './bxl/linter/index.js';

export type {
  BxlLintIssue,
  BxlLintOptions,
  BxlLintResult,
  BxlLintSeverity,
} from './bxl/linter/index.js';
