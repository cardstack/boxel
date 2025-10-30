import type { ParsedPhoneNumber } from 'awesome-phonenumber';
import { parsePhoneNumber } from 'awesome-phonenumber';

export const DEFAULT_PHONE_REGION_CODE = 'US';

export const PHONE_VALIDATION_ERROR_CODES = [
  'invalid-type',
  'empty',
  'invalid-country-code',
  'too-short',
  'too-long',
  'invalid-format',
  'disallowed-country',
] as const;

export type PhoneValidationErrorCode =
  (typeof PHONE_VALIDATION_ERROR_CODES)[number];

export interface PhoneValidationError {
  code: PhoneValidationErrorCode;
  message: string;
}

type ErrorCatalog = Record<string, PhoneValidationError>;

const generateErrorDescription = (
  code: PhoneValidationErrorCode,
  message: string,
) => ({ code, message }) as const satisfies PhoneValidationError;

export const PHONE_VALIDATION_ERRORS = {
  invalidType: generateErrorDescription(
    'invalid-type',
    'Enter a valid phone number',
  ),
  empty: generateErrorDescription('empty', 'Enter a phone number'),
  invalidCountryCode: generateErrorDescription(
    'invalid-country-code',
    'Enter a valid country calling code',
  ),
  tooShort: generateErrorDescription('too-short', 'Phone number is too short'),
  tooLong: generateErrorDescription('too-long', 'Phone number is too long'),
  invalidFormat: generateErrorDescription(
    'invalid-format',
    'Enter a valid phone number',
  ),
  disallowedCountry: generateErrorDescription(
    'disallowed-country',
    'Enter a phone number from a supported country',
  ),
} satisfies ErrorCatalog;

export type PhoneValidationErrorMessages = Partial<
  Record<PhoneValidationErrorCode, string>
>;

export interface PhoneValidationOptions {
  allowedRegionCodes?: readonly string[];
  defaultRegionCode?: string;
  errorMessages?: PhoneValidationErrorMessages;
}

export interface NormalizedPhoneNumber {
  countryCode: number;
  e164: string;
  international: string;
  national: string;
  regionCode: string;
  significant: string;
}

export type NormalizePhoneResult =
  | {
      ok: true;
      value: NormalizedPhoneNumber;
    }
  | {
      error: PhoneValidationError;
      ok: false;
    };

const NORMALIZE_ERROR_BY_POSSIBILITY: Record<
  ParsedPhoneNumber['possibility'],
  PhoneValidationError
> = {
  invalid: PHONE_VALIDATION_ERRORS.invalidFormat,
  'invalid-country-code': PHONE_VALIDATION_ERRORS.invalidCountryCode,
  'too-long': PHONE_VALIDATION_ERRORS.tooLong,
  'too-short': PHONE_VALIDATION_ERRORS.tooShort,
  'is-possible': PHONE_VALIDATION_ERRORS.invalidFormat,
  unknown: PHONE_VALIDATION_ERRORS.invalidFormat,
};

const sanitizeRegion = (region?: string): string | undefined =>
  region?.trim().toUpperCase() || undefined;

const coerceAllowedRegions = (
  allowed: PhoneValidationOptions['allowedRegionCodes'],
): ReadonlySet<string> | null => {
  if (!allowed?.length) {
    return null;
  }

  return new Set(allowed.map((region) => region.toUpperCase()));
};

export function normalizePhone(
  input: unknown,
  options: PhoneValidationOptions = {},
): NormalizePhoneResult {
  if (typeof input !== 'string') {
    return { ok: false, error: PHONE_VALIDATION_ERRORS.invalidType };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: PHONE_VALIDATION_ERRORS.empty };
  }

  const normalizedAllowedRegions = coerceAllowedRegions(
    options.allowedRegionCodes,
  );

  const [firstAllowedRegion] = options.allowedRegionCodes ?? [];
  const defaultRegionCode = sanitizeRegion(
    options.defaultRegionCode ??
      (normalizedAllowedRegions ? firstAllowedRegion : undefined) ??
      DEFAULT_PHONE_REGION_CODE,
  );

  const parseOptions = trimmed.startsWith('+')
    ? undefined
    : defaultRegionCode
      ? { regionCode: defaultRegionCode }
      : undefined;

  let parsed: ParsedPhoneNumber;
  try {
    parsed = parsePhoneNumber(trimmed, parseOptions);
  } catch {
    return { ok: false, error: PHONE_VALIDATION_ERRORS.invalidFormat };
  }

  if (!parsed.valid) {
    return {
      ok: false,
      error: NORMALIZE_ERROR_BY_POSSIBILITY[parsed.possibility],
    };
  }

  const regionCode = sanitizeRegion(parsed.regionCode);

  if (
    normalizedAllowedRegions &&
    (!regionCode || !normalizedAllowedRegions.has(regionCode))
  ) {
    return { ok: false, error: PHONE_VALIDATION_ERRORS.disallowedCountry };
  }

  if (!parsed.number || !regionCode) {
    return { ok: false, error: PHONE_VALIDATION_ERRORS.invalidFormat };
  }

  const { e164, international, national, significant } = parsed.number;
  return {
    ok: true,
    value: {
      regionCode,
      countryCode: parsed.countryCode,
      e164,
      international,
      national,
      significant,
    },
  };
}

// Lightweight phone number validation for client-side feedback only.
// Returns an error descriptor if input is invalid; returns `null` if input is valid.
function validatePhone(
  input: unknown,
  options: PhoneValidationOptions = {},
): PhoneValidationError | null {
  const result = normalizePhone(input, options);
  if (result.ok) {
    return null;
  }

  const overrideMessage = options.errorMessages?.[result.error.code];
  if (!overrideMessage) {
    return result.error;
  }

  return {
    code: result.error.code,
    message: overrideMessage,
  };
}

export function isValidPhone(
  input: unknown,
  options?: PhoneValidationOptions,
): boolean {
  return validatePhone(input, options) === null;
}

export default validatePhone;
