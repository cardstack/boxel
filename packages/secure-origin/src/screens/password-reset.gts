// The steps of resetting a forgotten password, as both origins draw them:
// asking for the reset link, waiting for it to be followed, setting the new
// password, and the password set. They hold no state and send nothing; the
// caller decides what each control does. The new password fields are the
// caller's, in the reset form's block: on the secure origin its own inputs, in
// the app the credential frame.
//
// Each control carries the test attributes of both origins' suites.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import AuthButton from '../components/auth-button.gts';
import AuthFormField from '../components/auth-form-field.gts';
import BoxelInput from '../components/input.gts';
import optional from '../helpers/optional.ts';
import { autofocus } from '../modifiers/autofocus.ts';

interface ForgotPasswordFormSignature {
  Args: {
    email?: string;
    emailError?: string;
    submitDisabled?: boolean;
    submitting?: boolean;
    // Focuses the email field as the form is drawn.
    autofocus?: boolean;
    onEmailInput: (value: string) => void;
    onSubmit: (event: Event) => void;
    onSignIn: (event: Event) => void;
  };
}

export const ForgotPasswordForm: TemplateOnlyComponent<ForgotPasswordFormSignature> =
  <template>
    <form
      class='step'
      novalidate
      data-test-forgot-password-form
      {{on 'submit' @onSubmit}}
    >
      <span
        class='title'
        role='heading'
        aria-level='1'
        data-test-secure-title
      >Forgot your password?</span>
      <p class='info'>Enter email to receive a reset password link.</p>
      <AuthFormField
        @label='Email Address'
        data-test-secure-field='email'
        as |labelId|
      >
        <BoxelInput
          aria-labelledby={{labelId}}
          data-test-email-field
          name='email'
          autocomplete='email'
          @type='text'
          @errorMessage={{@emailError}}
          @state={{if @emailError 'invalid' 'initial'}}
          @value={{@email}}
          @onInput={{@onEmailInput}}
          {{autofocus (if @autofocus true false)}}
        />
      </AuthFormField>
      <div class='button-wrapper'>
        <AuthButton
          data-test-reset-your-password-btn
          type='submit'
          @variant='primary'
          @disabled={{@submitDisabled}}
          @loading={{@submitting}}
        >Reset Your Password</AuthButton>
        <div>or</div>
        <AuthButton
          data-test-cancel-reset-password-btn
          type='button'
          @variant='secondary'
          {{on 'click' @onSignIn}}
        >Back to login</AuthButton>
      </div>
    </form>
    <style scoped>
      .step {
        display: contents;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp);
      }
      .info {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-sm);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--foreground);
      }
      .button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        margin-top: var(--boxel-sp-lg);
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>;

interface ResetEmailSentSignature {
  Args: {
    // The address the reset link was sent to.
    email: string;
    resending?: boolean;
    onResend: (event: Event) => void;
  };
  // A notice under the heading, such as how long the CLI waits.
  Blocks: { default: [] };
}

// Waiting for the user to follow the reset link in their email.
export const ResetEmailSent: TemplateOnlyComponent<ResetEmailSentSignature> =
  <template>
    <span
      class='title'
      role='heading'
      aria-level='1'
      data-test-secure-title
      data-test-email-validation
    >Please check your email to reset your password</span>
    {{yield}}
    <ul class='email-validation-instruction'>
      <li>We've sent an email to <b>{{@email}}</b></li>
      <li>Click on the link within the email to reset your password</li>
    </ul>
    <AuthButton
      data-test-resend-validation-btn
      @variant='primary'
      @disabled={{@resending}}
      @loading={{@resending}}
      {{on 'click' @onResend}}
    >Resend Email</AuthButton>
    <style scoped>
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp);
      }
      .email-validation-instruction {
        padding: 0;
        list-style-position: inside;
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        color: var(--foreground);
      }
      .email-validation-instruction li {
        margin-bottom: var(--boxel-sp-sm);
      }
    </style>
  </template>;

interface ResetPasswordFormSignature {
  Args: {
    submitDisabled?: boolean;
    submitting?: boolean;
    // The reset link's parameters were refused: the user starts again from
    // the forgot password form, which `@forgotPasswordURL` and
    // `@onForgotPassword` lead to.
    paramsError?: boolean;
    forgotPasswordURL: string;
    onForgotPassword?: (event: Event) => void;
    error?: string;
    onSubmit: (event: Event) => void;
  };
  Blocks: { default: [] };
}

export const ResetPasswordForm: TemplateOnlyComponent<ResetPasswordFormSignature> =
  <template>
    <form
      class='step'
      novalidate
      data-test-reset-password-form
      {{on 'submit' @onSubmit}}
    >
      <span
        class='title'
        role='heading'
        aria-level='1'
        data-test-secure-title
      >Reset your password</span>
      {{yield}}
      <div class='button-wrapper'>
        <AuthButton
          data-test-reset-password-btn
          type='submit'
          @variant='primary'
          @disabled={{@submitDisabled}}
          @loading={{@submitting}}
        >Reset Password</AuthButton>
      </div>
      {{#if @paramsError}}
        <span
          class='error'
          role='alert'
          data-test-reset-password-error
          data-test-secure-error
        >Unable to reset your password due to invalid password reset parameters.
          Please restart the password reset flow by going back to
          <a
            href={{@forgotPasswordURL}}
            data-test-forgot-password-link
            {{on 'click' (optional @onForgotPassword)}}
          >forgot password form</a>
          and try again.</span>
      {{else if @error}}
        <span
          class='error'
          role='alert'
          data-test-reset-password-error
          data-test-secure-error
        >{{@error}}</span>
      {{/if}}
    </form>
    <style scoped>
      .step {
        display: contents;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp);
      }
      .button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        margin-top: var(--boxel-sp-lg);
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
        text-align: center;
      }
      .error a {
        color: var(--boxel-highlight);
        text-decoration: underline;
      }
    </style>
  </template>;

interface ResetPasswordDoneSignature {
  Args: {
    onSignIn: (event: Event) => void;
  };
  // A notice above Sign In, such as how long the CLI waits.
  Blocks: { default: [] };
}

export const ResetPasswordDone: TemplateOnlyComponent<ResetPasswordDoneSignature> =
  <template>
    <span
      class='title'
      role='heading'
      aria-level='1'
      data-test-secure-title
      data-test-reset-password-success
    >Your password is now reset</span>
    <p class='info'>Your password has been successfully reset. You can use the
      link below to sign into your Boxel account with your new password.</p>
    {{yield}}
    <div class='button-wrapper'>
      <AuthButton
        data-test-back-to-login-btn
        type='button'
        @variant='primary'
        {{on 'click' @onSignIn}}
      >Sign In to Boxel</AuthButton>
    </div>
    <style scoped>
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp);
      }
      .info {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-sm);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--foreground);
      }
      .button-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        margin-top: var(--boxel-sp-lg);
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>;
