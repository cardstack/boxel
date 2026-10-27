import Component from '@glimmer/component';

import { cliFrom, signInURL } from '../cli-links.ts';
import IncompleteCliLink from '../sign-in/incomplete-cli-link.gts';
import Register from './register.gts';
import VerifyEmail from './verify-email.gts';

// The shell's `register` and `verify-email` pages.

export class RegisterPage extends Component {
  private params = new URL(window.location.href).searchParams;
  private link = cliFrom(this.params);
  private username = this.params.get('user') ?? '';
  private signInURL = signInURL(this.link.cli, this.username);

  <template>
    {{#if this.link.invalid}}
      <IncompleteCliLink />
    {{else}}
      <Register
        @cli={{this.link.cli}}
        @username={{this.username}}
        @signInURL={{this.signInURL}}
      />
    {{/if}}
  </template>
}

export const VerifyEmailPage = VerifyEmail;
