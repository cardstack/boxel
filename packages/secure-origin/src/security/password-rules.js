// The rule a new Boxel password follows. Every form that makes one checks it
// and states it to a password manager: registration, password reset and the
// app's change-password frame. The Matrix server refuses a password longer
// than 512 characters, on registration and on a change.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 512;

// The rule in the syntax of the `passwordrules` attribute, from which a
// password manager generates a password the form accepts.
export const PASSWORD_RULES = `minlength: ${MIN_PASSWORD_LENGTH}; maxlength: ${MAX_PASSWORD_LENGTH};`;

// What is wrong with `password` as a new password, or undefined when nothing
// is. The longest is checked only here: a new-password input carries no
// `maxlength`, because a browser cuts a pasted password to it without a
// word, and the account would get a password other than the one copied.
export function newPasswordError(password) {
  if (!password) {
    return 'Password is missing';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`;
  }
  return undefined;
}
