// TODO
export type PhoneValidationErrorCode = '';

export interface PhoneValidationError {
  code: PhoneValidationErrorCode;
  message: string;
}

// const generateErrorDescription = (
//   code: PhoneValidationErrorCode,
//   message: string,
// ) => ({ code, message });

// Lightweight phone number validation for client-side feedback only.
// Returns an error descriptor if input is invalid; returns `null` if input is valid.
function validatePhone(_input: unknown): PhoneValidationError | null {
  // TODO
  return null;
}

export function isValidPhone(input: unknown): boolean {
  return validatePhone(input) === null;
}

export default validatePhone;
