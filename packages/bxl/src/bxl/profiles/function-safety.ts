import type { BxlProfile } from '../ast/index.js';
import {
  DETERMINISTIC_VALIDATION_FUNCTIONS,
  VOLATILE_VALIDATION_FUNCTIONS,
} from '../bridge/validation-manifest.js';

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
  'AVEDEV',
  'AVERAGE',
  'AVERAGEIF',
  'AVERAGEIF_BY',
  'AVERAGEIFS_BY',
  'CHISQ_TEST',
  'COUNT',
  'COUNTA',
  'COUNTBLANK',
  'COUNTIF',
  'COUNTIF_BY',
  'COUNTIFS_BY',
  'CORREL',
  'DEVSQ',
  'F_TEST',
  'FORECAST',
  'FVSCHEDULE',
  'GCD',
  'GEOMEAN',
  'HARMEAN',
  'IMPRODUCT',
  'IMSUM',
  'IRR',
  'IRR_BY',
  'KURT',
  'LARGE',
  'LCM',
  'MAX',
  'MAXIFS',
  'MEDIAN',
  'MIN',
  'MINIFS',
  'MIRR',
  'MULTINOMIAL',
  'NPV',
  'NPV_BY',
  'PEARSON',
  'PERCENTILE_EXC',
  'PERCENTILE_INC',
  'PERCENTRANK_EXC',
  'PERCENTRANK_INC',
  'QUARTILE_EXC',
  'QUARTILE_INC',
  'PRODUCT',
  'RANK_AVG',
  'RANK_EQ',
  'SERIESSUM',
  'SKEW',
  'SLOPE',
  'SMALL',
  'STDEV',
  'STDEV_P',
  'STDEV_S',
  'SUM',
  'SUMIF',
  'SUMIF_BY',
  'SUMIFS_BY',
  'SUMPRODUCT',
  'SUMSQ',
  'SUMX2MY2',
  'SUMX2PY2',
  'SUMXMY2',
  'T_TEST',
  'TRIMMEAN',
  'VAR',
  'VAR_P',
  'VAR_S',
  'XIRR',
  'XIRR_BY',
  'XNPV',
  'XNPV_BY',
  'Z_TEST',
]);

export const BXL_BOUNDED_SCALAR_CALLS = names([
  'ACCRINT',
  'BASE',
  'BESSELI',
  'BESSELJ',
  'BESSELK',
  'BESSELY',
  'BETA_DIST',
  'BETA_INV',
  'BIN2DEC',
  'BIN2HEX',
  'BIN2OCT',
  'BINOM_DIST',
  'BINOM_DIST_RANGE',
  'BINOM_INV',
  'BITAND',
  'BITLSHIFT',
  'BITOR',
  'BITRSHIFT',
  'BITXOR',
  'CHISQ_DIST',
  'CHISQ_DIST_RT',
  'CHISQ_INV',
  'CHISQ_INV_RT',
  'COMPLEX',
  'CONFIDENCE_NORM',
  'CONFIDENCE_T',
  'CONVERT',
  'COUPDAYS',
  'CUMIPMT',
  'CUMPRINC',
  'DB',
  'DDB',
  'DEC2BIN',
  'DEC2HEX',
  'DEC2OCT',
  'DECIMAL',
  'DELTA',
  'DISC',
  'DOLLARDE',
  'DOLLARFR',
  'EFFECT',
  'ERF',
  'ERFC',
  'EXPON_DIST',
  'F_DIST',
  'F_DIST_RT',
  'F_INV',
  'F_INV_RT',
  'FV',
  'GAMMA',
  'GAMMA_DIST',
  'GAMMA_INV',
  'GAMMALN',
  'GAMMALN_PRECISE',
  'GAUSS',
  'GESTEP',
  'HEX2BIN',
  'HEX2DEC',
  'HEX2OCT',
  'HYPGEOM_DIST',
  'IMABS',
  'IMAGINARY',
  'IMARGUMENT',
  'IMCONJUGATE',
  'IMCOS',
  'IMCOSH',
  'IMCOT',
  'IMCSC',
  'IMCSCH',
  'IMDIV',
  'IMEXP',
  'IMLN',
  'IMLOG10',
  'IMLOG2',
  'IMPOWER',
  'IMREAL',
  'IMSEC',
  'IMSECH',
  'IMSIN',
  'IMSINH',
  'IMSQRT',
  'IMSUB',
  'IMTAN',
  'IPMT',
  'ISPMT',
  'LOGNORM_DIST',
  'LOGNORM_INV',
  'NEGBINOM_DIST',
  'NOMINAL',
  'NORM_DIST',
  'NORM_INV',
  'NORM_S_DIST',
  'NORM_S_INV',
  'NPER',
  'OCT2BIN',
  'OCT2DEC',
  'OCT2HEX',
  'PDURATION',
  'PHI',
  'PMT',
  'POISSON_DIST',
  'PPMT',
  'PRICEDISC',
  'PV',
  'RATE',
  'RRI',
  'SLN',
  'STANDARDIZE',
  'SYD',
  'T_DIST',
  'T_DIST_2T',
  'T_DIST_RT',
  'T_INV',
  'T_INV_2T',
  'TBILLEQ',
  'TBILLPRICE',
  'TBILLYIELD',
  'UNICHAR',
  'WEIBULL_DIST',
  ...DETERMINISTIC_VALIDATION_FUNCTIONS,
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
  ...VOLATILE_VALIDATION_FUNCTIONS,
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

const BXL_DERIVE_CONTROL_DENIED_CALLS = names([
  'debug',
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
  ...BXL_DERIVE_CONTROL_DENIED_CALLS,
  ...BXL_METADATA_CALLS,
]);

export const BXL_FUNCTION_SAFETY_CATEGORIES: ReadonlyMap<
  string,
  BxlFunctionSafetyCategory
> = new Map([
  ...[...BXL_AGGREGATE_CALLS].map((name) => [name, 'aggregate'] as const),
  ...[...BXL_BOUNDED_SCALAR_CALLS].map((name) => [name, 'boundedScalar'] as const),
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

  if (category) {
    return { safety: 'allow', normalizedName, category };
  }

  return { safety: 'unclassified', normalizedName, category };
}
