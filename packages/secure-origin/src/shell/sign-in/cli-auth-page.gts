// The `cli-auth` page: `boxel profile add` signing in for a Matrix device of
// its own, for the CLI waiting on the loopback port the URL names with `port`
// and `state`. Signed in, the CLI is handed a single-use login token (see
// `CliHandoff`); this window keeps none of it. A CLI whose URL carries
// `session=secure` is also handed the secure session, which lets it manage
// the user's keys, and the page says so.
//
// A window already signed in asks the same account to confirm its password,
// as the app's own CLI page does: whoever this browser is signed in as is
// overwhelmingly who they mean to authorize, and the password is what
// authorizes it. The username stays editable, so another account can be
// authorized instead.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { cliCallback } from '../../security/cli-handoff.js';
import {
  liveSession,
  readConfig,
  storedSession,
} from '../../security/session.js';
import type { Session } from '../../security/session.js';
import AuthContainer from '../../components/auth-container.gts';

import CliHandoff from './cli-handoff.gts';
import MessagePage from './message-page.gts';
import SignInForm from './sign-in-form.gts';

type State = 'checking' | 'ready';

export default class CliAuthPage extends Component {
  <template>
    {{#if this.callback}}
      {{#if this.state.session}}
        <CliHandoff
          @callback={{this.callback}}
          @session={{this.state.session}}
        />
      {{else if this.ready}}
        <AuthContainer>
          <SignInForm
            @config={{this.config}}
            @client='cli'
            @cli={{this.callback}}
            @username={{this.username}}
            @onSignedIn={{this.signedIn}}
            @title='Authorize Boxel CLI'
          >
            <:intro>
              {{#if this.state.signedInAs}}
                <p class='intro-text' data-test-secure-cli-auth-confirm>Confirm
                  your password to give the Boxel CLI running on this computer
                  access to the workspaces of
                  <span
                    class='signed-in-user'
                    data-test-secure-cli-auth-signed-in-as
                  >{{this.state.signedInAs}}</span>{{#if this.managesKeys}}, and
                    to let it manage their keys{{/if}}.</p>
              {{else}}
                <p class='intro-text' data-test-secure-cli-auth-subtitle>Signing
                  in gives the Boxel CLI running on this computer access to your
                  workspaces{{#if this.managesKeys}}, and lets it manage your
                    keys{{/if}}.</p>
              {{/if}}
            </:intro>
          </SignInForm>
        </AuthContainer>
      {{else}}
        <MessagePage @heading='Checking your sign-in…' @info='One moment.' />
      {{/if}}
    {{else}}
      <MessagePage
        @heading="Can't authorize"
        @info='This page needs the `port` and `state` values that the Boxel CLI puts in its URL. Start it with `boxel profile add`.'
      />
    {{/if}}

    <style scoped>
      .intro-text {
        margin: 0;
      }
      .signed-in-user {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private config = readConfig();
  private params = new URL(window.location.href).searchParams;
  private callback = cliCallback(this.params, { profile: true });
  private state = trackedObject({
    page: (storedSession() ? 'checking' : 'ready') as State,
    signedInAs: undefined as string | undefined,
    username: this.params.get('user') ?? '',
    session: undefined as Session | undefined,
  });

  constructor(owner: Owner, args: object) {
    super(owner, args);
    if (this.callback && this.state.page === 'checking') {
      this.checkWindowSession();
    }
  }

  // Whether the CLI takes the secure session as well as the login token.
  private get managesKeys() {
    return Boolean(this.callback?.profile?.secureSession);
  }

  private get ready() {
    return this.state.page === 'ready';
  }

  private get username() {
    return this.state.username;
  }

  // The account this window is signed in as, when the server still honours
  // its session, fills in the username.
  private async checkWindowSession() {
    let session = await liveSession(this.config);
    if (session) {
      this.state.signedInAs = session.user;
      this.state.username ||= localpart(session.user);
    }
    this.state.page = 'ready';
  }

  private signedIn = (session: Session) => {
    this.state.session = session;
  };
}

function localpart(user: string) {
  return user.replace(/^@/, '').split(':')[0] ?? '';
}
