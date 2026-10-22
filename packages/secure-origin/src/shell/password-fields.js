/* eslint-env browser */
// A new password and its confirmation, as the app's registration and
// password reset forms ask for them: each checked when it loses focus, its
// error cleared as it is typed into, and, where the form shows them, a hint
// once each is right.

import { field } from './dom.js';

const MIN_PASSWORD_LENGTH = 8;

// `labels` names the two fields; `placeholders` and `hints` are the
// registration form's. `onChange` hears of every change to either.
export function newPasswordFields({ labels, placeholders, hints, onChange }) {
  let password = field({
    label: labels[0],
    testId: 'password',
    input: {
      type: 'password',
      name: 'password',
      autocomplete: 'new-password',
      placeholder: placeholders?.[0],
      'data-test-password-field': true,
    },
  });
  let confirm = field({
    label: labels[1],
    testId: 'confirm-password',
    input: {
      type: 'password',
      name: 'confirm-password',
      autocomplete: 'new-password',
      placeholder: placeholders?.[1],
      'data-test-confirm-password-field': true,
    },
  });

  function validatePassword() {
    let value = password.input.value;
    if (!value) {
      password.setError('Password is missing');
    } else if (value.length < MIN_PASSWORD_LENGTH) {
      password.setError('Password must be at least 8 characters long');
    }
  }

  function validateConfirm() {
    if (confirm.input.value !== password.input.value) {
      confirm.setError('Passwords do not match');
    }
  }

  function refreshHints() {
    if (!hints) {
      return;
    }
    let value = password.input.value;
    password.setHint(
      value && !password.error && value.length >= MIN_PASSWORD_LENGTH
        ? { text: 'password is valid', testId: 'password-valid' }
        : undefined,
    );
    confirm.setHint(
      confirm.input.value && !confirm.error && confirm.input.value === value
        ? { text: 'passwords match', testId: 'passwords-match' }
        : undefined,
    );
  }

  for (let [entry, validate] of [
    [password, validatePassword],
    [confirm, validateConfirm],
  ]) {
    entry.input.addEventListener('input', () => {
      entry.setError(undefined);
      refreshHints();
      onChange?.();
    });
    entry.input.addEventListener('blur', () => {
      validate();
      refreshHints();
      onChange?.();
    });
  }

  return {
    elements: [password.element, confirm.element],
    get value() {
      return password.input.value;
    },
    // Both filled in, with no error showing.
    get complete() {
      return Boolean(
        password.input.value &&
        confirm.input.value &&
        !password.error &&
        !confirm.error,
      );
    },
    // Checks both, as leaving each would. Whether both are right.
    validate() {
      validatePassword();
      validateConfirm();
      refreshHints();
      onChange?.();
      return !password.error && !confirm.error;
    },
    focus() {
      password.input.focus();
    },
  };
}
