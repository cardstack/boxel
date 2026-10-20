import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { bool, eq, or } from '@cardstack/boxel-ui/helpers';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import AuthContainer from './auth-container';

import ForgotPassword from './forgot-password';
import Login from './login';
import RegisterUser from './register-user';

import type { ResetPasswordParams } from './forgot-password';

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

    // A reset link carries the email address it was sent to in its
    // fragment, and the Matrix server adds the validation session's id after
    // it, so the id is in the fragment unless the link had none. The
    // fragment is taken out of the address bar once read.
    let fragment = new URLSearchParams(window.location.hash.slice(1));
    let sid =
      this.router.currentRoute?.queryParams['sid'] ??
      fragment.get('sid') ??
      undefined;
    let clientSecret = this.router.currentRoute?.queryParams['clientSecret'];
    if (sid && clientSecret) {
      this.resetPasswordParams = {
        sid: sid as string,
        clientSecret: clientSecret as string,
        email: fragment.get('email') ?? undefined,
      };
    }
    if (fragment.has('sid') || fragment.has('email')) {
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
