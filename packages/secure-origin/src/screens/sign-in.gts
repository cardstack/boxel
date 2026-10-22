// The sign-in screen, as both origins draw it: the Google button when the
// Matrix server offers Google, the fields the caller puts in its block, the
// link to reset a forgotten password, Sign In, and the link to create an
// account. It holds no state and sends nothing; the caller decides what each
// control does. On the secure origin the fields are its own inputs; in the app
// they are the credential frame.
//
// Each control carries the test attributes of both origins' suites.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import AuthButton from '../components/auth-button.gts';
import Button from '../components/button.gts';
import GoogleColor from '../components/icons/google-color.gts';

interface Signature {
  Args: {
    // Whether the Google button shows.
    google?: boolean;
    // Whether the subtitle inviting a new user to start with Google shows.
    googleSubtitle?: boolean;
    startingGoogle?: boolean;
    submitDisabled?: boolean;
    submitting?: boolean;
    error?: string;
    onSubmit: (event: Event) => void;
    onGoogle: (event: Event) => void;
    onForgotPassword: (event: Event) => void;
    onRegister: (event: Event) => void;
  };
  Blocks: { default: [] };
}

const SignInScreen: TemplateOnlyComponent<Signature> = <template>
  <span
    class='title'
    role='heading'
    aria-level='1'
    data-test-secure-title
    data-test-secure-sign-in-title
  >Sign in to your Boxel Account</span>
  {{#if @googleSubtitle}}
    <p class='subtitle' data-test-secure-sign-in-subtitle>Use Google to get
      started in one tap - we'll create your Boxel account if you don't have one
      yet.</p>
  {{/if}}
  <form
    novalidate
    data-test-login-form
    data-test-secure-sign-in-form
    {{on 'submit' @onSubmit}}
  >
    {{#if @google}}
      <AuthButton
        type='button'
        class='google-button'
        @disabled={{@startingGoogle}}
        @loading={{@startingGoogle}}
        data-test-google-login-btn
        data-test-secure-google
        {{on 'click' @onGoogle}}
      >
        <GoogleColor class='google-g' aria-hidden='true' />
        Continue with Google
      </AuthButton>
      <div class='divider' aria-hidden='true'>
        <span class='divider-label' data-test-secure-divider-label>or use your
          email</span>
      </div>
    {{/if}}
    {{yield}}
    <Button
      type='button'
      class='forgot-password'
      @kind='link-muted'
      @size='extra-small'
      data-test-forgot-password
      data-test-secure-forgot-password
      {{on 'click' @onForgotPassword}}
    >Forgot password?</Button>
    <AuthButton
      type='submit'
      @variant='primary'
      @disabled={{@submitDisabled}}
      @loading={{@submitting}}
      data-test-login-btn
      data-test-secure-password-submit
    >Sign In</AuthButton>
    {{#if @error}}
      <div
        class='error'
        role='alert'
        data-test-login-error
        data-test-secure-error
      >
        {{@error}}
      </div>
    {{/if}}
    <p class='register-prompt'>
      <span class='register-prompt-text' data-test-secure-register-prompt>Don't
        have an account?</span>
      <Button
        type='button'
        class='register-link'
        @kind='link-primary'
        data-test-register-user
        data-test-secure-register
        {{on 'click' @onRegister}}
      >Create a new Boxel account</Button>
    </p>
  </form>

  <style scoped>
    form {
      display: flex;
      flex-direction: column;
    }
    .title {
      font: 600 var(--boxel-font-md);
      color: var(--foreground);
      margin-bottom: var(--boxel-sp-sm);
      padding: 0;
    }
    .subtitle {
      margin: 0 0 var(--boxel-sp-lg);
      color: var(--foreground);
      font: var(--boxel-font-sm);
      line-height: 1.4;
    }
    .forgot-password {
      --host-outline-offset: 2px;
      margin-top: var(--boxel-sp-4xs);
      margin-bottom: var(--boxel-sp-lg);
      margin-left: auto;
    }
    .google-button {
      margin-top: var(--boxel-sp-sm);
      gap: var(--boxel-sp-xs);
    }
    .google-g {
      width: 1.125rem;
      height: 1.125rem;
      flex-shrink: 0;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-sm);
      margin: var(--boxel-sp-lg) 0 var(--boxel-sp-xs);
    }
    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background-color: rgba(255, 255, 255, 0.18);
    }
    .divider-label {
      color: var(--muted-foreground);
      font: 600 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-lg);
      text-transform: uppercase;
    }
    .error {
      color: var(--boxel-error-100);
      padding: 0;
      font: 500 var(--boxel-font-xs);
      margin: var(--boxel-sp-2xs) auto 0 auto;
    }
    .register-prompt {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--boxel-sp-3xs);
      margin: var(--boxel-sp) 0 0;
      font: 500 var(--boxel-font-sm);
    }
    .register-prompt-text {
      color: var(--muted-foreground);
    }
    .register-link {
      --host-outline-offset: 2px;
    }
  </style>
</template>;

export default SignInScreen;
