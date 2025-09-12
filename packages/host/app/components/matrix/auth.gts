import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { bool, eq, or } from '@cardstack/boxel-ui/helpers';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import AuthContainer from './auth-container';
import ForgotPassword, { ResetPasswordParams } from './forgot-password';
import Login from './login';
import RegisterUser from './register-user';

export type AuthMode = 'login' | 'register' | 'forgot-password';

export default class Auth extends Component {
  <template>
    <AuthContainer>
      {{#if
        (or (eq this.mode 'forgot-password') (bool this.resetPasswordParams))
      }}
        <ForgotPassword
          @setMode={{this.setMode}}
          @nullifyResetPasswordParams={{this.nullifyResetPasswordParams}}
          @resetPasswordParams={{this.resetPasswordParams}}
        />
      {{else if (eq this.mode 'register')}}
        <RegisterUser @setMode={{this.setMode}} />
      {{else}}
        <Login @setMode={{this.setMode}} />
      {{/if}}
    </AuthContainer>
  </template>

  @tracked mode: AuthMode = 'login';
  @tracked resetPasswordParams: ResetPasswordParams | undefined;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;

  constructor(owner: Owner, args: any) {
    super(owner, args);

    let sid = this.router.currentRoute?.queryParams['sid'];
    let clientSecret = this.router.currentRoute?.queryParams['clientSecret'];
    if (sid && clientSecret) {
      this.resetPasswordParams = {
        sid: sid as string,
        clientSecret: clientSecret as string,
      };
    }
  }

  @action
  setMode(mode: AuthMode) {
    this.mode = mode;
  }

  @action
  nullifyResetPasswordParams() {
    let controller = this.operatorModeStateService.operatorModeController;

    controller.sid = null;
    controller.clientSecret = null;

    this.resetPasswordParams = undefined;
  }
}
