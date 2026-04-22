/**
 * @cardstack/bxl/compiler — sub-entry.
 *
 * Readable BXL → canonical jqxl source. Does NOT pull in the evaluator or
 * formulajs. Keep this entry small for editor integrations that only need
 * to compile.
 */

export {
  compileReadableSyntax,
} from './bxl/compiler/readable-syntax.js';

export type {
  ReadableSchema,
  ReadableField,
  ReadableSyntaxWarning,
} from './bxl/compiler/readable-syntax.js';

export {
  bxlToJqExpression,
  jqToReadableBxlExpression,
  solidifyBxlExpression,
  expandBxlExpression,
  collapseBxlExpression,
} from './bxl/formatter/index.js';

export type {
  BxlConversionOptions,
  BxlFormatResult,
  BxlRewrite,
  BxlSolidifyResult,
  JqToReadableBxlResult,
} from './bxl/formatter/index.js';
