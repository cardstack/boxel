// The sign-in screen, as both origins draw it: the title, the Google button
// when the Matrix server offers Google, the fields the caller puts in its
// block, the link to reset a forgotten password, Sign In, and the link to
// create an account. A page that signs in for something other than the app,
// such as the CLI's, names itself with `@title` and says what signing in
// grants in its `intro` block, in place of the Google subtitle; the screen
// sets the intro's type and the space around it. It holds no state and sends
// nothing; the caller decides what each control does. On the secure origin
// the fields are its own inputs; in the app they are the credential frame.
//
// Each control carries the test attributes of both origins' suites.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import AuthButton from '../components/auth-button.gts';
import Button from '../components/button.gts';
import GoogleColor from '../components/icons/google-color.gts';

interface Signature {
  Args: {
    // The screen's heading; "Sign in to your Boxel Account" when not given.
    title?: string;
    // Whether the Google button shows.
    google?: boolean;
    // Whether the subtitle inviting a new user to start with Google shows,
    // when there is no `intro` block.
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
  Blocks: { default: []; intro: [] };
}

const SignInScreen: TemplateOnlyComponent<Signature> = <template>
  <h1 class='title' data-test-secure-title data-test-secure-sign-in-title>{{if
      @title
      @title
      'Sign in to your Boxel Account'
    }}</h1>
  {{#if (has-block 'intro')}}
    <div class='intro'>{{yield to='intro'}}</div>
  {{else if @googleSubtitle}}
    <p class='subtitle' data-test-secure-sign-in-subtitle>Use Google to get
      started in one tap - we'll create your Boxel account if you don't have one
      yet.</p>
  {{/if}}
  <form
    novalidate
    {{on 'submit' @onSubmit}}
    data-test-login-form
    data-test-secure-sign-in-form
  >
    {{#if @google}}
      <AuthButton
        type='button'
        class='google-button'
        @disabled={{@startingGoogle}}
        @loading={{@startingGoogle}}
        {{on 'click' @onGoogle}}
        data-test-google-login-btn
        data-test-secure-google
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
      {{on 'click' @onForgotPassword}}
      data-test-forgot-password
      data-test-secure-forgot-password
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
        {{on 'click' @onRegister}}
        data-test-register-user
        data-test-secure-register
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
      margin: 0 0 var(--boxel-sp-sm);
      padding: 0;
    }
    .subtitle {
      margin: 0 0 var(--boxel-sp-lg);
      color: var(--foreground);
      font: var(--boxel-font-sm);
      line-height: 1.4;
    }
    .intro {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-lg);
      margin-bottom: var(--boxel-sp-lg);
      color: var(--foreground);
      font: var(--boxel-font-sm);
      line-height: 1.4;
    }
    .forgot-password {
      --host-outline-offset: 2px;
      margin-top: var(--boxel-sp-4xs);
      margin-bottom: var(--boxel-sp-lg);
      margin-inline-start: auto;
    }
    .google-button {
      margin-top: var(--boxel-sp-sm);
      gap: var(--boxel-sp-xs);
    }
    .google-g {
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
      background-color: var(--border);
    }
    .divider-label {
      color: var(--muted-foreground);
      font: 600 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-lg);
      text-transform: uppercase;
    }
    .error {
      color: var(--destructive-ink);
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
