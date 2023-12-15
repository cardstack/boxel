import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import {
  Button,
  FieldContainer,
  BoxelHeader,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';
import { eq } from '@cardstack/boxel-ui/helpers';

import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { v4 as uuidv4 } from 'uuid';

interface Signature {
  Args: {
    onLogin: () => void;
  };
}

export default class ForgotPassword extends Component<Signature> {
  <template>
    <div class='forgot-password-form' data-test-forgot-password-form>
      <BoxelHeader @title='Boxel' @hasBackground={{false}} class='header'>
        <:icon>
          <BoxelIcon />
        </:icon>
      </BoxelHeader>
      <div class='content'>
        {{#if (eq this.state.type 'initial')}}
          <span class='title'>Forget your password?</span>
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
          <Button
            class='button'
            data-test-forgot-password-btn
            @kind='primary'
            @disabled={{this.isForgotPasswordBtnDisabled}}
            {{on 'click' this.sendEmailValidation}}
          >Reset Your Password</Button>
        {{else if (eq this.state.type 'waitForEmailValidation')}}
          <span class='title'>Please check your email to reset your password</span>
          <ul class='email-validation-instruction'>
            {{! @glint-ignore Property 'email' should be exist on 'waitForEmailValidation' type }}
            <li>We've sent an email to <b>{{this.state.email}}</b></li>
            <li>Click on the link within the email to validate it's your email
              address</li>
            <li>Click "I have validated email" button to reset password</li>
          </ul>
          <div class='button-wrapper'>
            <Button
              class='button'
              data-test-resend-validation-btn
              @kind='primary'
              @disabled={{this.sendEmailValidationTask.isRunning}}
              {{on 'click' this.continueToResetPassword}}
            >I have validated email</Button>
            <span class='or'>or</span>
            <Button
              class='button'
              data-test-resend-validation-btn
              @disabled={{this.sendEmailValidationTask.isRunning}}
              {{on 'click' this.resendEmailValidation}}
            >Resend Email</Button>
          </div>
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
            @label='Re Enter New Password'
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
          <Button
            class='button'
            data-test-forgot-password-btn
            @kind='primary'
            @disabled={{this.isResetPasswordBtnDisabled}}
            style='width: 100%'
            {{on 'click' (perform this.resetPassword)}}
          >Reset Password</Button>
          {{#if this.error}}
            <span class='error'>{{this.error}}</span>
          {{/if}}
        {{else if (eq this.state.type 'resetPasswordSuccess')}}
          <span class='title'>Your password is now reset</span>
          <p class='info'>Your password has been successfully reset. You can use
            the link below to sign into your Boxel account with your new
            password.</p>
          <Button
            class='button'
            data-test-forgot-password-btn
            @kind='primary'
            @disabled={{this.isForgotPasswordBtnDisabled}}
            style='width: 100%'
            {{on 'click' @onLogin}}
          >Sign In to Boxel</Button>
        {{/if}}
      </div>
    </div>

    <style>
      .forgot-password-form {
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        letter-spacing: var(--boxel-lsp);
        width: 550px;
        position: relative;
      }
      .header {
        --boxel-header-icon-width: var(--boxel-icon-med);
        --boxel-header-icon-height: var(--boxel-icon-med);
        --boxel-header-padding: var(--boxel-sp);
        --boxel-header-text-size: var(--boxel-font);

        background-color: var(--boxel-light);
        text-transform: uppercase;
        max-width: max-content;
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
        letter-spacing: var(--boxel-lsp-lg);
      }
      .content {
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp) var(--boxel-sp-xl) calc(var(--boxel-sp) * 2)
          var(--boxel-sp-xl);
      }
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
        --boxel-button-padding: var(--boxel-sp-sm);
        width: fit-content;
        margin-top: var(--boxel-sp-lg);
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
        email: string;
        sendAttempt: number;
        clientSecret: string;
        sid: string;
      }
    | { type: 'resetPasswordSuccess' } = {
    type: 'initial',
  };
  @service private declare matrixService: MatrixService;

  private get isForgotPasswordBtnDisabled() {
    return !this.email || this.error || this.sendEmailValidationTask.isRunning;
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
    } else if (
      !/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{8,}$/.test(
        this.password,
      )
    ) {
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

  @action
  private continueToResetPassword() {
    if (this.state.type !== 'waitForEmailValidation') {
      throw new Error(
        `invalid state: cannot continueToResetPassword() in state ${this.state.type}`,
      );
    }

    this.state = {
      ...this.state,
      type: 'resetPassword',
    };
  }

  private resetPassword = restartableTask(async () => {
    if (this.state.type !== 'resetPassword') {
      throw new Error(
        `invalid state: cannot resetPassword() in state ${this.state.type}`,
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: reset password button disabled when no password`,
      );
    }

    try {
      await this.matrixService.client.setPassword(
        {
          threepid_creds: {
            sid: this.state.sid,
            client_secret: this.state.clientSecret,
          },
          type: 'm.login.email.identity',
        },
        this.password,
      );
      this.state = {
        ...this.state,
        type: 'resetPasswordSuccess',
      };
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = 'Please make sure you have validated your email';
        setTimeout(() => (this.error = undefined), 2000);
      }

      throw e;
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface ForgotPassword {
    'Matrix::ForgotPassword': typeof ForgotPassword;
  }
}
