import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

import {
  type RegisterResponse,
  type IRequestTokenResponse,
  type LoginResponse,
} from 'matrix-js-sdk';
import { v4 as uuidv4 } from 'uuid';

import {
  BoxelInput,
  BoxelInputGroup,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import ENV from '@cardstack/host/config/environment';
import {
  isMatrixError,
  isValidPassword,
  isInteractiveAuth,
  nextUncompletedStage,
  type InteractiveAuth,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { AuthMode } from './auth';

const MATRIX_REGISTRATION_TYPES = {
  sendToken: 'm.login.registration_token',
  login: 'm.login.dummy',
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
    {{#if (eq this.currentPage 'waiting-page')}}
      <span class='title' data-test-email-validation>Please check your email to
        complete registration.</span>
      <ul class='email-validation-instruction'>
        <li>Leave this window open while we verify your email</li>
        <li>This screen will update once your email is verified</li>
      </ul>
      <Button
        data-test-resend-validation
        {{on 'click' this.resendValidation}}
        class='resend-email'
        @kind='primary'
        @disabled={{this.validateEmail.isRunning}}
        @loading={{this.validateEmail.isRunning}}
      >Resend Email</Button>
    {{else if (eq this.currentPage 'token-form')}}
      <FieldContainer
        @label='Registration Token'
        @tag='label'
        class='registration-field'
        @vertical={{true}}
      >
        <BoxelInput
          data-test-token-field
          @state={{this.tokenInputState}}
          @value={{this.token}}
          @errorMessage={{this.tokenError}}
          @onInput={{this.setToken}}
        />
      </FieldContainer>
      <div class='button-wrapper'>
        <Button
          data-test-next-btn
          class='button'
          @kind='primary'
          @disabled={{this.isNextButtonDisabled}}
          @loading={{this.doRegistrationFlow.isRunning}}
          {{on 'click' this.sendToken}}
        >Next</Button>
      </div>
    {{else if (eq this.currentPage 'registration-form')}}
      <span class='title'>Create a Boxel Account</span>
      <FieldContainer
        @label='Your Name'
        @tag='label'
        @vertical={{true}}
        class='registration-field'
      >
        <BoxelInput
          data-test-name-field
          @state={{this.nameInputState}}
          @value={{this.name}}
          @errorMessage={{this.nameError}}
          @onInput={{this.setName}}
          @onBlur={{this.checkName}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Email'
        @tag='label'
        @vertical={{true}}
        class='registration-field'
      >
        <BoxelInput
          data-test-email-field
          @state={{this.emailInputState}}
          @value={{this.email}}
          @errorMessage={{this.emailError}}
          @onInput={{this.setEmail}}
          @onBlur={{this.checkEmail}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Username'
        @tag='label'
        @vertical={{true}}
        class='registration-field'
      >
        <BoxelInputGroup
          data-test-username-field
          @state={{this.usernameInputState}}
          @value={{this.username}}
          @errorMessage={{this.usernameError}}
          @onInput={{this.setUsername}}
          @onBlur={{this.checkUsername}}
        >
          <:before as |Accessories|>
            <Accessories.Text class='username-prefix'>@</Accessories.Text>
          </:before>
          <:after as |Accessories|>
            <Accessories.Text>{{matrixServerName}}</Accessories.Text>
          </:after>
        </BoxelInputGroup>
      </FieldContainer>
      <FieldContainer
        @label='Password'
        @tag='label'
        @vertical={{true}}
        class='registration-field'
      >
        <BoxelInput
          data-test-password-field
          @type='password'
          @value={{this.password}}
          @state={{this.passwordInputState}}
          @errorMessage={{this.passwordError}}
          @onInput={{this.setPassword}}
          @onBlur={{this.checkPassword}}
        />
      </FieldContainer>
      <FieldContainer
        @label='Confirm Password'
        @tag='label'
        @vertical={{true}}
        class='registration-field'
      >
        <BoxelInput
          data-test-confirm-password-field
          @type='password'
          @value={{this.confirmPassword}}
          @state={{this.confirmPasswordInputState}}
          @errorMessage={{this.confirmPasswordError}}
          @onInput={{this.setConfirmPassword}}
          @onBlur={{this.checkConfirmPassword}}
        />
      </FieldContainer>
      {{#if this.formError}}
        <div
          class='error-message'
          data-test-register-user-error
        >{{this.formError}}</div>
      {{/if}}
      <div class='button-wrapper'>
        <Button
          data-test-register-btn
          class='button'
          @kind='primary'
          @disabled={{this.isRegisterButtonDisabled}}
          @loading={{this.doRegistrationFlow.isRunning}}
          {{on 'click' this.register}}
        >Create Account</Button>
        <span class='or'>or</span>
        <Button
          data-test-cancel-btn
          class='button'
          {{on 'click' (fn @setMode 'login')}}
        >Login with an existing account</Button>
      </div>
    {{/if}}
    <style>
      .title {
        font: 700 var(--boxel-font-med);
        margin-bottom: var(--boxel-sp-sm);
      }
      .button-wrapper {
        width: 100%;
        margin-top: var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .button {
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        --boxel-button-font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        width: 100%;
      }
      .or {
        margin: var(--boxel-sp-sm);
        font: 500 var(--boxel-font-sm);
      }
      .registration-field {
        margin-top: var(--boxel-sp);
      }
      .registration-field :deep(.text-accessory) {
        color: var(--boxel-highlight);
      }
      .registration-field :deep(.validation-icon-container.invalid) {
        display: none;
      }
      .registration-field
        :deep(.boxel-input-group--invalid > :nth-last-child(2)) {
        border-top-right-radius: var(--boxel-input-group-border-radius);
        border-bottom-right-radius: var(--boxel-input-group-border-radius);
        border-right-width: var(--boxel-input-group-interior-border-width);
      }
      .registration-field
        :deep(
          .boxel-input-group:not(.boxel-input-group--invalid)
            > :nth-last-child(2)
        ) {
        padding-right: 0;
      }
      .registration-field :deep(input:autofill) {
        transition:
          background-color 0s 600000s,
          color 0s 600000s;
      }
      .registration-field :deep(.error-message) {
        margin-left: 0;
      }
      .username-prefix {
        padding-right: 0;
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
      .resend-email {
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        --boxel-button-font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        width: fit-content;
        min-width: 148px;
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
        type: 'waitForEmailValidation';
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

  @service private declare matrixService: MatrixService;

  private get currentPage() {
    if (['initial', 'validateEmail', 'register'].includes(this.state.type)) {
      return 'registration-form';
    } else if (['askForToken', 'sendToken'].includes(this.state.type)) {
      return 'token-form';
    } else {
      return 'waiting-page';
    }
  }

  private get isRegisterButtonDisabled() {
    return (
      this.hasRegistrationMissingField ||
      this.hasRegistrationError ||
      this.doRegistrationFlow.isRunning
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
      this.usernameError = 'User Name is missing';
    }
    this.checkUsernameAvailability.perform();
  }

  private checkUsernameAvailability = restartableTask(async () => {
    this.isUsernameAvailable =
      await this.matrixService.client.isUsernameAvailable(this.username);
    if (!this.isUsernameAvailable) {
      this.usernameError = 'User Name is already taken';
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
  private register() {
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
        let errorText = extractedError || e.message;

        this.tokenError = `There was an error verifying token: ${errorText}`;

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
      auth = await this.matrixService.client.registerRequest({
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
        this.usernameError = 'User Name is already taken';
        this.state = { type: 'initial' };
      }

      throw e;
    }
    // If access_token and device_id are present, RegisterResponse matches LoginResponse
    // except for the optional well_known field
    if (auth.access_token && auth.device_id) {
      await this.matrixService.startAndSetDisplayName(
        auth as LoginResponse,
        this.state.name,
      );
      this.args.setMode('login');
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

declare module '@glint/environment-ember-loose/registry' {
  export default interface RegisterUser {
    'Matrix::RegisterUser': typeof RegisterUser;
  }
}
