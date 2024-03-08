import { getOwner } from '@ember/application';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { bool, eq, or } from '@cardstack/boxel-ui/helpers';

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

  constructor(owner: Owner, args: any) {
    super(owner, args);

    let sid = this.router.currentRoute.queryParams['sid'];
    let clientSecret = this.router.currentRoute.queryParams['clientSecret'];
    if (sid && clientSecret) {
      this.resetPasswordParams = {
        sid,
        clientSecret,
      };
    }
  }

  willDestroy() {
    super.willDestroy();
    // We have to retrigger model hook in the card route by refreshing the router,
    // because after user logged-in we need to reload the card and operator mode state.
    scheduleOnce('destroy', this, this.refreshRoute);
  }

  async refreshRoute() {
    await this.router.refresh();
  }

  @action
  setMode(mode: AuthMode) {
    this.mode = mode;
  }

  @action
  nullifyResetPasswordParams() {
    let cardController = getOwner(this)!.lookup('controller:card') as any;
    if (!cardController) {
      throw new Error(
        'AuthComponent must be used in the context of a CardController',
      );
    }
    cardController.sid = null;
    cardController.clientSecret = null;
    this.resetPasswordParams = undefined;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
