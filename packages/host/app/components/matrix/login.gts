import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { type IAuthData } from 'matrix-js-sdk';

import {
  Button,
  FieldContainer,
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';

interface Signature {
  Args: {
    skipSignIn?: () => void; //TODO: Remove after registration page is implemented.
  };
}

export default class Login extends Component<Signature> {
  <template>
    {{#if this.doLogin.isRunning}}
      <LoadingIndicator />
    {{else}}
      <div class='container'>
        <div class='login-form'>
          <BoxelHeader @title='Boxel' @hasBackground={{false}} class='header'>
            <:icon>
              <BoxelIcon />
            </:icon>
          </BoxelHeader>
          <div class='content'>
            <span class='title'>Sign in to your Boxel Account</span>
            {{#if this.error}}
              <div class='error' data-test-login-error>{{this.error}}</div>
            {{/if}}
            <FieldContainer
              @label='Email Address or Username'
              @tag='label'
              @vertical={{true}}
              class='login__field'
            >
              <BoxelInput
                data-test-username-field
                type='text'
                @value={{this.username}}
                @onInput={{this.setUsername}}
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
              />
            </FieldContainer>
            <Button @kind='text-only' class='forgot-password'>Forgot password?</Button>
            <div class='buttons'>
              <Button
                class='login-button'
                data-test-login-btn
                @kind='primary'
                @disabled={{this.isLoginButtonDisabled}}
                {{on 'click' this.login}}
              >Sign in</Button>
              <span>or</span>
              <Button
                class='signup-button'
                data-test-signup-btn
                {{on 'click' this.login}}
              >Create a new Boxel account</Button>
            </div>
            {{! TODO: Remove after registration page is implemented. }}
            {{#if @skipSignIn}}<Button
                @kind='text-only'
                class='forgot-password'
                {{on 'click' @skipSignIn}}
              >Skip sign in?</Button>{{/if}}
          </div>
        </div>
      </div>
    {{/if}}

    <style>
      .container {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      .login-form {
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        letter-spacing: var(--boxel-lsp);
        width: 550px;
      }
      .header {
        --boxel-header-icon-width: var(--boxel-icon-med);
        --boxel-header-icon-height: var(--boxel-icon-med);
        --boxel-header-padding: var(--boxel-sp);
        --boxel-header-text-size: var(--boxel-font);

        background-color: var(--boxel-light);
        text-transform: uppercase;
        max-width: max-content;
        min-width: 100%;
        gap: var(--boxel-sp-xxs);
        letter-spacing: var(--boxel-lsp-lg);
      }
      .content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-xl);
      }
      .title {
        font: 700 var(--boxel-font-med);
        margin-bottom: var(--boxel-sp-lg);
      }
      .field {
        margin-top: var(--boxel-sp-sm);
      }
      .forgot-password {
        border: none;
        padding: 0;
        margin-top: calc(-1 * var(--boxel-sp));
        margin-left: auto;
        font: 500 var(--boxel-font-xs);
      }
      .forgot-password:hover {
        color: var(--boxel-highlight);
      }
      .buttons {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .login-button {
        --boxel-button-text-color: var(--boxel-light);
        --boxel-button-padding: var(--boxel-sp-sm);
        width: 100%;
      }
      .signup-button {
        --boxel-button-text-color: var(--boxel-dark);
        --boxel-button-padding: var(--boxel-sp-sm);
        width: 100%;
      }
      .error {
        color: var(--boxel-error-100);
        margin-bottom: calc(-1 * var(--boxel-sp-xs));
      }
    </style>
  </template>

  @tracked private error: string | undefined;
  @tracked private username: string | undefined;
  @tracked private password: string | undefined;
  @service private declare matrixService: MatrixService;

  private get isLoginButtonDisabled() {
    return !this.username || !this.password;
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
    let auth: IAuthData | undefined;
    try {
      auth = await this.matrixService.client.loginWithPassword(
        this.username,
        this.password,
      );
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error =
          'Sign in failed. Please check your credentials and try again.';
      } else {
        throw e;
      }
    }
    if (auth) {
      await this.matrixService.start(auth);
    } else {
      throw new Error(
        `bug: should be impossible to get here - successful matrix login with no auth response`,
      );
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
