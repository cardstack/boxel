// The app's sign-in page: the Google button when this server offers Google,
// then an email address or username and a password, the link to reset a
// forgotten password, and the link to create an account. Everything here is
// typed into, and sent from, this window; a session it signs in is handed to
// `@onSignedIn`, never to the page that opened the window.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  beginGoogleSignIn,
  googleSignInConfig,
  signInWithPassword,
} from '../../security/session.js';
import AuthButton from '../../components/auth-button.gts';
import AuthFormField from '../../components/auth-form-field.gts';
import Button from '../../components/button.gts';
import GoogleColor from '../../components/icons/google-color.gts';
import BoxelInput from '../../components/input.gts';
import { navigation } from '../navigation.js';
import { asSentence, signInFailed } from '../sign-in-copy.js';
import { cliParams, modeURL } from '../urls.js';

import { autofocus } from '../../modifiers/autofocus.ts';

type Config = ReturnType<typeof import('../../security/session.js').readConfig>;
type Session = { token: string; user: string; expiresAt: string };
type CliCallback = { url: string; state: string };

interface Signature {
  Args: {
    config: Config;
    // 'window' for the window's own session, 'cli' for one handed to the CLI.
    client: 'window' | 'cli';
    cli?: CliCallback;
    username?: string;
    onSignedIn: (session: Session) => void;
  };
}

export default class SignInForm extends Component<Signature> {
  <template>
    <span
      class='title'
      role='heading'
      aria-level='1'
      data-test-secure-title
      data-test-secure-sign-in-title
    >Sign in to your Boxel Account</span>
    {{#if this.state.google}}
      <p class='subtitle' data-test-secure-sign-in-subtitle>Use Google to get
        started in one tap - we'll create your Boxel account if you don't have
        one yet.</p>
    {{/if}}
    <form novalidate data-test-secure-sign-in-form {{on 'submit' this.submit}}>
      {{#if this.state.google}}
        <AuthButton
          type='button'
          class='google-button'
          @disabled={{this.state.startingGoogle}}
          @loading={{this.state.startingGoogle}}
          data-test-secure-google
          {{on 'click' this.startGoogle}}
        >
          <GoogleColor class='google-g' aria-hidden='true' />
          Continue with Google
        </AuthButton>
        <div class='divider' aria-hidden='true'>
          <span class='divider-label' data-test-secure-divider-label>or use your
            email</span>
        </div>
      {{/if}}
      <AuthFormField
        @label='Email Address or Username'
        data-test-secure-field='username'
      >
        <BoxelInput
          @type='text'
          @autocomplete='username'
          @placeholder='Your email address'
          @value={{this.state.username}}
          @onInput={{this.setUsername}}
          name='username'
          data-test-secure-username
          {{autofocus this.focusUsername}}
        />
      </AuthFormField>
      <AuthFormField @label='Password' data-test-secure-field='password'>
        <BoxelInput
          @type='password'
          @autocomplete='current-password'
          @placeholder='Your password'
          @value={{this.state.password}}
          @onInput={{this.setPassword}}
          name='password'
          data-test-secure-password
          {{autofocus this.focusPassword}}
        />
      </AuthFormField>
      <Button
        type='button'
        class='forgot-password'
        @kind='link-muted'
        @size='extra-small'
        data-test-secure-forgot-password
        {{on 'click' this.forgotPassword}}
      >Forgot password?</Button>
      <AuthButton
        type='submit'
        @variant='primary'
        @disabled={{this.submitDisabled}}
        @loading={{this.state.submitting}}
        data-test-secure-password-submit
      >Sign In</AuthButton>
      {{#if this.state.error}}
        <div class='error' role='alert' data-test-secure-error>
          {{this.state.error}}
        </div>
      {{/if}}
      <p class='register-prompt'>
        <span
          class='register-prompt-text'
          data-test-secure-register-prompt
        >Don't have an account?</span>
        <Button
          type='button'
          class='register-link'
          @kind='link-primary'
          data-test-secure-register
          {{on 'click' this.register}}
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
  </template>

  private state = trackedObject({
    username: this.args.username ?? '',
    password: '',
    submitting: false,
    error: undefined as string | undefined,
    google: undefined as unknown,
    startingGoogle: false,
  });

  // The username the CLI suggested is filled in, so the password is what's
  // left to type.
  private focusUsername = !this.args.username;
  private focusPassword = Boolean(this.args.username);

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.offerGoogle();
  }

  private async offerGoogle() {
    this.state.google = await googleSignInConfig(this.args.config);
  }

  // Sign In waits for both fields, as the app's does.
  private get submitDisabled() {
    return (
      this.state.submitting ||
      !this.state.username.trim() ||
      !this.state.password
    );
  }

  // The pages a sign-in links to carry the CLI along, so finishing there
  // still hands the CLI its session.
  private get pageParams() {
    return cliParams(this.args.cli, this.args.username);
  }

  // Typing clears an error.
  private setUsername = (value: string) => {
    this.state.username = value;
    this.state.error = undefined;
  };

  private setPassword = (value: string) => {
    this.state.password = value;
    this.state.error = undefined;
  };

  private forgotPassword = () => {
    navigation.assign(modeURL('forgot-password', this.pageParams));
  };

  private register = () => {
    navigation.assign(modeURL('register', this.pageParams));
  };

  private submit = async (event: Event) => {
    event.preventDefault();
    if (this.submitDisabled) {
      return;
    }
    this.state.submitting = true;
    this.state.error = undefined;
    let session;
    try {
      session = await signInWithPassword(this.args.config, {
        username: this.state.username,
        password: this.state.password,
        client: this.args.client,
        registrationToken: undefined,
      });
    } catch (e) {
      this.state.error = signInFailed(e);
      this.state.submitting = false;
      return;
    }
    this.args.onSignedIn(session);
  };

  private startGoogle = async () => {
    this.state.startingGoogle = true;
    this.state.error = undefined;
    try {
      navigation.assign(
        await beginGoogleSignIn(this.state.google, {
          client: this.args.client,
          cli: this.args.cli,
          username: this.args.username,
        }),
      );
    } catch (e: any) {
      this.state.error = asSentence(e.message);
      this.state.startingGoogle = false;
    }
  };
}
