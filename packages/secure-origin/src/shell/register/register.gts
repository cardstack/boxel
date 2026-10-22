import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { trackedObject } from '@ember/reactive/collections';
import Component from '@glimmer/component';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import AuthFormField from '../../components/auth-form-field.gts';
import CheckMark from '../../components/icons/check-mark.gts';
import BoxelInput from '../../components/input.gts';
import InputGroup, {
  type InputGroupValidationState,
} from '../../components/input-group.gts';
import LoadingIndicator from '../../components/loading-indicator.gts';
import ValidationHint from '../../components/validation-hint.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { autofocus } from '../../modifiers/autofocus.ts';
import { isUsernameAvailable } from '../../security/matrix.js';
import {
  type Account,
  type Outcome,
  Registration,
  usernameError,
} from '../../security/registration.ts';
import {
  matrixServerName,
  readConfig,
  signInWithPassword,
  storeSession,
} from '../../security/session.js';
import NewPasswordFields from '../new-password-fields.gts';
import { NewPassword } from '../new-password.ts';
import CliHandoff from '../sign-in/cli-handoff.gts';
import MessagePage from '../sign-in/message-page.gts';
import SignedIn from '../sign-in/signed-in.gts';
import { asSentence } from '../sign-in-copy.js';
import { modeURL } from '../urls.js';

// Creating a Boxel account on the secure origin (`register`), drawn and
// worded as the app's registration is. `Registration` drives the Matrix
// server's registration; this draws the step it is at. The email validation
// link lands on `verify-email`, and this page, still waiting, carries on by
// itself.
//
// Once the account exists, the page signs in to Boxel with the new password,
// passing the invite code along. That sign-in is the account's first, so the
// realm server sets the account up as the app's first sign-in does, and the
// user ends signed in here, or, when a CLI started the sign-in, with the
// session handed to the CLI.
//
// The password, the invite code and every other field are typed into, and
// sent from, this page. Nothing goes to the app page.

type Page =
  | 'form'
  | 'invite-code'
  | 'awaiting-email'
  | 'creating'
  | 'sign-in-failed'
  | 'signed-in'
  | 'cli-handoff';

interface CliCallback {
  url: string;
  state: string;
}

interface Session {
  token: string;
  user: string;
  expiresAt: string;
}

interface Signature {
  Args: {
    // The CLI waiting on a loopback port for the new account's session, when
    // a CLI started the sign-in.
    cli?: CliCallback;
    // The username the page was opened with, filled in for the user.
    username?: string;
    // Where "Login with an existing account" goes.
    signInURL: string;
  };
}

export default class Register extends Component<Signature> {
  private config = readConfig();
  private password = new NewPassword();
  private registration: Registration | undefined;
  private availabilityCheck = 0;
  // The account the registration made, which the page signs in to.
  private accountUser = '';

  private state = trackedObject({
    page: 'form' as Page,
    name: '',
    email: '',
    username: '',
    token: '',
    serverName: '',
    nameError: undefined as string | undefined,
    emailError: undefined as string | undefined,
    usernameError: undefined as string | undefined,
    tokenError: undefined as string | undefined,
    formError: undefined as string | undefined,
    signInError: undefined as string | undefined,
    checkingUsername: false,
    usernameAvailable: false,
    registering: false,
    resending: false,
    retrying: false,
    session: undefined as Session | undefined,
  });

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let suggested = args.username ?? '';
    if (suggested && !suggested.includes('@')) {
      this.state.username = suggested;
    }
    matrixServerName(this.config).then(
      (name: string) => (this.state.serverName = name),
      () => undefined,
    );
  }

  willDestroy() {
    super.willDestroy();
    this.registration?.stop();
  }

  private get registerDisabled() {
    return Boolean(
      this.state.registering ||
      !this.state.name ||
      !this.state.email ||
      !this.state.username ||
      !this.password.complete ||
      this.state.nameError ||
      this.state.emailError ||
      this.state.usernameError,
    );
  }

  // The CLI and the session it is handed, once there is one to hand over.
  private get handoff() {
    let { cli } = this.args;
    let { session } = this.state;
    return cli && session ? { callback: cli, session } : undefined;
  }

  private get nextDisabled() {
    return this.state.registering || !this.state.token;
  }

  private get usernameState(): InputGroupValidationState {
    if (this.state.usernameError) {
      return 'invalid';
    }
    if (this.state.checkingUsername) {
      return 'loading';
    }
    return this.state.usernameAvailable ? 'valid' : 'initial';
  }

  private get usernameValidAndAvailable() {
    return (
      Boolean(this.state.username) &&
      !this.state.usernameError &&
      !this.state.checkingUsername &&
      this.state.usernameAvailable
    );
  }

  private goToSignIn = () => {
    navigation.assign(this.args.signInURL);
  };

  private setName = (value: string) => {
    this.state.name = value;
    this.state.nameError = undefined;
  };

  private checkName = () => {
    if (!this.state.name) {
      this.state.nameError = 'Your name is missing';
    }
  };

  private setEmail = (value: string) => {
    this.state.email = value;
    this.state.emailError = undefined;
  };

  private checkEmail = () => {
    if (!this.state.email) {
      this.state.emailError = 'Email address is missing';
    }
  };

  private setUsername = (value: string) => {
    this.state.username = value;
    this.state.usernameError = undefined;
    this.state.usernameAvailable = false;
    // A check still under way is for a username no longer typed.
    this.availabilityCheck++;
    this.state.checkingUsername = false;
  };

  private checkUsername = async () => {
    let username = this.state.username;
    this.state.usernameError = usernameError(username);
    if (this.state.usernameError) {
      return;
    }
    let check = ++this.availabilityCheck;
    this.state.checkingUsername = true;
    let available: boolean;
    try {
      available = await isUsernameAvailable(username);
    } catch {
      return;
    } finally {
      if (check === this.availabilityCheck) {
        this.state.checkingUsername = false;
      }
    }
    if (check !== this.availabilityCheck) {
      return;
    }
    this.state.usernameAvailable = available;
    if (!available) {
      this.state.usernameError = 'Username is already taken';
    }
  };

  private setToken = (value: string) => {
    this.state.token = value;
    this.state.tokenError = undefined;
  };

  private register = async (event: Event) => {
    event.preventDefault();
    if (this.registerDisabled || !this.password.validate()) {
      return;
    }
    this.registration?.stop();
    this.registration = new Registration(
      {
        name: this.state.name.trim(),
        email: this.state.email,
        username: this.state.username,
        password: this.password.password,
        nextLink: new URL(modeURL('verify-email'), window.location.href).href,
      },
      { onAwaitingEmail: () => (this.state.page = 'awaiting-email') },
    );
    this.state.formError = undefined;
    this.state.registering = true;
    this.show(await this.registration.start());
  };

  private sendToken = async (event: Event) => {
    event.preventDefault();
    if (this.nextDisabled || !this.registration) {
      return;
    }
    this.state.registering = true;
    this.show(await this.registration.submitInviteCode(this.state.token));
  };

  private resendValidation = async () => {
    this.state.resending = true;
    try {
      await this.registration?.sendValidationEmail();
    } catch {
      // The page keeps waiting on the email already sent.
    } finally {
      this.state.resending = false;
    }
  };

  private retrySignIn = async () => {
    this.state.retrying = true;
    await this.signIn();
    this.state.retrying = false;
  };

  // Where the registration stands once a step of it returns.
  private show(outcome: Outcome) {
    this.state.registering = false;
    switch (outcome.step) {
      case 'account':
        this.finish(outcome.account);
        return;
      case 'invite-code':
        this.state.tokenError = outcome.error;
        this.state.page = 'invite-code';
        return;
      case 'form':
        this.state.page = 'form';
        if (outcome.field === 'username') {
          this.state.usernameError = outcome.error;
        } else if (outcome.field === 'email') {
          this.state.emailError = outcome.error;
        } else {
          this.state.formError = outcome.error;
        }
        return;
      case 'stopped':
        return;
    }
  }

  private async finish(account: Account) {
    this.state.page = 'creating';
    await this.registration!.setUp(account);
    this.accountUser = account.user_id;
    await this.signIn();
  }

  // The new account's first sign-in, which records the invite code. When it
  // fails, it is tried again from here, with the same password and invite
  // code: the account's first sign-in is the one that records the code.
  private async signIn() {
    let session: Session;
    try {
      session = await signInWithPassword(this.config, {
        username: this.accountUser,
        password: this.registration!.details.password,
        client: this.args.cli ? 'cli' : 'window',
        registrationToken: this.registration!.token,
      });
    } catch (e) {
      this.state.signInError = asSentence((e as Error).message);
      this.state.page = 'sign-in-failed';
      return;
    }
    this.state.signInError = undefined;
    if (this.args.cli) {
      this.state.session = session;
      this.state.page = 'cli-handoff';
    } else {
      storeSession(session);
      history.replaceState(null, '', modeURL('sign-in'));
      this.state.page = 'signed-in';
    }
  }

  <template>
    {{#if (eq this.state.page 'sign-in-failed')}}
      <MessagePage
        @heading='Your account was created, but signing in didn’t finish'
      >
        <div class='error' role='alert' data-test-secure-error>
          {{this.state.signInError}}
        </div>
        <div class='button-wrapper'>
          <AuthButton
            data-test-secure-retry-sign-in
            @variant='primary'
            @disabled={{this.state.retrying}}
            @loading={{this.state.retrying}}
            {{on 'click' this.retrySignIn}}
          >Try again</AuthButton>
        </div>
      </MessagePage>
    {{else if (eq this.state.page 'signed-in')}}
      <SignedIn />
    {{else if (eq this.state.page 'cli-handoff')}}
      {{#if this.handoff}}
        <CliHandoff
          @callback={{this.handoff.callback}}
          @session={{this.handoff.session}}
        />
      {{/if}}
    {{else}}
      <AuthContainer>
        {{#if (eq this.state.page 'awaiting-email')}}
          <span
            class='title'
            role='heading'
            aria-level='1'
            data-test-email-validation
          >Please check your email to complete registration</span>
          <ul class='email-validation-instruction'>
            <li>Leave this window open while we verify your email</li>
            <li>This screen will update once your email is verified</li>
          </ul>
          <AuthButton
            data-test-resend-validation
            class='resend-email'
            @variant='primary'
            @disabled={{this.state.resending}}
            @loading={{this.state.resending}}
            {{on 'click' this.resendValidation}}
          >Resend Email</AuthButton>
        {{else if (eq this.state.page 'creating')}}
          <div class='centered-loading'>
            <span
              class='loading-title'
              data-test-email-validation-complete
            >Email validation complete</span>
            <p class='loading-message'>Please wait as we set up your account.</p>
            <LoadingIndicator class='loading-spinner' />
          </div>
        {{else if (eq this.state.page 'invite-code')}}
          <form
            class='step'
            novalidate
            data-test-token-page
            {{on 'submit' this.sendToken}}
          >
            <span class='title' role='heading' aria-level='1'>Boxel is currently
              invite-only.<br />Enter your invite code here.</span>
            <AuthFormField
              @label='Your invite code'
              data-test-secure-field='token'
            >
              <BoxelInput
                data-test-token-field
                name='invite-code'
                autocomplete='off'
                @state={{if this.state.tokenError 'invalid' 'initial'}}
                @value={{this.state.token}}
                placeholder='Enter invite code'
                @errorMessage={{this.state.tokenError}}
                @onInput={{this.setToken}}
                {{autofocus}}
              />
            </AuthFormField>
            <div class='button-wrapper'>
              <AuthButton
                data-test-next-btn
                type='submit'
                @variant='primary'
                @disabled={{this.nextDisabled}}
                @loading={{this.state.registering}}
              >Next</AuthButton>
            </div>
          </form>
        {{else}}
          <div class='registration-page' data-test-register-page>
            <span class='title' role='heading' aria-level='1'>Create a Boxel
              Account</span>
            <form
              novalidate
              data-test-register-form
              {{on 'submit' this.register}}
            >
              <AuthFormField @label='Your Name' data-test-secure-field='name'>
                <BoxelInput
                  data-test-name-field
                  name='name'
                  autocomplete='name'
                  @state={{if this.state.nameError 'invalid' 'initial'}}
                  @value={{this.state.name}}
                  placeholder='Enter your name'
                  @errorMessage={{this.state.nameError}}
                  @onInput={{this.setName}}
                  @onBlur={{this.checkName}}
                  {{autofocus}}
                />
              </AuthFormField>
              <AuthFormField @label='Email' data-test-secure-field='email'>
                <BoxelInput
                  data-test-email-field
                  name='email'
                  autocomplete='email'
                  @state={{if this.state.emailError 'invalid' 'initial'}}
                  @value={{this.state.email}}
                  placeholder='Enter your email'
                  @errorMessage={{this.state.emailError}}
                  @onInput={{this.setEmail}}
                  @onBlur={{this.checkEmail}}
                />
              </AuthFormField>
              <AuthFormField
                @label='Username'
                data-test-secure-field='username'
              >
                <InputGroup
                  data-test-username-field
                  @name='username'
                  @autocomplete='username'
                  @state={{this.usernameState}}
                  @value={{this.state.username}}
                  @placeholder='Your username'
                  @errorMessage={{this.state.usernameError}}
                  @onInput={{this.setUsername}}
                  @onBlur={{this.checkUsername}}
                  @validIcon={{CheckMark}}
                >
                  <:before as |Accessories|>
                    <Accessories.Text
                      class='username-prefix'
                    >@</Accessories.Text>
                  </:before>
                  <:after as |Accessories|>
                    <Accessories.Text
                      data-input-group-suffix
                      data-test-input-group-suffix
                    >{{this.state.serverName}}</Accessories.Text>
                  </:after>
                </InputGroup>
                {{#if this.usernameValidAndAvailable}}
                  <ValidationHint data-test-username-available>name available</ValidationHint>
                {{/if}}
              </AuthFormField>
              <NewPasswordFields
                @password={{this.password}}
                @passwordLabel='Password'
                @confirmLabel='Confirm Password'
                @passwordPlaceholder='Your password'
                @confirmPlaceholder='Re-enter your password'
                @hints={{true}}
              />
              {{#if this.state.formError}}
                <div
                  class='error-message'
                  role='alert'
                  data-test-register-user-error
                  data-test-secure-error
                >{{this.state.formError}}</div>
              {{/if}}
              <div class='button-wrapper'>
                <AuthButton
                  data-test-register-btn
                  type='submit'
                  @variant='primary'
                  @disabled={{this.registerDisabled}}
                  @loading={{this.state.registering}}
                >Create Account</AuthButton>
                <div>or</div>
                <AuthButton
                  data-test-cancel-btn
                  type='button'
                  {{on 'click' this.goToSignIn}}
                  @variant='secondary'
                >Login with an existing account</AuthButton>
              </div>
            </form>
          </div>
        {{/if}}
      </AuthContainer>
    {{/if}}
    <style scoped>
      .registration-page,
      .step {
        display: contents;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
      }
      p {
        color: var(--foreground);
      }
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
      .error-message {
        color: var(--boxel-error-100);
        margin-top: var(--boxel-sp-lg);
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
    </style>
  </template>
}
