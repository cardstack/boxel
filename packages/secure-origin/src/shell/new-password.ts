import { trackedObject } from '@ember/reactive/collections';

import { newPasswordError } from '../security/password-rules.js';

// A new password and its confirmation, as the app's registration and
// password reset forms ask for them: each checked when it loses focus, and
// its error cleared as it is typed into.

export function confirmError(
  password: string,
  confirm: string,
): string | undefined {
  return confirm === password ? undefined : 'Passwords do not match';
}

export class NewPassword {
  private state = trackedObject({
    password: '',
    confirm: '',
    passwordError: undefined as string | undefined,
    confirmError: undefined as string | undefined,
  });

  get password() {
    return this.state.password;
  }

  get confirm() {
    return this.state.confirm;
  }

  get passwordError() {
    return this.state.passwordError;
  }

  get confirmError() {
    return this.state.confirmError;
  }

  setPassword = (value: string) => {
    this.state.password = value;
    this.state.passwordError = undefined;
  };

  setConfirm = (value: string) => {
    this.state.confirm = value;
    this.state.confirmError = undefined;
  };

  checkPassword = () => {
    this.state.passwordError = newPasswordError(this.password);
  };

  checkConfirm = () => {
    this.state.confirmError = confirmError(this.password, this.confirm);
  };

  // Both filled in, with no error showing.
  get complete(): boolean {
    return Boolean(
      this.password &&
      this.confirm &&
      !this.passwordError &&
      !this.confirmError,
    );
  }

  get passwordValid(): boolean {
    return !newPasswordError(this.password);
  }

  get confirmValid(): boolean {
    return (
      Boolean(this.confirm) &&
      !this.confirmError &&
      this.confirm === this.password
    );
  }

  // Checks both, as leaving each would. Whether both are right.
  validate(): boolean {
    this.checkPassword();
    this.checkConfirm();
    return !this.passwordError && !this.confirmError;
  }
}
