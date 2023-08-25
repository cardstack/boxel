import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui';
import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type IAuthData } from 'matrix-js-sdk';

export default class Login extends Component {
  <template>
    <BoxelHeader @title='Login' @hasBackground={{true}} />
    {{#if this.error}}
      <div class='error' data-test-login-error>{{this.error}}</div>
    {{/if}}
    {{#if this.doLogin.isRunning}}
      <LoadingIndicator />
    {{else}}
      <div class='login'>
        <FieldContainer @label='Username:' @tag='label' class='login__field'>
          <BoxelInput
            data-test-username-field
            type='text'
            @value={{this.username}}
            @onInput={{this.setUsername}}
          />
        </FieldContainer>
        <FieldContainer @label='Password:' @tag='label' class='login__field'>
          <BoxelInput
            data-test-password-field
            type='password'
            @value={{this.password}}
            @onInput={{this.setPassword}}
          />
        </FieldContainer>
        <Button
          class='login__button'
          data-test-login-btn
          @kind='primary'
          @disabled={{this.isLoginButtonDisabled}}
          {{on 'click' this.login}}
        >Login</Button>
      </div>
    {{/if}}

    <style>
      .login {
        padding: var(--boxel-sp);
      }
      .login__field {
        margin-top: var(--boxel-sp-sm);
      }
      .login__button {
        margin-top: var(--boxel-sp-sm);
        margin-right: var(--boxel-sp);
        position: absolute;
        right: var(--boxel-sp);
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
        this.error = e.data.error;
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
