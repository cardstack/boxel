import { action } from '@ember/object';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';

import ForgotPassword from './forgot-password';
import Login from './login';
import RegisterUser from './register-user';

type Mode = 'login' | 'register' | 'forgot-password';

export default class Auth extends Component {
  <template>
    <div class='auth'>
      <div class='container'>
        {{#if (eq this.mode 'register')}}
          <RegisterUser @onCancel={{fn this.setMode 'login'}} />
        {{else if (eq this.mode 'forgot-password')}}
          <ForgotPassword @onLogin={{fn this.setMode 'login'}} />
        {{else}}
          <Login
            @onRegistration={{fn this.setMode 'register'}}
            @onForgotPassword={{fn this.setMode 'forgot-password'}}
          />
        {{/if}}
      </div>
    </div>

    <style>
      .auth {
        height: 100%;
        overflow: auto;
      }

      .container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        padding: var(--boxel-sp-lg);
      }
    </style>
  </template>

  @tracked mode: Mode = 'login';

  @action
  setMode(mode: Mode) {
    this.mode = mode;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
