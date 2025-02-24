import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { type LoginResponse } from 'matrix-js-sdk';
import moment from 'moment';

import {
  Button,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';

import {
  isMatrixError,
  type MatrixError,
} from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { AuthMode } from './auth';

interface Signature {
  Args: {
    setMode: (mode: AuthMode) => void;
  };
}

export default class Login extends Component<Signature> {
  <template>
    <span class='title'>Sign in to your Boxel Account</span>
    <FieldContainer
      @label='Email Address or Username'
      @tag='label'
      @vertical={{true}}
      class='field'
    >
      <BoxelInput
        data-test-username-field
        type='text'
        @value={{this.username}}
        @onInput={{this.setUsername}}
        @onKeyPress={{this.handleEnter}}
      />
    </FieldContainer>
    <FieldContainer
      @label='Password'
      @tag='label'
      @vertical={{true}}
      class='field'
    >
      <BoxelInput
        data-test-password-field
        type='password'
        @value={{this.password}}
        @onInput={{this.setPassword}}
        @onKeyPress={{this.handleEnter}}
      />
    </FieldContainer>
    <Button
      @kind='text-only'
      class='forgot-password'
      data-test-forgot-password
      {{on 'click' (fn @setMode 'forgot-password')}}
    >Forgot password?</Button>
    <Button
      class='button'
      data-test-login-btn
      @kind='primary'
      @disabled={{this.isLoginButtonDisabled}}
      @loading={{this.doLogin.isRunning}}
      {{on 'click' this.login}}
    >
      Sign in</Button>
    {{#if this.error}}
      <div class='error' data-test-login-error>{{this.error}}</div>
    {{/if}}
    <span class='or'>or</span>
    <Button
      class='button'
      data-test-register-user
      {{on 'click' (fn @setMode 'register')}}
    >Create a new Boxel account</Button>

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
      }
      .title {
        font: 600 var(--boxel-font-med);
        margin-bottom: var(--boxel-sp-sm);
        padding: 0;
      }
      .field {
        margin-top: var(--boxel-sp);
      }
      .field :deep(input:autofill) {
        transition:
          background-color 0s 600000s,
          color 0s 600000s;
      }
      .forgot-password {
        border: none;
        padding: 0;
        margin-bottom: var(--boxel-sp-lg);
        margin-left: auto;
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-xs);
      }
      .forgot-password:hover {
        color: var(--boxel-highlight);
        background-color: transparent;
      }
      .button {
        --boxel-button-padding: var(--boxel-sp-sm);
        width: 100%;
      }
      .button :deep(.boxel-loading-indicator) {
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .or {
        margin: var(--boxel-sp-sm) auto;
        font: 500 var(--boxel-font-sm);
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-xxs) auto 0 auto;
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @service private declare matrixService: MatrixService;
  @service declare router: RouterService;

  private get isLoginButtonDisabled() {
    return (
      !this.username || !this.password || this.error || this.doLogin.isRunning
    );
  }

  @action handleEnter(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      !this.isLoginButtonDisabled && this.login();
    }
  }

  @action
  private setUsername(username: string) {
    this.username = username;
    this.error = undefined;
  }

  @action
  private setPassword(password: string) {
    this.password = password;
    this.error = undefined;
  }

  @action
  private login() {
    this.doLogin.perform();
  }

  private doLogin = restartableTask(async () => {
    if (!this.username) {
      throw new Error(
        `bug: should never get here: login button disabled when no username`,
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: login button disabled when no password`,
      );
    }
    let auth: LoginResponse;
    try {
      auth = await this.matrixService.login(this.username, this.password);
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = `Sign in failed. ${extractMatrixErrorMessage(e)}`;
      } else {
        this.error = `Sign in failed: ${e.message}`;
      }

      throw e;
    }
    if (auth) {
      // note that any commands after this await will not be executed as the act
      // of starting the matrix service sets tracked properties that result in this
      // component being removed from the DOM and destroyed. Keep in mind that in EC tasks,
      // awaits are really just syntactic sugar for yields, and that we yield to
      // this.matrixService.start()
      await this.matrixService.start({ auth, refreshRoutes: true });
    } else {
      throw new Error(
        `bug: should be impossible to get here - successful matrix login with no auth response`,
      );
    }
  });
}

export function extractMatrixErrorMessage(e: MatrixError) {
  if (e.httpStatus === 403) {
    return 'Please check your credentials and try again.';
  } else if (e.httpStatus === 429) {
    if (e.data.retry_after_ms) {
      moment.relativeTimeRounding(Math.ceil);
      return `Too many failed attempts, try again ${moment
        .duration(e.data.retry_after_ms)
        .humanize(true)}.`;
    }
    return 'Too many failed attempts, try again later.';
  } else {
    return `Unknown error ${e.httpStatus}: ${e.data.error}`;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
