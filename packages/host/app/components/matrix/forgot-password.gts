import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { v4 as uuidv4 } from 'uuid';

import {
  Button,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { eq, or } from '@cardstack/boxel-ui/helpers';

import {
  isMatrixError,
  isValidPassword,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

export type ResetPasswordParams = {
  sid: string;
  clientSecret: string;
};

interface Signature {
  Args: {
    returnToLogin: () => void;
    resetPasswordParams?: ResetPasswordParams;
  };
}

export default class ForgotPassword extends Component<Signature> {
  <template>
    {{#if
      (or (eq this.state.type 'initial') (eq this.state.type 'validateEmail'))
    }}
      <span class='title'>Forgot your password?</span>
      <p class='info'>Enter email to receive a reset password link.</p>
      <FieldContainer
        @label='Email Address'
        @tag='label'
        @vertical={{true}}
        class='field'
      >
        <BoxelInput
          data-test-email-field
          type='text'
          @errorMessage={{this.emailError}}
          @state={{this.emailInputState}}
          @value={{this.email}}
          @onInput={{this.setEmail}}
        />
      </FieldContainer>
      <div class='button-wrapper'>
        <Button
          class='button'
          data-test-reset-your-password-btn
          @kind='primary'
          @disabled={{this.isForgotPasswordBtnDisabled}}
          @loading={{this.sendEmailValidationTask.isRunning}}
          {{on 'click' this.sendEmailValidation}}
        >Reset Your Password</Button>
        <span class='or'>or</span>
        <Button
          class='button'
          data-test-cancel-reset-password-btn
          {{on 'click' @returnToLogin}}
        >Back to login</Button>
      </div>
    {{else if (eq this.state.type 'waitForEmailValidation')}}
      <span class='title' data-test-email-validation>Please check your email to
        reset your password</span>
      <ul class='email-validation-instruction'>
        {{! @glint-ignore Property 'email' should be exist on 'waitForEmailValidation' type }}
        <li>We've sent an email to <b>{{this.state.email}}</b></li>
        <li>Click on the link within the email to reset your password</li>
      </ul>
      <Button
        class='button'
        data-test-resend-validation-btn
        @kind='primary'
        @disabled={{this.sendEmailValidationTask.isRunning}}
        @loading={{this.sendEmailValidationTask.isRunning}}
        {{on 'click' this.resendEmailValidation}}
      >Resend Email</Button>
    {{else if (eq this.state.type 'resetPassword')}}
      <span class='title'>Reset your password</span>
      <FieldContainer
        @label='Enter New Password'
        @tag='label'
        @vertical={{true}}
        class='field'
      >
        <BoxelInput
          data-test-password-field
          type='password'
          @errorMessage={{this.passwordError}}
          @state={{this.passwordInputState}}
          @value={{this.password}}
          @onInput={{this.setPassword}}
          @onBlur={{this.checkPassword}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Re-Enter New Password'
        @tag='label'
        @vertical={{true}}
        class='field'
      >
        <BoxelInput
          data-test-confirm-password-field
          type='password'
          @errorMessage={{this.confirmPasswordError}}
          @state={{this.confirmPasswordInputState}}
          @value={{this.confirmPassword}}
          @onInput={{this.setConfirmPassword}}
          @onBlur={{this.checkConfirmPassword}}
        />
      </FieldContainer>
      <div class='button-wrapper'>
        <Button
          class='button'
          data-test-reset-password-btn
          @kind='primary'
          @disabled={{this.isResetPasswordBtnDisabled}}
          @loading={{this.resetPassword.isRunning}}
          {{on 'click' (perform this.resetPassword)}}
        >Reset Password</Button>
      </div>
      {{#if this.error}}
        <span class='error' data-test-reset-password-error>{{this.error}}</span>
      {{/if}}
    {{else if (eq this.state.type 'resetPasswordSuccess')}}
      <span class='title' data-test-reset-password-success>Your password is now
        reset</span>
      <p class='info'>Your password has been successfully reset. You can use the
        link below to sign into your Boxel account with your new password.</p>
      <div class='button-wrapper'>
        <Button
          class='button'
          data-test-back-to-login-btn
          @kind='primary'
          {{on 'click' @returnToLogin}}
        >Sign In to Boxel</Button>
      </div>
    {{/if}}

    <style>
      .title {
        font: 700 var(--boxel-font-med);
        margin-bottom: var(--boxel-sp);
      }
      .info {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-sm);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
      }
      .field {
        margin-top: var(--boxel-sp);
      }
      .field :deep(input:autofill) {
        transition:
          background-color 0s 600000s,
          color 0s 600000s;
      }
      .field :deep(.validation-icon-container.invalid) {
        display: none;
      }
      .field :deep(.boxel-input-group--invalid > :nth-last-child(2)) {
        border-top-right-radius: var(--boxel-input-group-border-radius);
        border-bottom-right-radius: var(--boxel-input-group-border-radius);
        border-right-width: var(--boxel-input-group-interior-border-width);
      }
      .field
        :deep(
          .boxel-input-group:not(.boxel-input-group--invalid)
            > :nth-last-child(2)
        ) {
        padding-right: 0;
      }
      .field :deep(.error-message) {
        margin-left: 0;
      }
      .button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        margin-top: var(--boxel-sp-lg);
      }
      .button-wrapper button {
        margin: 0;
        width: 100%;
      }
      .or {
        margin: var(--boxel-sp-sm);
        font: 500 var(--boxel-font-sm);
      }
      .button {
        --boxel-button-padding: var(--boxel-sp-sm) var(--boxel-sp-lg);
        width: fit-content;
        min-width: 148px;
      }
      .button :deep(.boxel-loading-indicator) {
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .email-validation-instruction {
        padding: 0;
        list-style-position: inside;
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
      }
      .email-validation-instruction li {
        margin-bottom: var(--boxel-sp-sm);
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-xxs) auto 0 auto;
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  @tracked private email: string | undefined;
  @tracked private emailError: string | undefined;
  @tracked private password: string | undefined;
  @tracked private confirmPassword: string | undefined;
  @tracked private passwordError: string | undefined;
  @tracked private confirmPasswordError: string | undefined;
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
  @service private declare matrixService: MatrixService;

  constructor(owner: Owner, args: any) {
    super(owner, args);

    if (this.args.resetPasswordParams) {
      this.state = {
        type: 'resetPassword',
      };
    }
  }

  private get isForgotPasswordBtnDisabled() {
    return (
      !this.email || this.emailError || this.sendEmailValidationTask.isRunning
    );
  }

  private get isResetPasswordBtnDisabled() {
    return (
      !this.password ||
      !this.confirmPassword ||
      this.passwordError ||
      this.confirmPasswordError ||
      this.resetPassword.isRunning
    );
  }

  @action
  private setEmail(email: string) {
    this.email = email;
    this.emailError = undefined;
  }

  @action
  private setPassword(password: string) {
    this.password = password;
    this.passwordError = undefined;
    this.error = undefined;
  }

  @action
  private setConfirmPassword(confirmPassword: string) {
    this.confirmPassword = confirmPassword;
    this.confirmPasswordError = undefined;
    this.error = undefined;
  }

  @action
  private checkPassword() {
    if (!this.password) {
      this.passwordError = 'Password is missing';
    } else if (!isValidPassword(this.password)) {
      this.passwordError =
        'Password must be at least 8 characters long and include a number and a symbol';
    }
  }

  @action
  private checkConfirmPassword() {
    if (this.confirmPassword !== this.password) {
      this.confirmPasswordError = 'Passwords do not match';
    }
  }

  private get emailInputState() {
    return this.emailError ? 'invalid' : 'initial';
  }

  private get passwordInputState() {
    return this.passwordError ? 'invalid' : 'initial';
  }

  private get confirmPasswordInputState() {
    return this.confirmPasswordError ? 'invalid' : 'initial';
  }

  @action
  private sendEmailValidation() {
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
      let { sid } = await this.matrixService.client.requestPasswordEmailToken(
        this.state.email,
        clientSecret,
        this.state.sendAttempt,
        window.location.href + `&clientSecret=${clientSecret}`,
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
    if (this.state.type !== 'resetPassword') {
      throw new Error(
        `invalid state: cannot resetPassword() in state ${this.state.type}`,
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: reset password button disabled when no password`,
      );
    } else if (!this.args.resetPasswordParams) {
      throw new Error(
        `bug: should never get here: reset password params is required for resetting password`,
      );
    }

    try {
      await this.matrixService.client.setPassword(
        {
          threepid_creds: {
            sid: this.args.resetPasswordParams.sid,
            client_secret: this.args.resetPasswordParams.clientSecret,
          },
          type: 'm.login.email.identity',
        },
        this.password,
        true,
      );
      this.state = {
        ...this.state,
        type: 'resetPasswordSuccess',
      };
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = 'Please check your email to validate reset password';
        setTimeout(() => (this.error = undefined), 2000);
      }

      throw e;
    }
  });
}
