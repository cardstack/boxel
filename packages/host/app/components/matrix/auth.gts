import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { CardContainer, BoxelHeader } from '@cardstack/boxel-ui/components';
import { bool, eq, or } from '@cardstack/boxel-ui/helpers';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

import ForgotPassword, { ResetPasswordParams } from './forgot-password';
import Login from './login';
import RegisterUser from './register-user';

export type AuthMode = 'login' | 'register' | 'forgot-password';

interface Signature {
  Args: {
    resetPasswordParams?: ResetPasswordParams;
  };
}

export default class Auth extends Component<Signature> {
  <template>
    <div class='auth'>
      <div class='container'>
        <CardContainer class='form'>
          <BoxelHeader @title='Boxel' @hasBackground={{false}} class='header'>
            <:icon>
              <BoxelIcon />
            </:icon>
          </BoxelHeader>
          <div class='content'>
            {{#if
              (or (eq this.mode 'forgot-password') (bool @resetPasswordParams))
            }}
              <ForgotPassword
                @resetPasswordParams={{@resetPasswordParams}}
                @setMode={{this.setMode}}
              />
            {{else if (eq this.mode 'register')}}
              <RegisterUser @setMode={{this.setMode}} />
            {{else}}
              <Login @setMode={{this.setMode}} />
            {{/if}}
          </div>
        </CardContainer>
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

      .form {
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-form-control-border-color);
        border-radius: var(--boxel-form-control-border-radius);
        letter-spacing: var(--boxel-lsp);
        width: 550px;
        position: relative;
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
        padding: var(--boxel-sp) var(--boxel-sp-xl) calc(var(--boxel-sp) * 2)
          var(--boxel-sp-xl);
      }
    </style>
  </template>

  @tracked mode: AuthMode = 'login';

  @action
  setMode(mode: AuthMode) {
    this.mode = mode;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
