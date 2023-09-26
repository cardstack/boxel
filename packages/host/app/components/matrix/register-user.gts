import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import difference from 'lodash/difference';
import { type IAuthData } from 'matrix-js-sdk';

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
      {{else if (eq this.state.type 'initial')}}
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
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @tracked private token: string | undefined;
  @tracked private state:
    | { type: 'initial' }
    | {
        type: 'register';
        username: string;
        password: string;
      }
    | {
        type: 'askForToken';
        session: string;
        username: string;
        password: string;
      }
    | {
        type: 'sendToken';
        username: string;
        password: string;
        token: string;
        session: string;
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

  private get isRegisterButtonDisabled() {
    return !this.username || !this.password;
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

  private get usernameInputState() {
    return this.usernameError ? 'invalid' : 'initial';
  }

  private get tokenInputState() {
    return this.tokenError ? 'invalid' : 'initial';
  }

  @action
  private setToken(token: string) {
    this.token = token;
    this.tokenError = undefined;
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

  // This is how matrix registration works, it will return MatrixErrors that
  // guide us thru a particular multi-request "flow". We can continue to expect
  // error responses as we retry the registration endpoint after each step of
  // the registration until the final step which results in a new user (and
  // successful HTTP response)
  private doRegistrationFlow = restartableTask(async () => {
    if (this.state.type === 'initial') {
      throw new Error(
        `invalid state: cannot doRegistrationFlow() in state ${this.state.type}`,
      );
    }
    let auth: IAuthData | undefined;
    try {
      auth = await this.matrixService.client.registerRequest({
        username: this.state.username,
        password: this.state.password,
        ...(this.state.type !== 'register'
          ? {
              auth: {
                session: this.state.session,
                type: MATRIX_REGISTRATION_TYPES[this.state.type],
                ...(this.state.type === 'sendToken'
                  ? { token: this.state.token }
                  : {}),
              },
            }
          : {}),
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
    if (this.state.type === 'initial') {
      throw new Error(
        `invalid state: cannot do nextStateFromResponse() in state ${this.state.type}`,
      );
    }
    switch (nextStage) {
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
