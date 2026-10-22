import { fn } from '@ember/helper';
import { action } from '@ember/object';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import {
  AwaitingEmail,
  CreatingAccount,
  InviteCodeForm,
  RegisterForm,
} from '@cardstack/secure-origin/screens/register.gts';
import { restartableTask, timeout } from 'ember-concurrency';

import { v4 as uuidv4 } from 'uuid';

import { eq, not } from '@cardstack/boxel-ui/helpers';

import ENV from '@cardstack/host/config/environment';
import {
  CredentialFields,
  credentialFieldsError,
} from '@cardstack/host/lib/credential-fields';
import {
  isMatrixError,
  isInteractiveAuth,
  nextUncompletedStage,
  type InteractiveAuth,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import CredentialFieldsFrame from './credential-fields';

import type { AuthMode } from './auth';
import type {
  RegisterResponse,
  IRequestTokenResponse,
  LoginResponse,
} from 'matrix-js-sdk';

const MATRIX_REGISTRATION_TYPES = {
  sendToken: 'm.login.registration_token',
  login: 'm.login.dummy',
  waitForAccountCreation: undefined,
  waitForEmailValidation: 'm.login.email.identity',
  askForToken: undefined,
  register: undefined,
};

const { matrixServerName } = ENV;
interface Signature {
  Args: {
    setMode: (mode: AuthMode) => void;
    // When present, the freshly-minted session is handed here once the full
    // bootstrap (personal realm, realm auth) has run, instead of the default
    // operator-mode transition initializeNewUser performs on its own. The
    // CLI-auth page uses this to POST the session to the waiting loopback
    // listener.
    onComplete?: (session: LoginResponse) => void;
  };
}

export default class RegisterUser extends Component<Signature> {
  <template>
    {{#if (eq this.currentPage 'awaiting-validation')}}
      <AwaitingEmail
        @resending={{this.validateEmail.isRunning}}
        @onResend={{this.resendValidation}}
      />
    {{else if (eq this.currentPage 'account-creation')}}
      <CreatingAccount />
    {{else if (eq this.currentPage 'token-form')}}
      <InviteCodeForm
        @token={{this.token}}
        @tokenError={{this.tokenError}}
        @submitDisabled={{this.isNextButtonDisabled}}
        @submitting={{this.doRegistrationFlow.isRunning}}
        @onTokenInput={{this.setToken}}
        @onSubmit={{this.sendToken}}
      />
    {{/if}}
    {{! The passwords are in a frame that sends them again at each step of
        the registration, so the form stays mounted, hidden, while the steps
        after it show. }}
    <RegisterForm
      @name={{this.name}}
      @email={{this.email}}
      @username={{this.username}}
      @serverName={{matrixServerName}}
      @nameError={{this.nameError}}
      @emailError={{this.emailError}}
      @usernameError={{this.usernameError}}
      @usernameState={{this.usernameInputState}}
      @usernameAvailable={{this.isUsernameValidAndAvailable}}
      @formError={{this.formError}}
      @submitDisabled={{this.isRegisterButtonDisabled}}
      @submitting={{this.doRegistrationFlow.isRunning}}
      @hidden={{not (eq this.currentPage 'registration-form')}}
      @onNameInput={{this.setName}}
      @onNameBlur={{this.checkName}}
      @onEmailInput={{this.setEmail}}
      @onEmailBlur={{this.checkEmail}}
      @onUsernameInput={{this.setUsername}}
      @onUsernameBlur={{this.checkUsername}}
      @onSubmit={{this.register}}
      @onSignIn={{fn @setMode 'login'}}
    >
      <CredentialFieldsFrame @form='register' @fields={{this.credentials}} />
    </RegisterForm>
  </template>
  @tracked private email = '';
  @tracked private name = '';
  @tracked private username = '';
  // The password and its confirmation are typed into a frame on the secure
  // origin, which sends them with each registration request.
  private credentials = new CredentialFields();
  @tracked private token = '';
  @tracked private formError: string | undefined;
  @tracked private emailError: string | undefined;
  @tracked private nameError: string | undefined;
  @tracked private usernameError: string | undefined;
  @tracked private tokenError: string | undefined;
  @tracked private isUsernameAvailable = false;
  @tracked private state:
    | { type: 'initial' }
    | {
        type: 'validateEmail';
        username: string;
        email: string;
        name: string;
      }
    | {
        type: 'register';
        username: string;
        email: string;
        name: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
      }
    | {
        type: 'askForToken';
        session: string;
        username: string;
        email: string;
        name: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
      }
    | {
        type: 'sendToken';
        username: string;
        token: string;
        session: string;
        email: string;
        name: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
      }
    | {
        type: 'waitForEmailValidation' | 'waitForAccountCreation';
        username: string;
        token?: string;
        session: string;
        email: string;
        name: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
      }
    // TODO we'll need to also add a CAPTCHA state
    // this will be probably impossible to test
    // since the whole point of CAPTCHA is to detect
    // human interaction
    | {
        type: 'login';
        username: string;
        email: string;
        name: string;
        session: string;
      } = { type: 'initial' };

  @service declare private matrixService: MatrixService;

  private get currentPage() {
    if (['initial', 'validateEmail', 'register'].includes(this.state.type)) {
      return 'registration-form';
    } else if (['askForToken', 'sendToken'].includes(this.state.type)) {
      return 'token-form';
    } else if (this.state.type === 'waitForAccountCreation') {
      return 'account-creation';
    } else {
      return 'awaiting-validation';
    }
  }

  private get isRegisterButtonDisabled() {
    return Boolean(
      this.hasRegistrationMissingField ||
      this.hasRegistrationError ||
      this.doRegistrationFlow.isRunning,
    );
  }

  private get hasRegistrationMissingField() {
    return (
      !this.email || !this.name || !this.username || !this.credentials.complete
    );
  }

  private get hasRegistrationError() {
    return this.emailError || this.nameError || this.usernameError;
  }

  private get isNextButtonDisabled() {
    return !this.token || this.doRegistrationFlow.isRunning;
  }

  private get isUsernameValidAndAvailable() {
    return (
      Boolean(this.username) &&
      !this.usernameError &&
      !this.checkUsernameAvailability.isRunning &&
      this.isUsernameAvailable
    );
  }

  private get usernameInputState() {
    if (this.usernameError) {
      return 'invalid';
    } else if (this.checkUsernameAvailability.isRunning) {
      return 'loading';
    } else if (this.isUsernameAvailable) {
      return 'valid';
    } else {
      return 'initial';
    }
  }

  @action
  private setToken(token: string) {
    this.token = token;
    this.tokenError = undefined;
  }

  @action
  private setEmail(email: string) {
    this.email = email;
    this.emailError = undefined;
  }

  @action
  private setName(name: string) {
    this.name = name;
    this.nameError = undefined;
  }

  @action
  private setUsername(username: string) {
    this.username = username;
    this.usernameError = undefined;
    this.credentials.setContext({ username });
  }

  @action
  private checkEmail() {
    if (!this.email) {
      this.emailError = 'Email address is missing';
    }
  }

  @action
  private checkName() {
    if (!this.name) {
      this.nameError = 'Your name is missing';
    }
  }

  @action
  private checkUsername() {
    if (!this.username) {
      this.usernameError = 'Username is missing';
    }
    this.checkUsernameAvailability.perform();
  }

  private checkUsernameAvailability = restartableTask(async () => {
    // Block usernames that may collide with realm or realm server API
    if (this.username.startsWith('_')) {
      this.usernameError = 'Username cannot start with an underscore';
      return;
    }

    // Block usernames that may collide with realm users
    if (this.username.startsWith('realm/')) {
      this.usernameError = 'Username cannot start with "realm/"';
      return;
    }

    this.isUsernameAvailable = await this.matrixService.isUsernameAvailable(
      this.username,
    );
    if (!this.isUsernameAvailable) {
      this.usernameError = 'Username is already taken';
    }
  });

  @action
  private async register(ev: Event) {
    ev.preventDefault();
    if (!(await this.credentials.validate())) {
      return;
    }
    if (this.state.type !== 'initial') {
      throw new Error(
        `invalid state: cannot register() in state ${this.state.type}`,
      );
    }
    this.state = {
      type: 'validateEmail',
      username: this.username,
      email: this.email,
      name: this.name,
    };
    this.validateEmail.perform().catch((e) => {
      console.log('Error registering', e);

      let extractedError = extractRegistrationErrorMessage(e);
      let errorText = extractedError || e.message;

      this.formError = `There was an error registering: ${errorText}`;

      if (!extractedError) {
        throw e;
      }
    });
  }

  @action
  private sendToken(ev: Event) {
    ev.preventDefault();
    if (this.state.type !== 'askForToken') {
      throw new Error(
        `invalid state: cannot sendToken() in state ${this.state.type}`,
      );
    }
    if (!this.token) {
      throw new Error(
        `bug: should never get here: next button disabled when no token`,
      );
    } else {
      this.state = {
        ...this.state,
        token: this.token,
        type: 'sendToken',
      };
      this.doRegistrationFlow.perform().catch((e) => {
        console.log('Error verifying token', e);

        let extractedError = extractTokenErrorMessage(e);
        let errorText =
          extractedError ||
          'This registration token does not exist or has exceeded its usage limit.';
        this.tokenError = errorText;

        if (!extractedError) {
          throw e;
        }
      });
    }
  }

  @action private resendValidation() {
    if (
      this.state.type === 'initial' ||
      this.state.type === 'validateEmail' ||
      this.state.type === 'login'
    ) {
      throw new Error(
        `invalid state: cannot resendValidation() in state ${this.state.type}`,
      );
    }
    this.state.sendAttempt++;
    let { clientSecret, sendAttempt } = this.state;
    this.validateEmail.perform(clientSecret, sendAttempt);
  }

  private validateEmail = restartableTask(
    async (clientSecret: string = uuidv4(), sendAttempt = 1) => {
      if (
        this.state.type !== 'validateEmail' &&
        this.state.type !== 'waitForEmailValidation'
      ) {
        throw new Error(
          `invalid state: cannot validateEmail() in state ${this.state.type}`,
        );
      }

      if (!this.email) {
        throw new Error(
          `bug: should never get here: validate button disabled when no email`,
        );
      }
      let email = this.email;
      let res: IRequestTokenResponse | undefined;
      try {
        res = await this.matrixService.requestRegisterEmailToken(
          email,
          clientSecret,
          sendAttempt,
        );
      } catch (e: any) {
        if (e.status === 400 && e.data.errcode === 'M_THREEPID_IN_USE') {
          this.emailError =
            'Email address is already attached to a Boxel account';
        }
        if (this.state.type === 'validateEmail') {
          this.state = { type: 'initial' };
        }
        throw e;
      }

      if (this.state.type === 'validateEmail') {
        let { sid } = res;
        this.state = {
          ...this.state,
          type: 'register',
          sid,
          clientSecret,
          sendAttempt,
        };
      }
      return this.doRegistrationFlow.perform();
    },
  );

  // This is how matrix registration works, it will return MatrixErrors that
  // guide us thru a particular multi-request "flow". We can continue to expect
  // error responses as we retry the registration endpoint after each step of
  // the registration until the final step which results in a new user (and
  // successful HTTP response)
  private doRegistrationFlow = restartableTask(async () => {
    if (this.state.type === 'initial' || this.state.type === 'validateEmail') {
      throw new Error(
        `invalid state: cannot doRegistrationFlow() in state ${this.state.type}`,
      );
    }
    let auth: RegisterResponse;

    try {
      let result = await this.credentials.submit({
        operation: 'register',
        args: {
          username: this.state.username,
          auth: {
            session:
              this.state.type !== 'register' ? this.state.session : undefined,
            type: MATRIX_REGISTRATION_TYPES[this.state.type],
            ...(this.state.type === 'sendToken'
              ? { token: this.state.token }
              : {}),
            threepid_creds:
              this.state.type !== 'login'
                ? {
                    sid: this.state.sid,
                    client_secret: this.state.clientSecret,
                  }
                : {},
          },
        },
      });
      if (!result.ok) {
        throw credentialFieldsError(result);
      }
      auth = result.body as RegisterResponse;
    } catch (e: any) {
      let maybeRegistrationFlow = e.data;
      if (
        isInteractiveAuth(maybeRegistrationFlow) &&
        maybeRegistrationFlow.flows.length > 0
      ) {
        let nextStage = nextUncompletedStage(maybeRegistrationFlow);
        await this.nextStateFromResponse(nextStage, maybeRegistrationFlow);
      } else if (isMatrixError(e) && e.errcode === 'M_USER_IN_USE') {
        if (this.state.type === 'login') {
          throw new Error(
            `invalid state: cannot doRegistrationFlow() with errcode '${e.errcode}' in state ${this.state.type}`,
          );
        }
        this.usernameError = 'Username is already taken';
        this.state = { type: 'initial' };
      }

      throw e;
    }

    // If access_token and device_id are present, RegisterResponse matches LoginResponse
    // except for the optional well_known field
    if (
      auth.access_token &&
      auth.device_id &&
      this.state.type === 'waitForEmailValidation' // In our setup, waiting for email validation is the last step of matrix registration - this condition is to satisfy the type check where token is only defined in sendToken and waitForEmailValidation states
    ) {
      this.state = {
        ...this.state,
        type: 'waitForAccountCreation',
      };

      await this.matrixService.initializeNewUser(
        auth as LoginResponse,
        this.state.name,
        this.state.token,
      );

      // The bootstrap above is account-level (personal realm, realm auth) and
      // persists regardless of which device it ran on. Registration mints
      // exactly one device; when a caller wants that device (rather than the
      // browser keeping it), hand it over here — the operator-mode path leaves
      // onComplete undefined and stays signed in as usual.
      this.args.onComplete?.(auth as LoginResponse);
    }
  });

  private async nextStateFromResponse(
    nextStage: string,
    registrationFlows: InteractiveAuth,
  ) {
    let { session } = registrationFlows;
    if (
      this.state.type === 'initial' ||
      this.state.type === 'validateEmail' ||
      this.state.type === 'login'
    ) {
      throw new Error(
        `invalid state: cannot do nextStateFromResponse() in state ${this.state.type}`,
      );
    }
    switch (nextStage) {
      case 'm.login.email.identity':
        // If current type is already 'waitForEmailValidation',
        // it means we are polling the validation.
        if (this.state.type === 'waitForEmailValidation') {
          await timeout(1000);
        }

        this.state = {
          ...this.state,
          type: 'waitForEmailValidation',
          session,
        };
        this.doRegistrationFlow.perform();
        return;
      case 'm.login.registration_token':
        if (registrationFlows.error) {
          this.tokenError = registrationFlows.error;
        }
        this.state = {
          ...this.state,
          type: 'askForToken',
          session,
        };
        return;
      case 'm.login.dummy':
        this.state = {
          ...this.state,
          type: 'login',
          session,
        };
        this.doRegistrationFlow.perform();
        return;
      default:
        throw new Error(
          `Don't know to to handle registration stage ${nextStage}`,
        );
    }
  }
}

const NO_NETWORK_ERROR_RAW = 'Failed to fetch';
const NO_NETWORK_ERROR = 'Could not connect to server';

function extractRegistrationErrorMessage(error: Error) {
  if (error.message.includes('Registration has been disabled')) {
    return 'Registration has been disabled';
  } else if (error.message.includes('Unable to parse email address')) {
    return 'Email address is invalid';
  } else if (error.message.includes(NO_NETWORK_ERROR_RAW)) {
    return NO_NETWORK_ERROR;
  }

  return false;
}

function extractTokenErrorMessage(error: Error) {
  if (error.message.includes(NO_NETWORK_ERROR_RAW)) {
    return NO_NETWORK_ERROR;
  }

  return false;
}
