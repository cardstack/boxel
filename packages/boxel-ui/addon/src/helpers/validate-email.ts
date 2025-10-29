export type EmailValidationErrorCode =
  | 'not-a-string'
  | 'missing-value'
  | 'missing-at-symbol'
  | 'multiple-at-symbols'
  | 'missing-local-part'
  | 'missing-domain-part'
  | 'invalid-local-part-character'
  | 'invalid-local-part-dots'
  | 'invalid-domain-character'
  | 'domain-missing-period'
  | 'domain-empty-label'
  | 'domain-leading-trailing-hyphen'
  | 'domain-whitespace';

export interface EmailValidationError {
  code: EmailValidationErrorCode;
  message: string;
}

function createError(
  code: EmailValidationErrorCode,
  message: string,
): EmailValidationError {
  return { code, message };
}

// Lightweight email validation for client-side feedback only. Returns `null`
// for valid email addresses and an error descriptor otherwise so callers can
// surface a more helpful message.
export function validateEmail(input: unknown): EmailValidationError | null {
  if (typeof input !== 'string') {
    return createError('not-a-string', 'Enter a valid email address');
  }

  const value = input.trim();
  if (value === '') {
    return createError('missing-value', 'Enter an email address');
  }

  const firstAt = value.indexOf('@');
  if (firstAt === -1) {
    return createError('missing-at-symbol', 'Email must include an "@" symbol');
  }
  if (firstAt !== value.lastIndexOf('@')) {
    return createError(
      'multiple-at-symbols',
      'Email can contain only one "@" symbol',
    );
  }

  const localPart = value.slice(0, firstAt);
  const domainPart = value.slice(firstAt + 1);

  if (!localPart) {
    return createError('missing-local-part', 'Enter a value before "@"');
  }
  if (!domainPart) {
    return createError('missing-domain-part', 'Enter a domain after "@"');
  }

  if (localPart.includes('\r') || localPart.includes('\n')) {
    return createError(
      'invalid-local-part-character',
      'The part before "@" cannot include line breaks',
    );
  }
  // eslint-disable-next-line no-useless-escape -- character class needs escaped '[' and '\\'
  if (/[\s"(),:;<>@\[\]\\]/u.test(localPart)) {
    return createError(
      'invalid-local-part-character',
      'The part before "@" contains invalid characters',
    );
  }
  if (
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return createError(
      'invalid-local-part-dots',
      'The part before "@" cannot start or end with "." or contain consecutive dots',
    );
  }

  if (/[@\s]/u.test(domainPart)) {
    return createError(
      'invalid-domain-character',
      'The domain contains invalid characters',
    );
  }

  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) {
    return createError(
      'domain-missing-period',
      'Domain must include a period, like "example.com"',
    );
  }

  for (const label of domainLabels) {
    if (label.length === 0) {
      return createError('domain-empty-label', 'Domain labels cannot be empty');
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return createError(
        'domain-leading-trailing-hyphen',
        'Domain labels cannot start or end with a hyphen',
      );
    }
    if (label.includes('\r') || label.includes('\n') || /\s/u.test(label)) {
      return createError(
        'domain-whitespace',
        'Domain labels cannot contain whitespace',
      );
    }
  }

  return null;
}

export function isValidEmail(input: unknown): boolean {
  return validateEmail(input) === null;
}

export default isValidEmail;
