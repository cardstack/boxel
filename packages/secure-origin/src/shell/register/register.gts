import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { trackedObject } from '@ember/reactive/collections';
import Component from '@glimmer/component';

import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import type { InputGroupValidationState } from '../../components/input-group.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import {
  AwaitingEmail,
  CreatingAccount,
  InviteCodeForm,
  RegisterForm,
} from '../../screens/register.gts';
import { navigation } from '../navigation.js';
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
  type Session,
  storeSession,
} from '../../security/session.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import NewPasswordFields from '../new-password-fields.gts';
import { NewPassword } from '../new-password.ts';
import CliHandoff from '../sign-in/cli-handoff.gts';
import MessagePage from '../sign-in/message-page.gts';
import SignedIn from '../sign-in/signed-in.gts';
import { asSentence } from '../sign-in-copy.js';
import { pageURL } from '../urls.js';
import CliWaitNotice from '../sign-in/cli-wait-notice.gts';

// Creating a Boxel account on the secure origin (`register`), on the
// registration screens the app draws too. `Registration` drives the Matrix
// server's registration; this draws the step it is at. The email validation
// link lands on `verify-email`, and this page, still waiting, carries on by
// itself.
//
// Once the account exists, `Registration` signs it in to Boxel with the new
// password, passing the invite code along. That sign-in is the account's
// first, so the realm server sets the account up as the app's first sign-in
// does, and the user ends signed in here, or, when a CLI started the sign-in,
// with the session handed to the CLI.
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
        nextLink: new URL(pageURL('verify-email'), window.location.href).href,
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
    await this.signIn();
  }

  // The new account's first sign-in, which records the invite code. When it
  // fails, it is tried again from here, with the same password and invite
  // code: the account's first sign-in is the one that records the code.
  private async signIn() {
    let session: Session;
    try {
      session = await this.registration!.signIn(
        this.config,
        this.args.cli ? 'cli' : 'window',
      );
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
      history.replaceState(null, '', pageURL('sign-in'));
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
          <AwaitingEmail
            @resending={{this.state.resending}}
            @onResend={{this.resendValidation}}
          >
            {{#if @cli}}
              <CliWaitNotice @cli={{@cli}} />
            {{/if}}
          </AwaitingEmail>
        {{else if (eq this.state.page 'creating')}}
          <CreatingAccount />
        {{else if (eq this.state.page 'invite-code')}}
          <InviteCodeForm
            @token={{this.state.token}}
            @tokenError={{this.state.tokenError}}
            @submitDisabled={{this.nextDisabled}}
            @submitting={{this.state.registering}}
            @autofocus={{true}}
            @onTokenInput={{this.setToken}}
            @onSubmit={{this.sendToken}}
          />
        {{else}}
          <RegisterForm
            @name={{this.state.name}}
            @email={{this.state.email}}
            @username={{this.state.username}}
            @serverName={{this.state.serverName}}
            @nameError={{this.state.nameError}}
            @emailError={{this.state.emailError}}
            @usernameError={{this.state.usernameError}}
            @usernameState={{this.usernameState}}
            @usernameAvailable={{this.usernameValidAndAvailable}}
            @formError={{this.state.formError}}
            @submitDisabled={{this.registerDisabled}}
            @submitting={{this.state.registering}}
            @autofocus={{true}}
            @onNameInput={{this.setName}}
            @onNameBlur={{this.checkName}}
            @onEmailInput={{this.setEmail}}
            @onEmailBlur={{this.checkEmail}}
            @onUsernameInput={{this.setUsername}}
            @onUsernameBlur={{this.checkUsername}}
            @onSubmit={{this.register}}
            @onSignIn={{this.goToSignIn}}
          >
            <NewPasswordFields
              @password={{this.password}}
              @passwordLabel='Password'
              @confirmLabel='Confirm Password'
              @passwordPlaceholder='Your password'
              @confirmPlaceholder='Re-enter your password'
              @hints={{true}}
            />
          </RegisterForm>
        {{/if}}
      </AuthContainer>
    {{/if}}
    <style scoped>
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
      .error {
        color: var(--destructive-ink);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
    </style>
  </template>
}
