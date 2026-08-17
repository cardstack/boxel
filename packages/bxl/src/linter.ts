/**
 * @cardstack/bxl/linter — sub-entry.
 *
 * Parser-only diagnostics: no formulajs libraries are registered here.
 *
 * The intent is a minimal sub-entry that reaches src/jqtools/parser/ for
 * native-syntax validation and nothing more. It does not yet achieve that —
 * it imports bridge/native.ts, which drags in src/jqtools/evaluate/. Making
 * the sub-entry live up to its name means splitting a parser-only native
 * module and pointing the linter at it.
 */

export { lintBxlExpression } from './bxl/linter/index.ts';

export type {
  BxlLintIssue,
  BxlLintOptions,
  BxlLintResult,
  BxlLintSeverity,
} from './bxl/linter/index.ts';
