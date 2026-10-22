// The `cli-sign-in` mode: a session for the CLI waiting on a loopback port,
// which the URL names with `port` and `state`. Signed in, the session goes to
// that listener and nowhere else; this window keeps none of it.
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { cliCallback } from '../../security/cli-handoff.js';
import { readConfig } from '../../security/session.js';
import AuthContainer from '../../components/auth-container.gts';

import CliHandoff from './cli-handoff.gts';
import IncompleteCliLink from './incomplete-cli-link.gts';
import SignInForm from './sign-in-form.gts';

type Session = { token: string; user: string; expiresAt: string };

export default class CliSignInPage extends Component {
  <template>
    {{#if this.callback}}
      {{#if this.state.session}}
        <CliHandoff
          @callback={{this.callback}}
          @session={{this.state.session}}
        />
      {{else}}
        <AuthContainer>
          <SignInForm
            @config={{this.config}}
            @client='cli'
            @cli={{this.callback}}
            @username={{this.username}}
            @onSignedIn={{this.signedIn}}
          />
        </AuthContainer>
      {{/if}}
    {{else}}
      <IncompleteCliLink />
    {{/if}}
  </template>

  private config = readConfig();
  private params = new URL(window.location.href).searchParams;
  private callback = cliCallback(this.params);
  private username = this.params.get('user') ?? '';
  private state = trackedObject({ session: undefined as Session | undefined });

  private signedIn = (session: Session) => {
    this.state.session = session;
  };
}
