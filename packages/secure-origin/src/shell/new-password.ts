import { tracked } from '@glimmer/tracking';

// A new password and its confirmation, as the app's registration and
// password reset forms ask for them: each checked when it loses focus, and
// its error cleared as it is typed into.

export const MIN_PASSWORD_LENGTH = 8;

export function passwordError(password: string): string | undefined {
  if (!password) {
    return 'Password is missing';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  return undefined;
}

export function confirmError(
  password: string,
  confirm: string,
): string | undefined {
  return confirm === password ? undefined : 'Passwords do not match';
}

export class NewPassword {
  @tracked password = '';
  @tracked confirm = '';
  @tracked passwordError: string | undefined;
  @tracked confirmError: string | undefined;

  setPassword = (value: string) => {
    this.password = value;
    this.passwordError = undefined;
  };

  setConfirm = (value: string) => {
    this.confirm = value;
    this.confirmError = undefined;
  };

  checkPassword = () => {
    this.passwordError = passwordError(this.password);
  };

  checkConfirm = () => {
    this.confirmError = confirmError(this.password, this.confirm);
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
    return Boolean(this.password) && !passwordError(this.password);
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
