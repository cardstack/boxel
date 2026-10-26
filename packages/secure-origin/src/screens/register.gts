// The steps of creating a Boxel account, as both origins draw them: the
// registration form, the invite code the Matrix server may ask for, the wait
// for the email address to be validated, and the wait while the account is set
// up. They hold no state and send nothing; the caller decides what each
// control does. The password fields are the caller's, in the form's block: on
// the secure origin its own inputs, in the app the credential frame.
//
// Each control carries the test attributes of both origins' suites.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import AuthButton from '../components/auth-button.gts';
import AuthFormField from '../components/auth-form-field.gts';
import CheckMark from '../components/icons/check-mark.gts';
import BoxelInput from '../components/input.gts';
import InputGroup, {
  type InputGroupValidationState,
} from '../components/input-group.gts';
import LoadingIndicator from '../components/loading-indicator.gts';
import ValidationHint from '../components/validation-hint.gts';
import { autofocus } from '../modifiers/autofocus.ts';

interface RegisterFormSignature {
  Args: {
    // The title's heading level, 1 when not given. A page with a heading of
    // its own above the screen passes 2.
    headingLevel?: number;
    name: string;
    email: string;
    username: string;
    // The Matrix server's name, shown after the username.
    serverName?: string;
    nameError?: string;
    emailError?: string;
    usernameError?: string;
    usernameState: InputGroupValidationState;
    // Shows "name available" under the username.
    usernameAvailable?: boolean;
    formError?: string;
    submitDisabled?: boolean;
    submitting?: boolean;
    // Hides the form while it stays drawn, for a caller whose password fields
    // must outlive the form's step.
    hidden?: boolean;
    // Focuses the name field as the form is drawn.
    autofocus?: boolean;
    onNameInput: (value: string) => void;
    onNameBlur: (event: Event) => void;
    onEmailInput: (value: string) => void;
    onEmailBlur: (event: Event) => void;
    onUsernameInput: (value: string) => void;
    onUsernameBlur: (event: Event) => void;
    onSubmit: (event: Event) => void;
    onSignIn: (event: Event) => void;
  };
  Blocks: { default: [] };
}

function fieldState(error: string | undefined) {
  return error ? 'invalid' : 'initial';
}

export const RegisterForm: TemplateOnlyComponent<RegisterFormSignature> =
  <template>
    <div class='registration-page' hidden={{@hidden}} data-test-register-page>
      <span
        class='title'
        role='heading'
        aria-level={{if @headingLevel @headingLevel 1}}
        data-test-secure-title
      >Create a Boxel Account</span>
      <form novalidate data-test-register-form {{on 'submit' @onSubmit}}>
        <AuthFormField
          @label='Your Name'
          data-test-secure-field='name'
          as |labelId|
        >
          <BoxelInput
            aria-labelledby={{labelId}}
            data-test-name-field
            name='name'
            autocomplete='name'
            @state={{fieldState @nameError}}
            @value={{@name}}
            placeholder='Enter your name'
            @errorMessage={{@nameError}}
            @onInput={{@onNameInput}}
            @onBlur={{@onNameBlur}}
            {{autofocus (if @autofocus true false)}}
          />
        </AuthFormField>
        <AuthFormField
          @label='Email'
          data-test-secure-field='email'
          as |labelId|
        >
          <BoxelInput
            aria-labelledby={{labelId}}
            data-test-email-field
            name='email'
            autocomplete='email'
            @state={{fieldState @emailError}}
            @value={{@email}}
            placeholder='Enter your email'
            @errorMessage={{@emailError}}
            @onInput={{@onEmailInput}}
            @onBlur={{@onEmailBlur}}
          />
        </AuthFormField>
        <AuthFormField
          @label='Username'
          data-test-secure-field='username'
          as |labelId|
        >
          <InputGroup
            data-test-username-field
            @labelledBy={{labelId}}
            @name='username'
            @autocomplete='username'
            @state={{@usernameState}}
            @value={{@username}}
            @placeholder='Your username'
            @errorMessage={{@usernameError}}
            @onInput={{@onUsernameInput}}
            @onBlur={{@onUsernameBlur}}
            @validIcon={{CheckMark}}
          >
            <:before as |Accessories|>
              <Accessories.Text class='username-prefix'>@</Accessories.Text>
            </:before>
            <:after as |Accessories|>
              <Accessories.Text
                data-input-group-suffix
                data-test-input-group-suffix
              >{{@serverName}}</Accessories.Text>
            </:after>
          </InputGroup>
          {{#if @usernameAvailable}}
            <ValidationHint data-test-username-available>name available</ValidationHint>
          {{/if}}
        </AuthFormField>
        {{yield}}
        {{#if @formError}}
          <div
            class='error-message'
            role='alert'
            data-test-register-user-error
            data-test-secure-error
          >{{@formError}}</div>
        {{/if}}
        <div class='button-wrapper'>
          <AuthButton
            data-test-register-btn
            type='submit'
            @variant='primary'
            @disabled={{@submitDisabled}}
            @loading={{@submitting}}
          >Create Account</AuthButton>
          <div>or</div>
          <AuthButton
            data-test-cancel-btn
            type='button'
            @variant='secondary'
            {{on 'click' @onSignIn}}
          >Login with an existing account</AuthButton>
        </div>
      </form>
    </div>
    <style scoped>
      .registration-page {
        display: contents;
      }
      .registration-page[hidden] {
        display: none;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .button-wrapper {
        width: 100%;
        margin-top: var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
      .username-prefix {
        padding-right: 0;
      }
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
    </style>
  </template>;

interface InviteCodeFormSignature {
  Args: {
    // The title's heading level, 1 when not given. A page with a heading of
    // its own above the screen passes 2.
    headingLevel?: number;
    token: string;
    tokenError?: string;
    submitDisabled?: boolean;
    submitting?: boolean;
    // Focuses the invite code field as the form is drawn.
    autofocus?: boolean;
    onTokenInput: (value: string) => void;
    onSubmit: (event: Event) => void;
  };
}

export const InviteCodeForm: TemplateOnlyComponent<InviteCodeFormSignature> =
  <template>
    <form
      class='step'
      novalidate
      data-test-token-page
      {{on 'submit' @onSubmit}}
    >
      <span
        class='title'
        role='heading'
        aria-level={{if @headingLevel @headingLevel 1}}
        data-test-secure-title
      >Boxel is currently invite-only.<br />Enter your invite code here.</span>
      <AuthFormField
        @label='Your invite code'
        data-test-secure-field='token'
        as |labelId|
      >
        <BoxelInput
          aria-labelledby={{labelId}}
          data-test-token-field
          name='invite-code'
          autocomplete='off'
          @state={{fieldState @tokenError}}
          @value={{@token}}
          placeholder='Enter invite code'
          @errorMessage={{@tokenError}}
          @onInput={{@onTokenInput}}
          {{autofocus (if @autofocus true false)}}
        />
      </AuthFormField>
      <div class='button-wrapper'>
        <AuthButton
          data-test-next-btn
          type='submit'
          @variant='primary'
          @disabled={{@submitDisabled}}
          @loading={{@submitting}}
        >Next</AuthButton>
      </div>
    </form>
    <style scoped>
      .step {
        display: contents;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      .button-wrapper {
        width: 100%;
        margin-top: var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: var(--boxel-sp-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>;

interface AwaitingEmailSignature {
  Args: {
    // The title's heading level, 1 when not given. A page with a heading of
    // its own above the screen passes 2.
    headingLevel?: number;
    resending?: boolean;
    onResend: (event: Event) => void;
  };
  // A notice under the heading, such as how long the CLI waits.
  Blocks: { default: [] };
}

// Waiting for the user to follow the link in the validation email.
export const AwaitingEmail: TemplateOnlyComponent<AwaitingEmailSignature> =
  <template>
    <span
      class='title'
      role='heading'
      aria-level={{if @headingLevel @headingLevel 1}}
      data-test-secure-title
      data-test-email-validation
    >Please check your email to complete registration</span>
    {{yield}}
    <ul class='email-validation-instruction'>
      <li>Leave this window open while we verify your email</li>
      <li>This screen will update once your email is verified</li>
    </ul>
    <AuthButton
      data-test-resend-validation
      class='resend-email'
      @variant='primary'
      @disabled={{@resending}}
      @loading={{@resending}}
      {{on 'click' @onResend}}
    >Resend Email</AuthButton>
    <style scoped>
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
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
      .resend-email {
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>;

// The email address is validated, and the account is being set up.
export const CreatingAccount: TemplateOnlyComponent = <template>
  <div class='centered-loading'>
    <span class='loading-title' data-test-email-validation-complete>Email
      validation complete</span>
    <p class='loading-message'>Please wait as we set up your account.</p>
    <LoadingIndicator class='loading-spinner' />
  </div>
  <style scoped>
    .centered-loading {
      align-self: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--boxel-sp-sm);
      text-align: center;
    }
    .loading-title {
      font: 600 var(--boxel-font-md);
      color: var(--foreground);
    }
    .loading-message {
      margin: 0;
      color: var(--foreground);
      font: 500 var(--boxel-font-sm);
    }
    .loading-spinner {
      --boxel-loading-indicator-size: var(--boxel-icon-md);
      --loading-indicator-color: var(--boxel-highlight);
      margin-top: var(--boxel-sp-xs);
    }
  </style>
</template>;
