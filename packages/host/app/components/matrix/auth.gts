import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AuthContainer from '@cardstack/secure-origin/components/auth-container.gts';

import { bool, eq, or } from '@cardstack/boxel-ui/helpers';

import { resetPasswordParamsFrom } from '@cardstack/host/lib/reset-password-link';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import ForgotPassword, { type ResetPasswordParams } from './forgot-password';
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

    let { params, inFragment } = resetPasswordParamsFrom(
      this.router.currentRoute?.queryParams ?? {},
      window.location.hash,
    );
    this.resetPasswordParams = params;
    if (inFragment) {
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
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
