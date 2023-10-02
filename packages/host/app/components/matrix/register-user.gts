import { on } from '@ember/modifier';
import { v4 as uuidv4 } from 'uuid';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import difference from 'lodash/difference';
import { type IAuthData, type IRequestTokenResponse } from 'matrix-js-sdk';

import {
  BoxelHeader,
  BoxelInput,
  BoxelInputValidationState,
  LoadingIndicator,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';

import { eq } from '@cardstack/host/helpers/truth-helpers';
import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

const MATRIX_REGISTRATION_TYPES = {
  sendToken: 'm.login.registration_token',
  login: 'm.login.dummy',
  askForToken: undefined,
  register: undefined,
};

interface Args {
  Args: {
    onCancel: () => void;
  };
}

export default class RegisterUser extends Component<Args> {
  <template>
    <BoxelHeader @title='Register User' @hasBackground={{true}} />
    <div class='registration-form' data-test-register-user>
      {{#if this.showEmailValidationStatus}}
        <div class='email-field'>
          <span class='label'>Email:</span>
          <span class='email'>
            {{! @glint-ignore glint doesn't understand what state we are in here}}
            {{this.state.email}}
          </span>
          {{#if this.isEmailValidated}}
            <span class='email-validated' data-test-email-validated>
              {{svgJar 'check-mark' width='27' height='27'}}
            </span>
          {{else}}
            <div class='notice'>
              Please check your email for a validation message and click the
              link within the email (TODO add "resend" button).</div>
          {{/if}}
        </div>

      {{/if}}
      {{#if this.doRegistrationFlow.isRunning}}
        <LoadingIndicator />
      {{else if (eq this.state.type 'askForToken')}}
        <FieldContainer @label='Registration Token:' @tag='label'>
          <BoxelInputValidationState
            data-test-token-field
            @id=''
            @state={{this.tokenInputState}}
            @value={{this.cleanToken}}
            @errorMessage={{this.tokenError}}
            @onInput={{this.setToken}}
          />
        </FieldContainer>
        <div class='button-wrapper'>
          <Button data-test-cancel-btn {{on 'click' @onCancel}}>Cancel</Button>
          <Button
            data-test-next-btn
            @kind='primary'
            @disabled={{this.isNextButtonDisabled}}
            {{on 'click' this.sendToken}}
          >Next</Button>
        </div>
      {{else if (eq this.state.type 'askForUserCreds')}}
        <FieldContainer
          @label='Username:'
          @tag='label'
          class='registration-field'
        >
          <BoxelInputValidationState
            data-test-username-field
            @id=''
            @state={{this.usernameInputState}}
            @value={{this.cleanUsername}}
            @errorMessage={{this.usernameError}}
            @onInput={{this.setUsername}}
          />
        </FieldContainer>
        <FieldContainer
          @label='Password:'
          @tag='label'
          class='registration-field'
        >
          <BoxelInput
            data-test-password-field
            type='password'
            @value={{this.password}}
            @onInput={{this.setPassword}}
          />
        </FieldContainer>
        <div class='button-wrapper'>
          <Button data-test-cancel-btn {{on 'click' @onCancel}}>Cancel</Button>
          <Button
            data-test-register-btn
            @kind='primary'
            @disabled={{this.isRegisterButtonDisabled}}
            {{on 'click' this.register}}
          >Register</Button>
        </div>
      {{else if (eq this.state.type 'initial')}}
        <FieldContainer @label='Email:' @tag='label' class='registration-field'>
          <BoxelInputValidationState
            data-test-email-field
            @id=''
            @state={{this.emailInputState}}
            @value={{this.cleanEmail}}
            @errorMessage={{this.emailError}}
            @onInput={{this.setEmail}}
          />
        </FieldContainer>
        <div class='button-wrapper'>
          <Button data-test-cancel-btn {{on 'click' @onCancel}}>Cancel</Button>
          <Button
            data-test-validate-btn
            @kind='primary'
            @disabled={{this.isValidateButtonDisabled}}
            {{on 'click' (perform this.validateEmail)}}
          >Validate Email</Button>
        </div>
      {{/if}}
    </div>

    <style>
      .registration-form {
        padding: var(--boxel-sp);
      }

      .button-wrapper button {
        margin-left: var(--boxel-sp-xs);
      }

      .button-wrapper {
        display: flex;
        justify-content: flex-end;
        padding-top: var(--boxel-sp-sm);
      }
      .registration-field {
        margin-top: var(--boxel-sp-sm);
      }
    </style>
  </template>

  @tracked private usernameError: string | undefined;
  @tracked private tokenError: string | undefined;
  @tracked private email: string | undefined;
  @tracked private isEmailValidated = false;
  @tracked private emailError: string | undefined;
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @tracked private token: string | undefined;
  @tracked private state:
    | { type: 'initial' }
    | {
        type: 'askForUserCreds';
        session: string;
        email: string;
        clientSecret: string;
        sid: string;
      }
    | {
        type: 'register';
        session: string;
        username: string;
        password: string;
        email: string;
        clientSecret: string;
        sid: string;
      }
    | {
        type: 'askForToken';
        session: string;
        username: string;
        password: string;
        email: string;
        clientSecret: string;
        sid: string;
      }
    | {
        type: 'sendToken';
        username: string;
        password: string;
        token: string;
        session: string;
        email: string;
        clientSecret: string;
        sid: string;
      }
    | {
        type: 'waitForEmailValidation';
        username: string;
        password: string;
        token?: string;
        session: string;
        email: string;
        clientSecret: string;
        sid: string;
      }
    // TODO we'll need to also add a CAPTCHA state
    // this will be probably impossible to test
    // since the whole point of CAPTCHA is to detect
    // human interaction
    | {
        type: 'login';
        username: string;
        password: string;
        session: string;
      } = { type: 'initial' };

  @service private declare matrixService: MatrixService;

  private get showEmailValidationStatus() {
    return (
      [
        'askForUserCreds',
        'register',
        'askForToken',
        'sendToken',
        'waitForEmailValidation',
      ].includes(this.state.type) && !this.doRegistrationFlow.isRunning
    );
  }

  private get isRegisterButtonDisabled() {
    return !this.username || !this.password;
  }

  private get isValidateButtonDisabled() {
    return !this.email;
  }

  private get isNextButtonDisabled() {
    return !this.token;
  }

  private get cleanUsername() {
    return this.username || '';
  }

  private get cleanToken() {
    return this.token || '';
  }

  private get cleanEmail() {
    return this.email || '';
  }

  private get usernameInputState() {
    return this.usernameError ? 'invalid' : 'initial';
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
  private setUsername(username: string) {
    this.username = username;
    this.usernameError = undefined;
  }

  @action
  private setPassword(password: string) {
    this.password = password;
  }

  @action
  private register() {
    if (this.state.type !== 'askForUserCreds') {
      throw new Error(
        `invalid state: cannot register() in state ${this.state.type}`,
      );
    }
    if (!this.username) {
      throw new Error(
        `bug: should never get here: register button disabled when no username`,
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: register button disabled when no password`,
      );
    } else {
      this.state = {
        ...this.state,
        type: 'register',
        username: this.username,
        password: this.password,
      };
      this.doRegistrationFlow.perform();
    }
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
      this.doRegistrationFlow.perform();
    }
  }

  private validateEmail = restartableTask(async () => {
    if (!this.email) {
      throw new Error(
        `bug: should never get here: validate button disabled when no email`,
      );
    }
    let email = this.email;
    let clientSecret = uuidv4();
    let res: IRequestTokenResponse | undefined;
    try {
      res = await this.matrixService.requestRegisterEmailToken(
        email,
        clientSecret,
        1,
      );
    } catch (e: any) {
      if (e.status === 400 && e.data.errcode === 'M_THREEPID_IN_USE') {
        this.emailError = e.message;
        return;
      }
      throw e;
    }
    let { sid } = res;
    await this.checkEmailValidation.perform({
      sid,
      clientSecret,
      onSession: (session) => {
        this.state = {
          type: 'askForUserCreds',
          email,
          sid,
          clientSecret,
          session,
        };
      },
    });
  });

  private checkEmailValidation = restartableTask(
    async (opts?: {
      sid: string;
      clientSecret: string;
      onSession: (session: string) => void;
    }) => {
      let auth: IAuthData | undefined;
      if (this.state.type === 'login') {
        throw new Error(
          `invalid state: cannot checkEmailValidation() in state ${this.state.type}`,
        );
      }
      let username: string | undefined;
      let password: string | undefined;
      let session: string | undefined;
      let sid = opts?.sid;
      let clientSecret = opts?.clientSecret;

      if (
        this.state.type !== 'initial' &&
        this.state.type !== 'askForUserCreds'
      ) {
        ({ username, password } = this.state);
      }
      if (this.state.type !== 'initial') {
        ({ session, session, sid, clientSecret } = this.state);
      }
      if (!sid || !clientSecret) {
        throw new Error(
          `bug: Missing sid/clientSecret param for checkEmailValidation() in state ${this.state.type}`,
        );
      }
      try {
        auth = await this.matrixService.client.registerRequest({
          username,
          password,
          auth: {
            ...(session ? { session } : {}),
            type: 'm.login.email.identity',
            threepid_creds: {
              sid,
              client_secret: clientSecret,
            },
          } as IAuthData, // IAuthData doesn't seem to know about threepid_creds...
        });
      } catch (e: any) {
        let maybeRegistrationFlow = e.data;
        if (isRegistrationFlows(maybeRegistrationFlow)) {
          if (opts?.onSession) {
            opts.onSession(maybeRegistrationFlow.session);
          }
          if (
            (maybeRegistrationFlow.completed ?? []).includes(
              'm.login.email.identity',
            )
          ) {
            this.isEmailValidated = true;
          }
        }
        if (!this.isEmailValidated) {
          await timeout(5 * 1000);
          this.checkEmailValidation.perform();
        }
      }
      if (auth) {
        await this.matrixService.start(auth);
        this.args.onCancel();
      }
    },
  );

  // This is how matrix registration works, it will return MatrixErrors that
  // guide us thru a particular multi-request "flow". We can continue to expect
  // error responses as we retry the registration endpoint after each step of
  // the registration until the final step which results in a new user (and
  // successful HTTP response)
  private doRegistrationFlow = restartableTask(async () => {
    if (
      this.state.type === 'initial' ||
      this.state.type === 'askForUserCreds' ||
      this.state.type === 'waitForEmailValidation'
    ) {
      throw new Error(
        `invalid state: cannot doRegistrationFlow() in state ${this.state.type}`,
      );
    }
    let auth: IAuthData | undefined;
    try {
      auth = await this.matrixService.client.registerRequest({
        username: this.state.username,
        password: this.state.password,
        auth: {
          session: this.state.session,
          type: MATRIX_REGISTRATION_TYPES[this.state.type],
          ...(this.state.type === 'sendToken'
            ? { token: this.state.token }
            : {}),
        },
      });
    } catch (e: any) {
      let maybeRegistrationFlow = e.data;
      if (
        isRegistrationFlows(maybeRegistrationFlow) &&
        maybeRegistrationFlow.flows.length > 0
      ) {
        let remainingStages = difference(
          maybeRegistrationFlow.flows[0].stages,
          maybeRegistrationFlow.completed ?? [],
        );
        if (remainingStages.length === 0) {
          throw new Error(
            `Completed all registration stages but encountered unsuccessful registration response: ${JSON.stringify(
              e.data,
              null,
              2,
            )}`,
          );
        }
        let nextStage = remainingStages[0];
        this.nextStateFromResponse(nextStage, maybeRegistrationFlow);
      } else if (isMatrixError(e) && e.errcode === 'M_USER_IN_USE') {
        this.usernameError = e.data.error;
        this.state = { type: 'initial' };
      } else {
        throw e;
      }
    }

    if (auth) {
      await this.matrixService.start(auth);
      this.args.onCancel();
    }
  });

  private nextStateFromResponse(
    nextStage: string,
    registrationFlows: RegistrationFlows,
  ) {
    let { session } = registrationFlows;
    if (
      this.state.type === 'initial' ||
      this.state.type === 'askForUserCreds' ||
      this.state.type === 'waitForEmailValidation' ||
      this.state.type === 'login'
    ) {
      throw new Error(
        `invalid state: cannot do nextStateFromResponse() in state ${this.state.type}`,
      );
    }
    this.state.type;
    switch (nextStage) {
      case 'm.login.email.identity':
        this.state = {
          ...this.state,
          type: 'waitForEmailValidation',
          session,
        };
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

interface RegistrationFlows {
  completed?: string[];
  session: string;
  flows: Flow[];
  error?: string;
  errcode?: string;
}

interface Flow {
  stages: string[];
}

function isFlow(flow: any): flow is Flow {
  if (
    typeof flow === 'object' &&
    'stages' in flow &&
    Array.isArray(flow.stages)
  ) {
    if (flow.stages.find((s: any) => typeof s !== 'string')) {
      return false;
    }
    return true;
  }
  return false;
}

function isRegistrationFlows(
  registration: any,
): registration is RegistrationFlows {
  if (
    typeof registration === 'object' &&
    'session' in registration &&
    typeof registration.session === 'string' &&
    'flows' in registration &&
    Array.isArray(registration.flows)
  ) {
    if ('error' in registration && typeof registration.error !== 'string') {
      return false;
    }
    if ('errcode' in registration && typeof registration.errcode !== 'string') {
      return false;
    }
    if ('completed' in registration && !Array.isArray(registration.completed)) {
      return false;
    }
    if (
      'completed' in registration &&
      registration.completed.length > 0 &&
      registration.completed.find((c: any) => typeof c !== 'string')
    ) {
      return false;
    }

    return registration.flows.every((f: any) => isFlow(f));
  }
  return false;
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface RegisterUser {
    'Matrix::RegisterUser': typeof RegisterUser;
  }
}
