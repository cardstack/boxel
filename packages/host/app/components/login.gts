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
import { isMatrixError } from '../lib/matrix-utils';
import type MatrixService from '../services/matrix-service';
import { type IAuthData } from 'matrix-js-sdk';

const TRUE = true;

export default class Login extends Component {
  <template>
    <BoxelHeader @title='Login' @hasBackground={{TRUE}} />
    {{#if this.error}}
      <div class='error' data-test-login-error>{{this.error}}</div>
    {{/if}}
    {{#if this.doLogin.isRunning}}
      <LoadingIndicator />
    {{else}}
      <fieldset>
        <FieldContainer @label='Username:' @tag='label'>
          <BoxelInput
            data-test-username-field
            type='text'
            @value={{this.username}}
            @onInput={{this.setUsername}}
          />
        </FieldContainer>
        <FieldContainer @label='Password:' @tag='label'>
          <BoxelInput
            data-test-password-field
            type='password'
            @value={{this.password}}
            @onInput={{this.setPassword}}
          />
        </FieldContainer>
        <Button
          data-test-login-btn
          @disabled={{this.isLoginButtonDisabled}}
          {{on 'click' this.login}}
        >Login</Button>
      </fieldset>
    {{/if}}
  </template>

  @tracked error: string | undefined;
  @tracked
  private username: string | undefined;
  @tracked
  private password: string | undefined;
  @service declare matrixService: MatrixService;

  get isLoginButtonDisabled() {
    return !this.username || !this.password;
  }

  @action
  setUsername(username: string) {
    this.username = username;
    this.error = undefined;
  }

  @action
  setPassword(password: string) {
    this.password = password;
    this.error = undefined;
  }

  @action
  login() {
    this.doLogin.perform();
  }

  private doLogin = restartableTask(async () => {
    if (!this.username) {
      throw new Error(
        `bug: should never get here: login button disabled when no username`
      );
    } else if (!this.password) {
      throw new Error(
        `bug: should never get here: login button disabled when no password`
      );
    }
    let auth: IAuthData | undefined;
    try {
      auth = await this.matrixService.client.loginWithPassword(
        this.username,
        this.password
      );
    } catch (e: any) {
      if (isMatrixError(e)) {
        this.error = e.data.error;
      } else {
        throw e;
      }
    }
    if (auth) {
      await this.matrixService.startWithAuth(auth);
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    Login: typeof Login;
  }
}
