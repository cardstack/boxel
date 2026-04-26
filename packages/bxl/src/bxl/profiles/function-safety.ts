import type { BxlProfile } from '../ast/index.js';

export type BxlProfileFunctionSafety =
  | 'allow'
  | 'deny'
  | 'unclassified';

export type BxlFunctionSafetyCategory =
  | 'aggregate'
  | 'boundedScalar'
  | 'controlOrSideEffect'
  | 'errorMasking'
  | 'metadata'
  | 'predicateLowerable'
  | 'volatile';

export interface BxlProfileFunctionPolicy {
  readonly allowedCalls?: ReadonlySet<string>;
  readonly deniedCalls?: ReadonlySet<string>;
  readonly denyMessageByCategory?: Partial<Record<BxlFunctionSafetyCategory, string>>;
}

export interface BxlFunctionSafetyDecision {
  safety: BxlProfileFunctionSafety;
  normalizedName: string;
  category?: BxlFunctionSafetyCategory;
  message?: string;
}

function names(values: string[]): ReadonlySet<string> {
  return new Set(values.map((value) => value.toUpperCase()));
}

export const BXL_AGGREGATE_CALLS = names([
  'AVERAGE',
  'AVERAGEIF',
  'AVERAGEIF_BY',
  'AVERAGEIFS_BY',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'COUNTIF',
  'COUNTIF_BY',
  'COUNTIFS_BY',
  'MAX',
  'MAXIFS',
  'MEDIAN',
  'MIN',
  'MINIFS',
  'PRODUCT',
  'STDEV',
  'STDEV_P',
  'STDEV_S',
  'SUM',
  'SUMIF',
  'SUMIF_BY',
  'SUMIFS_BY',
  'SUMPRODUCT',
  'SUMSQ',
  'VAR',
  'VAR_P',
  'VAR_S',
]);

export const BXL_ERROR_MASKING_CALLS = names([
  'ERROR_TYPE',
  'IFERROR',
  'IFNA',
  'ISERR',
  'ISERROR',
  'ISNA',
  'try',
]);

export const BXL_VOLATILE_CALLS = names([
  'NOW',
  'RAND',
  'RANDBETWEEN',
  'TODAY',
  'now',
]);

export const BXL_CONTROL_OR_SIDE_EFFECT_CALLS = names([
  'debug',
  'empty',
  'env',
  'error',
  'halt',
  'halt_error',
  'input',
  'input_filename',
  'input_line_number',
  'stderr',
]);

export const BXL_METADATA_CALLS = names([
  'builtins',
  'get_jq_origin',
  'get_prog_origin',
  'get_search_list',
  'modulemeta',
]);

export const BXL_PREDICATE_LOWERABLE_CALLS = names([
  'IN',
  'age',
  'between',
  'like',
  'matches',
  'NOT',
  'not',
  'overlaps',
  'present',
]);

export const BXL_DERIVE_DENIED_CALLS = names([
  ...BXL_VOLATILE_CALLS,
  ...BXL_CONTROL_OR_SIDE_EFFECT_CALLS,
  ...BXL_METADATA_CALLS,
]);

export const BXL_FUNCTION_SAFETY_CATEGORIES: ReadonlyMap<
  string,
  BxlFunctionSafetyCategory
> = new Map([
  ...[...BXL_AGGREGATE_CALLS].map((name) => [name, 'aggregate'] as const),
  ...[...BXL_ERROR_MASKING_CALLS].map((name) => [name, 'errorMasking'] as const),
  ...[...BXL_VOLATILE_CALLS].map((name) => [name, 'volatile'] as const),
  ...[...BXL_CONTROL_OR_SIDE_EFFECT_CALLS].map((name) => [name, 'controlOrSideEffect'] as const),
  ...[...BXL_METADATA_CALLS].map((name) => [name, 'metadata'] as const),
  ...[...BXL_PREDICATE_LOWERABLE_CALLS].map((name) => [name, 'predicateLowerable'] as const),
]);

const POLICY_DENIED_CALLS = new Set([
  ...BXL_AGGREGATE_CALLS,
  ...BXL_ERROR_MASKING_CALLS,
  ...BXL_VOLATILE_CALLS,
  ...BXL_CONTROL_OR_SIDE_EFFECT_CALLS,
  ...BXL_METADATA_CALLS,
]);

export const BXL_PROFILE_FUNCTION_POLICIES: Record<
  Exclude<BxlProfile, 'compute'>,
  BxlProfileFunctionPolicy
> = {
  policy: {
    deniedCalls: POLICY_DENIED_CALLS,
    denyMessageByCategory: {
      aggregate: 'aggregate calls can pull work across collections',
      controlOrSideEffect: 'control/side-effect calls are not request-time authorization predicates',
      errorMasking: 'error-masking calls can hide fail-closed authorization errors',
      metadata: 'runtime metadata calls are not authorization predicates',
      volatile: 'volatile calls are not stable request-time authorization predicates',
    },
  },
  predicate: {
    allowedCalls: BXL_PREDICATE_LOWERABLE_CALLS,
  },
  derive: {
    deniedCalls: BXL_DERIVE_DENIED_CALLS,
    denyMessageByCategory: {
      controlOrSideEffect: 'control/side-effect calls are not stable write-time derivations',
      metadata: 'runtime metadata calls are not stable write-time derivations',
      volatile: 'volatile calls are not stable write-time derivations',
    },
  },
};

export function normalizeBxlFunctionName(name: string): string {
  return name.toUpperCase();
}

export function categoryForBxlFunction(
  name: string,
): BxlFunctionSafetyCategory | undefined {
  return BXL_FUNCTION_SAFETY_CATEGORIES.get(normalizeBxlFunctionName(name));
}

export function classifyBxlProfileFunction(
  profile: BxlProfile,
  name: string,
): BxlFunctionSafetyDecision {
  const normalizedName = normalizeBxlFunctionName(name);
  if (profile === 'compute') {
    return { safety: 'allow', normalizedName };
  }

  const policy = BXL_PROFILE_FUNCTION_POLICIES[profile];
  const category = categoryForBxlFunction(name);

  if (policy.allowedCalls) {
    return policy.allowedCalls.has(normalizedName)
      ? { safety: 'allow', normalizedName, category }
      : { safety: 'deny', normalizedName, category };
  }

  if (policy.deniedCalls?.has(normalizedName)) {
    return {
      safety: 'deny',
      normalizedName,
      category,
      message: category ? policy.denyMessageByCategory?.[category] : undefined,
    };
  }

  return { safety: 'unclassified', normalizedName, category };
}
