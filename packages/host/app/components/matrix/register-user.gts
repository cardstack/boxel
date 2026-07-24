import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { action } from '@ember/object';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import { v4 as uuidv4 } from 'uuid';

import {
  BoxelInput,
  BoxelInputGroup,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CheckMark } from '@cardstack/boxel-ui/icons';

import ENV from '@cardstack/host/config/environment';
import {
  isMatrixError,
  isValidPassword,
  isInteractiveAuth,
  nextUncompletedStage,
  type InteractiveAuth,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import AuthButton from './auth-button';
import AuthFormField from './auth-form-field';

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
  };
}

export default class RegisterUser extends Component<Signature> {
  <template>
    {{#if (eq this.currentPage 'awaiting-validation')}}
      <span class='title' data-test-email-validation>Please check your email to
        complete registration</span>
      <ul class='email-validation-instruction'>
        <li>Leave this window open while we verify your email</li>
        <li>This screen will update once your email is verified</li>
      </ul>
      <AuthButton
        data-test-resend-validation
        {{on 'click' this.resendValidation}}
        class='resend-email'
        @variant='primary'
        @disabled={{this.validateEmail.isRunning}}
        @loading={{this.validateEmail.isRunning}}
      >Resend Email</AuthButton>
    {{else if (eq this.currentPage 'account-creation')}}
      <div class='centered-loading'>
        <span class='loading-title' data-test-email-validation-complete>Email
          validation complete</span>
        <p class='loading-message'>Please wait as we set up your account.</p>
        <LoadingIndicator class='loading-spinner' />
      </div>
    {{else if (eq this.currentPage 'token-form')}}
      <span class='title'>Boxel is currently invite-only.<br />Enter your invite
        code here.</span>
      <AuthFormField @label='Your invite code'>
        <BoxelInput
          data-test-token-field
          @state={{this.tokenInputState}}
          @value={{this.token}}
          @placeholder='Enter invite code'
          @errorMessage={{this.tokenError}}
          @onInput={{this.setToken}}
        />
      </AuthFormField>
      <div class='button-wrapper'>
        <AuthButton
          data-test-next-btn
          @variant='primary'
          @disabled={{this.isNextButtonDisabled}}
          @loading={{this.doRegistrationFlow.isRunning}}
          {{on 'click' this.sendToken}}
        >Next</AuthButton>
      </div>
    {{else if (eq this.currentPage 'registration-form')}}
      <span class='title'>Create a Boxel Account</span>
      <form data-test-register-form {{on 'submit' this.register}}>
        <AuthFormField @label='Your Name'>
          <BoxelInput
            data-test-name-field
            @state={{this.nameInputState}}
            @value={{this.name}}
            @placeholder='Enter your name'
            @errorMessage={{this.nameError}}
            @onInput={{this.setName}}
            @onBlur={{this.checkName}}
          />
        </AuthFormField>
        <AuthFormField @label='Email'>
          <BoxelInput
            data-test-email-field
            name='email'
            autocomplete='email'
            @state={{this.emailInputState}}
            @value={{this.email}}
            @placeholder='Enter your email'
            @errorMessage={{this.emailError}}
            @onInput={{this.setEmail}}
            @onBlur={{this.checkEmail}}
          />
        </AuthFormField>
        <AuthFormField @label='Username'>
          <BoxelInputGroup
            data-test-username-field
            id='boxel-register-username'
            @name='username'
            @autocomplete='username'
            @state={{this.usernameInputState}}
            @value={{this.username}}
            @placeholder='Your username'
            @errorMessage={{this.usernameError}}
            @onInput={{this.setUsername}}
            @onBlur={{this.checkUsername}}
            @validIcon={{CheckMark}}
          >
            <:before as |Accessories|>
              <Accessories.Text class='username-prefix'>@</Accessories.Text>
            </:before>
            <:after as |Accessories|>
              <Accessories.Text>{{matrixServerName}}</Accessories.Text>
            </:after>
          </BoxelInputGroup>
          {{#if this.isUsernameValidAndAvailable}}
            <p class='validation-hint' data-test-username-available><CheckMark
                class='validation-hint-icon'
              />name available</p>
          {{/if}}
        </AuthFormField>
        <AuthFormField @label='Password'>
          <BoxelInput
            data-test-password-field
            id='boxel-register-password'
            name='password'
            autocomplete='new-password'
            @type='password'
            @value={{this.password}}
            @placeholder='Your password'
            @state={{this.passwordInputState}}
            @errorMessage={{this.passwordError}}
            @onInput={{this.setPassword}}
            @onBlur={{this.checkPassword}}
          />
          {{#if this.isPasswordValid}}
            <p class='validation-hint' data-test-password-valid><CheckMark
                class='validation-hint-icon'
              />password is valid</p>
          {{/if}}
        </AuthFormField>
        <AuthFormField @label='Confirm Password'>
          <BoxelInput
            data-test-confirm-password-field
            id='boxel-register-confirm-password'
            name='confirm-password'
            autocomplete='new-password'
            @type='password'
            @value={{this.confirmPassword}}
            @placeholder='Re-enter your password'
            @state={{this.confirmPasswordInputState}}
            @errorMessage={{this.confirmPasswordError}}
            @onInput={{this.setConfirmPassword}}
            @onBlur={{this.checkConfirmPassword}}
          />
          {{#if this.isConfirmPasswordValid}}
            <p class='validation-hint' data-test-passwords-match><CheckMark
                class='validation-hint-icon'
              />passwords match</p>
          {{/if}}
        </AuthFormField>
        {{#if this.formError}}
          <div
            class='error-message'
            data-test-register-user-error
          >{{this.formError}}</div>
        {{/if}}
        <div class='button-wrapper'>
          <AuthButton
            data-test-register-btn
            @variant='primary'
            @disabled={{this.isRegisterButtonDisabled}}
            @loading={{this.doRegistrationFlow.isRunning}}
            {{on 'click' this.register}}
          >Create Account</AuthButton>
          <div>or</div>
          <AuthButton
            data-test-cancel-btn
            @variant='secondary'
            {{on 'click' (fn @setMode 'login')}}
          >Login with an existing account</AuthButton>
        </div>
      </form>
    {{/if}}
    <style scoped>
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
      .validation-hint {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        margin: var(--boxel-sp-2xs) 0 0;
        color: var(--muted-foreground);
        font: 500 var(--boxel-font-xs);
      }
      .validation-hint-icon {
        --icon-color: var(--boxel-highlight);
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
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
    </style>
  </template>
  @tracked private email = '';
  @tracked private name = '';
  @tracked private username = '';
  @tracked private password = '';
  @tracked private confirmPassword = '';
  @tracked private token = '';
  @tracked private formError: string | undefined;
  @tracked private emailError: string | undefined;
  @tracked private nameError: string | undefined;
  @tracked private usernameError: string | undefined;
  @tracked private tokenError: string | undefined;
  @tracked private passwordError: string | undefined;
  @tracked private confirmPasswordError: string | undefined;
  @tracked private isUsernameAvailable = false;
  @tracked private state:
    | { type: 'initial' }
    | {
        type: 'validateEmail';
        username: string;
        password: string;
        email: string;
        name: string;
      }
    | {
        type: 'register';
        username: string;
        password: string;
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
        password: string;
        email: string;
        name: string;
        clientSecret: string;
        sid: string;
        sendAttempt: number;
      }
    | {
        type: 'sendToken';
        username: string;
        password: string;
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
        password: string;
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
        password: string;
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
      !this.email ||
      !this.name ||
      !this.username ||
      !this.password ||
      !this.confirmPassword
    );
  }

  private get hasRegistrationError() {
    return (
      this.emailError ||
      this.nameError ||
      this.usernameError ||
      this.passwordError ||
      this.confirmPasswordError
    );
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

  private get isPasswordValid() {
    return (
      Boolean(this.password) &&
      !this.passwordError &&
      isValidPassword(this.password)
    );
  }

  private get isConfirmPasswordValid() {
    return (
      Boolean(this.confirmPassword) &&
      !this.confirmPasswordError &&
      this.confirmPassword === this.password
    );
  }

  private get nameInputState() {
    return this.nameError ? 'invalid' : 'initial';
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

  private get passwordInputState() {
    return this.passwordError ? 'invalid' : 'initial';
  }

  private get confirmPasswordInputState() {
    return this.confirmPasswordError ? 'invalid' : 'initial';
  }

  private get tokenInputState() {
    return this.tokenError ? 'invalid' : 'initial';
  }

  private get emailInputState() {
    return this.emailError ? 'invalid' : 'initial';
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
  }

  @action
  private setPassword(password: string) {
    this.password = password;
    this.passwordError = undefined;
  }

  @action
  private setConfirmPassword(password: string) {
    this.confirmPassword = password;
    this.confirmPasswordError = undefined;
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
  private checkPassword() {
    if (!this.password) {
      this.passwordError = 'Password is missing';
    } else if (!isValidPassword(this.password)) {
      this.passwordError = 'Password must be at least 8 characters long';
    }
  }

  @action
  private checkConfirmPassword() {
    if (this.confirmPassword !== this.password) {
      this.confirmPasswordError = 'Passwords do not match';
    }
  }

  @action
  private register(ev: Event) {
    ev.preventDefault();
    if (this.state.type !== 'initial') {
      throw new Error(
        `invalid state: cannot register() in state ${this.state.type}`,
      );
    }
    this.state = {
      type: 'validateEmail',
      username: this.username,
      password: this.password,
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
  private sendToken() {
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
      auth = await this.matrixService.registerRequest({
        username: this.state.username,
        password: this.state.password,
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
      });
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
