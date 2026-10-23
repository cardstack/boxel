import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  ForgotPasswordForm,
  ResetEmailSent,
  ResetPasswordDone,
  ResetPasswordForm,
} from '@cardstack/secure-origin/screens/password-reset.gts';
import { restartableTask } from 'ember-concurrency';

import { v4 as uuidv4 } from 'uuid';

import { eq, or } from '@cardstack/boxel-ui/helpers';

import {
  CredentialFields,
  credentialFieldsError,
} from '@cardstack/host/lib/credential-fields';
import { isMatrixError } from '@cardstack/host/lib/matrix-utils';

import type MatrixService from '@cardstack/host/services/matrix-service';

import CredentialFieldsFrame from './credential-fields';

import type { AuthMode } from './auth';

export type ResetPasswordParams = {
  sid: string;
  clientSecret: string;
  // The email address the reset link was sent to, which names the account
  // whose secure sessions end once the new password is set. A link that
  // carries none still resets the password.
  email?: string;
};

interface Signature {
  Args: {
    setMode: (mode: AuthMode) => void;
    nullifyResetPasswordParams?: () => void;
    resetPasswordParams?: ResetPasswordParams;
  };
}

export default class ForgotPassword extends Component<Signature> {
  <template>
    {{#if
      (or (eq this.state.type 'initial') (eq this.state.type 'validateEmail'))
    }}
      <ForgotPasswordForm
        @email={{this.email}}
        @emailError={{this.emailError}}
        @submitDisabled={{this.isForgotPasswordBtnDisabled}}
        @submitting={{this.sendEmailValidationTask.isRunning}}
        @onEmailInput={{this.setEmail}}
        @onSubmit={{this.sendEmailValidation}}
        @onSignIn={{fn @setMode 'login'}}
      />
    {{else if (eq this.state.type 'waitForEmailValidation')}}
      <ResetEmailSent
        @email={{this.sentTo}}
        @resending={{this.sendEmailValidationTask.isRunning}}
        @onResend={{this.resendEmailValidation}}
      />
    {{else if (eq this.state.type 'resetPassword')}}
      <ResetPasswordForm
        @submitDisabled={{this.isResetPasswordBtnDisabled}}
        @submitting={{this.resetPassword.isRunning}}
        @paramsError={{this.isResetPasswordParamsError}}
        @forgotPasswordURL='#'
        @onForgotPassword={{this.returnToInitialForm}}
        @error={{this.error}}
        @onSubmit={{this.submitNewPassword}}
      >
        <CredentialFieldsFrame @form='reset' @fields={{this.credentials}} />
      </ResetPasswordForm>
    {{else if (eq this.state.type 'resetPasswordSuccess')}}
      <ResetPasswordDone @onSignIn={{this.returnToLogin}} />
    {{/if}}
  </template>

  @tracked private error: string | undefined;
  @tracked private isResetPasswordParamsError = false;
  @tracked private email: string | undefined;
  @tracked private emailError: string | undefined;
  // The new password and its confirmation are typed into a frame on the
  // secure origin, which sets the password.
  private credentials = new CredentialFields();
  @tracked private state:
    | { type: 'initial' }
    | { type: 'validateEmail'; email: string; sendAttempt: number }
    | {
        type: 'waitForEmailValidation';
        email: string;
        sendAttempt: number;
        clientSecret: string;
        sid: string;
      }
    | {
        type: 'resetPassword';
      }
    | { type: 'resetPasswordSuccess' } = {
    type: 'initial',
  };
  @service declare private matrixService: MatrixService;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.credentials.onInput = () => (this.error = undefined);

    if (this.args.resetPasswordParams) {
      this.state = {
        type: 'resetPassword',
      };
    }
  }

  private get isForgotPasswordBtnDisabled() {
    return Boolean(
      !this.email || this.emailError || this.sendEmailValidationTask.isRunning,
    );
  }

  private get isResetPasswordBtnDisabled() {
    return Boolean(!this.credentials.complete || this.resetPassword.isRunning);
  }

  @action
  private setEmail(email: string) {
    this.email = email;
    this.emailError = undefined;
  }

  // The address the reset link was sent to.
  private get sentTo() {
    return this.state.type === 'waitForEmailValidation' ? this.state.email : '';
  }

  @action
  private sendEmailValidation(ev: Event) {
    ev.preventDefault();
    if (!this.email) {
      throw new Error(
        `bug: should never get here: reset password button disabled when no email`,
      );
    }

    this.state = {
      type: 'validateEmail',
      email: this.email,
      sendAttempt: 1,
    };
    this.sendEmailValidationTask.perform();
  }

  @action
  private resendEmailValidation() {
    if (this.state.type !== 'waitForEmailValidation') {
      throw new Error(
        `invalid state: cannot resendEmailValidation() in state ${this.state.type}`,
      );
    }

    this.state = {
      ...this.state,
      sendAttempt: this.state.sendAttempt++,
    };
    this.sendEmailValidationTask.perform();
  }

  private sendEmailValidationTask = restartableTask(async () => {
    if (
      this.state.type === 'initial' ||
      this.state.type === 'resetPassword' ||
      this.state.type === 'resetPasswordSuccess'
    ) {
      throw new Error(
        `invalid state: cannot sendEmailValidation() in state ${this.state.type}`,
      );
    }

    try {
      let clientSecret = uuidv4();
      let redirectUrl = new URL(window.location.href);
      redirectUrl.searchParams.set('clientSecret', clientSecret);
      // In the fragment, which never leaves the browser, so the address
      // isn't recorded in an access log. The Matrix server adds the
      // validation session's id to the end of the link, which puts it in the
      // fragment too (see `Auth`).
      redirectUrl.hash = new URLSearchParams({
        email: this.state.email,
      }).toString();

      let { sid } = await this.matrixService.requestPasswordEmailToken(
        this.state.email,
        clientSecret,
        this.state.sendAttempt,
        redirectUrl.toString(),
      );

      this.state = {
        ...this.state,
        type: 'waitForEmailValidation',
        clientSecret,
        sid,
      };
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.emailError = 'No account with the given email address exists';
      }
      if (this.state.type === 'validateEmail') {
        this.state = {
          type: 'initial',
        };
      }

      throw e;
    }
  });

  private resetPassword = restartableTask(async () => {
    if (!(await this.credentials.validate())) {
      return;
    }
    if (this.state.type !== 'resetPassword') {
      throw new Error(
        `invalid state: cannot resetPassword() in state ${this.state.type}`,
      );
    } else if (!this.credentials.complete) {
      throw new Error(
        `bug: should never get here: reset password button disabled when no password`,
      );
    } else if (!this.args.resetPasswordParams) {
      throw new Error(
        `bug: should never get here: reset password params is required`,
      );
    }

    try {
      let result = await this.credentials.submit({
        operation: 'set-password',
        args: {
          auth: {
            threepid_creds: {
              sid: this.args.resetPasswordParams.sid,
              client_secret: this.args.resetPasswordParams.clientSecret,
            },
            type: 'm.login.email.identity',
          },
          account: this.args.resetPasswordParams.email,
        },
      });
      if (!result.ok) {
        throw credentialFieldsError(result);
      }
      this.state = {
        ...this.state,
        type: 'resetPasswordSuccess',
      };
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.isResetPasswordParamsError = true;
      } else {
        this.error =
          'An unknown error happened. Please try again, or contact support if the problem persists.';
      }

      throw e;
    }
  });

  @action
  private submitNewPassword(ev: Event) {
    ev.preventDefault();
    this.resetPassword.perform();
  }

  @action
  private returnToInitialForm() {
    this.args.nullifyResetPasswordParams?.();
    this.args.setMode('forgot-password');
    this.state = {
      type: 'initial',
    };
  }

  @action
  private returnToLogin() {
    this.args.nullifyResetPasswordParams?.();
    this.args.setMode('login');
  }
}
