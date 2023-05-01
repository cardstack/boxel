import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq } from '../helpers/truth-helpers';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { BoxelInput, Button, FieldContainer } from '@cardstack/boxel-ui';
import difference from 'lodash/difference';
import type MatrixService from '../services/matrix-service';
import { type IAuthData } from 'matrix-js-sdk';

const MATRIX_REGISTRATION_TYPES = {
  sendToken: 'm.login.registration_token',
  login: 'm.login.dummy',
  askForToken: undefined,
};

export default class MatrixRegister extends Component {
  <template>
    {{#if (eq this.state.type 'complete')}}
      <div data-test-registration-complete>The user
        {{! @glint-ignore: glint doesn't understand that only 'completed' state exists here }}
        <b>{{this.state.auth.user_id}}</b>
        has been created</div>
    {{else}}
      <fieldset>
        <legend>Register User</legend>
        {{#if (eq this.state.type 'askForToken')}}
          <FieldContainer @label='Registration Token:' @tag='label'>
            <BoxelInput
              type='text'
              @value={{this.token}}
              @onInput={{this.setToken}}
            />
          </FieldContainer>
          <Button {{on 'click' this.sendToken}}>Next</Button>
        {{/if}}
        {{#if (eq this.state.type 'initial')}}
          <FieldContainer @label='Username:' @tag='label'>
            <BoxelInput
              type='text'
              @value={{this.username}}
              @onInput={{this.setUsername}}
            />
          </FieldContainer>
          <FieldContainer @label='Password:' @tag='label'>
            {{! TODO create a boxel masked input field }}
            <BoxelInput
              type='text'
              @value={{this.password}}
              @onInput={{this.setPassword}}
            />
          </FieldContainer>
          {{! TODO disbale button until both username and password are provided }}
          <Button {{on 'click' this.register}}>Register</Button>
        {{/if}}
      </fieldset>
    {{/if}}
  </template>

  private username: string | undefined;
  private password: string | undefined;
  private token: string | undefined;
  @tracked
  private state:
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
    | {
        type: 'login';
        username: string;
        password: string;
        session: string;
      }
    | {
        type: 'complete';
        auth: IAuthData;
      } = { type: 'initial' };

  @service declare matrixService: MatrixService;

  @action
  setToken(token: string) {
    this.token = token;
  }

  @action
  setUsername(username: string) {
    // TODO the element UI app actually checks for a used username here....
    this.username = username;
  }

  @action
  setPassword(password: string) {
    this.password = password;
  }

  @action
  register() {
    if (!this.username) {
      // TODO show username error state
    } else if (!this.password) {
      // TODO show password error state
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
  sendToken() {
    if (this.state.type !== 'askForToken') {
      throw new Error(
        `invalid state: cannot sendToken() in state ${this.state.type}`
      );
    }
    if (!this.token) {
      // TODO show token error state
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
    if (this.state.type === 'initial' || this.state.type === 'complete') {
      throw new Error(
        `invalid state: cannot doRegistrationFlow() in state ${this.state.type}`
      );
    }
    try {
      let auth = await this.matrixService.client.registerRequest({
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
      this.state = {
        type: 'complete',
        auth,
      };
      // TODO get new matrix client from auth
    } catch (e: any) {
      let maybeRegistrationFlow = e.data;
      if (
        isRegistrationFlows(maybeRegistrationFlow) &&
        maybeRegistrationFlow.flows.length > 0
      ) {
        let remainingStages = difference(
          maybeRegistrationFlow.flows[0].stages,
          maybeRegistrationFlow.completed ?? []
        );
        if (remainingStages.length === 0) {
          throw new Error(
            `Completed all registration stages but encountered unsuccessful registration response: ${JSON.stringify(
              e.data,
              null,
              2
            )}`
          );
        }
        let nextStage = remainingStages[0];
        this.nextStateFromResponse(nextStage, maybeRegistrationFlow);
      } else {
        throw e;
      }
    }
  });

  nextStateFromResponse(
    nextStage: string,
    registrationFlows: RegistrationFlows
  ) {
    let { session } = registrationFlows;
    if (this.state.type === 'initial' || this.state.type === 'complete') {
      throw new Error(
        `invalid state: cannot do nextStateFromResponse() in state ${this.state.type}`
      );
    }
    switch (nextStage) {
      case 'm.login.registration_token':
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
          `Don't know to to handle registration stage ${nextStage}`
        );
    }
  }
}

interface RegistrationFlows {
  completed?: string[];
  session: string;
  flows: Flow[];
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
  registration: any
): registration is RegistrationFlows {
  if (
    typeof registration === 'object' &&
    'session' in registration &&
    typeof registration.session === 'string' &&
    'flows' in registration &&
    Array.isArray(registration.flows)
  ) {
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
  export default interface MatrixRegister {
    MatrixRegister: typeof MatrixRegister;
  }
}
