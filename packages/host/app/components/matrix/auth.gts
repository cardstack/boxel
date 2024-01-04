import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import AuthContainer from './auth-container';
import Login from './login';
import RegisterUser from './register-user';

export default class Auth extends Component {
  <template>
    <AuthContainer>
      {{#if this.isRegistrationMode}}
        <RegisterUser @onCancel={{this.toggleRegistrationMode}} />
      {{else}}
        <Login @onRegistration={{this.toggleRegistrationMode}} />
      {{/if}}
    </AuthContainer>
  </template>

  @tracked isRegistrationMode = false;

  @action
  toggleRegistrationMode() {
    this.isRegistrationMode = !this.isRegistrationMode;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Login {
    'Matrix::Login': typeof Login;
  }
}
