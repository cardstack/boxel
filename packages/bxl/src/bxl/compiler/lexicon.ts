// Shared lexical sets for BXL — kept in one place so the compiler
// (readable-syntax.ts) and the linter (linter.ts) can never drift apart.
//
// This module holds only the vocabulary sets that BOTH modules reference.
// Sets used by a single module (FORMULA_FUNCTIONS, CASE_INSENSITIVE_JQ_FUNCTIONS,
// PATH_RESERVED, PREDICATE_OPERATORS) stay local to their owner to keep the
// import graph narrow.

/**
 * Reserved jq language keywords. Identifiers that match these strings are
 * never compiled as readable label paths — they keep their jq meaning.
 */
export const JQ_KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'as',
  'break',
  'catch',
  'def',
  'elif',
  'else',
  'end',
  'foreach',
  'if',
  'label',
  'not',
  'or',
  'reduce',
  'then',
  'try',
]);

/**
 * BXL / jq literal values. Treated as values, never as label paths.
 */
export const BXL_LITERALS: ReadonlySet<string> = new Set([
  'true',
  'false',
  'null',
]);
