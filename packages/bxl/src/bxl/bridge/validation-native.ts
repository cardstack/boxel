// See formulajs/bessel.ts for why this is a reference rather than a
// tsconfig include or an import.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../types/validator.d.ts" />
import validatorPackage from 'validator';
import type { BareNativeFilter } from '../../jqtools/evaluate/filters/lib/nativeFilter.ts';
import { wrapBareNativeFilters } from '../../jqtools/evaluate/filters/lib/nativeFilter.ts';
import { VALIDATION_FUNCTION_DEFINITIONS } from './validation-manifest.ts';

type ValidatorFunction = (value: string, ...args: any[]) => unknown;
type ValidatorPackage = Record<string, unknown> & {
  default?: Record<string, unknown>;
};

const validator = ((validatorPackage as ValidatorPackage).default ??
  validatorPackage) as Record<string, unknown>;

function validatorFunction(name: string): ValidatorFunction | undefined {
  const candidate = validator[name];
  return typeof candidate === 'function'
    ? (candidate as ValidatorFunction)
    : undefined;
}

function callStringValidator(
  name: string,
  value: unknown,
  ...args: unknown[]
): unknown {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const predicate = validatorFunction(name);
    if (!predicate) {
      return false;
    }
    return predicate(value, ...args);
  } catch {
    return false;
  }
}

const bareNativeFilters: Record<string, BareNativeFilter> = {};

for (const definition of VALIDATION_FUNCTION_DEFINITIONS) {
  for (const arity of definition.arities) {
    bareNativeFilters[`${definition.name}/${arity}`] = function* (
      _input,
      value,
      ...args
    ) {
      yield callStringValidator(definition.name, value, ...args);
    };
  }
}

export const validationNativeFilters = wrapBareNativeFilters(bareNativeFilters);
