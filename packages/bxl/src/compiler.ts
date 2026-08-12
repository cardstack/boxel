/**
 * @cardstack/bxl/compiler — sub-entry.
 *
 * Readable BXL → canonical jqxl source. Does NOT pull in the evaluator or
 * formulajs. Keep this entry small for editor integrations that only need
 * to compile.
 */

import {
  compileReadableSyntax,
  type ReadableSchema,
  type ReadableSyntaxCompileResult,
} from './bxl/compiler/readable-syntax.ts';
import {
  parseBxlAst,
  type BxlAstProgram,
  type BxlAttachment,
  type BxlProfile,
} from './bxl/ast/index.ts';

export { compileReadableSyntax } from './bxl/compiler/readable-syntax.ts';

export {
  assertValidBxlProfile,
  parseBxlAst,
  validateBxlAst,
  visitBxlAst,
} from './bxl/ast/index.ts';

export {
  BXL_AGGREGATE_CALLS,
  BXL_AUTHORIZATION_CALLS,
  BXL_AUTHORIZATION_GRAPH_CALLS,
  BXL_CONTROL_OR_SIDE_EFFECT_CALLS,
  BXL_DERIVE_DENIED_CALLS,
  BXL_ERROR_MASKING_CALLS,
  BXL_FUNCTION_SAFETY_CATEGORIES,
  BXL_METADATA_CALLS,
  BXL_PREDICATE_LOWERABLE_CALLS,
  BXL_PROFILE_FUNCTION_POLICIES,
  BXL_VOLATILE_CALLS,
  categoryForBxlFunction,
  classifyBxlProfileFunction,
} from './bxl/profiles/function-safety.ts';

export {
  BxlPredicateSqlError,
  SQL_PREDICATE_MODULE,
  compileBxlPredicateAstToSql,
  compileBxlPredicateToSql,
} from './bxl/sql/index.ts';

export type {
  ReadableSchema,
  ReadableField,
  ReadableSyntaxCompileResult,
  ReadableSyntaxWarning,
} from './bxl/compiler/readable-syntax.ts';

export type {
  BxlAstNode,
  BxlAstOptions,
  BxlAstProgram,
  BxlAttachment,
  BxlContextPathNode,
  BxlPathNode,
  BxlProfile,
  BxlProfileIssue,
  BxlProfileValidationOptions,
} from './bxl/ast/index.ts';

export type {
  BxlFunctionSafetyCategory,
  BxlFunctionSafetyDecision,
  BxlProfileFunctionPolicy,
  BxlProfileFunctionSafety,
} from './bxl/profiles/function-safety.ts';

export type {
  BxlPredicateSqlOptions,
  BxlPredicateSqlPath,
  BxlPredicateSqlPathUsage,
  BxlPredicateSqlResult,
  BxlPredicateSqlValue,
  BxlSqlPredicateMapping,
  BxlSqlPredicateModule,
} from './bxl/sql/index.ts';

export {
  bxlToStorageExpression,
  bxlToJqExpression,
  jqToReadableBxlExpression,
  storageToReadableBxlExpression,
  solidifyBxlExpression,
  expandBxlExpression,
  collapseBxlExpression,
} from './bxl/formatter/index.ts';

export type {
  BxlConversionOptions,
  BxlFormatResult,
  BxlRewrite,
  BxlSolidifyResult,
  JqToReadableBxlResult,
} from './bxl/formatter/index.ts';

export interface CompileBxlOptions {
  schema?: ReadableSchema;
  readableSyntax?: boolean;
  target?: 'jq' | 'ast';
  profile?: BxlProfile;
  attachment?: BxlAttachment;
}

export function compileBxl(
  expression: string,
  options: CompileBxlOptions & { target: 'ast' },
): BxlAstProgram;
export function compileBxl(
  expression: string,
  options?: CompileBxlOptions & { target?: 'jq' },
): ReadableSyntaxCompileResult;
export function compileBxl(
  expression: string,
  options: CompileBxlOptions = {},
): ReadableSyntaxCompileResult | BxlAstProgram {
  if (options.target === 'ast') {
    return parseBxlAst(expression, options);
  }
  return compileReadableSyntax(expression, options);
}
