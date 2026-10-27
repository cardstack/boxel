import Component from '@glimmer/component';

import IncompleteCliLink from '../sign-in/incomplete-cli-link.gts';
import ForgotPassword from './forgot-password.gts';
import { cliFrom, signInURL } from '../cli-links.ts';
import { takeResetLink } from './reset-link.ts';
import ResetPassword from './reset-password.gts';

// The shell's `forgot-password` and `reset-password` pages.

export class ForgotPasswordPage extends Component {
  private params = new URL(window.location.href).searchParams;
  private link = cliFrom(this.params);
  private signInURL = signInURL(this.link.cli, this.params.get('user'));

  <template>
    {{#if this.link.invalid}}
      <IncompleteCliLink />
    {{else}}
      <ForgotPassword @cli={{this.link.cli}} @signInURL={{this.signInURL}} />
    {{/if}}
  </template>
}

export class ResetPasswordPage extends Component {
  private link = takeResetLink();

  <template><ResetPassword @link={{this.link}} /></template>
}
