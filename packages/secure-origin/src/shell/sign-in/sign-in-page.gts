// The `sign-in` mode: the window's own session. Signed in, the window says so;
// otherwise it shows the sign-in form.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  liveSession,
  readConfig,
  signOut,
  storedSession,
  storeSession,
} from '../../security/session.js';
import AuthContainer from '../../components/auth-container.gts';

import MessagePage from './message-page.gts';
import SignedIn from './signed-in.gts';
import SignInForm from './sign-in-form.gts';

type Session = { token: string; user: string; expiresAt: string };

declare global {
  interface Window {
    boxelSignOut?: () => Promise<void>;
  }
}

export default class SignInPage extends Component {
  <template>
    {{#if (this.is 'signed-in')}}
      <SignedIn />
    {{else if (this.is 'signed-out')}}
      <AuthContainer>
        <SignInForm
          @config={{this.config}}
          @client='window'
          @onSignedIn={{this.signedIn}}
        />
      </AuthContainer>
    {{else if (this.is 'checking')}}
      <MessagePage @heading='Checking your sign-in…' @info='One moment.' />
    {{/if}}
  </template>

  private config = readConfig();
  @tracked private state: 'starting' | 'checking' | 'signed-in' | 'signed-out' =
    'starting';

  constructor(owner: unknown, args: object) {
    super(owner, args);
    // The window has no sign-out control; this ends its session from the
    // browser's console. Signed out here, the window shows its sign-in again.
    window.boxelSignOut = async () => {
      await signOut(this.config);
      await this.check();
    };
    this.check();
  }

  private is = (state: SignInPage['state']) => this.state === state;

  // A stored session the server has ended, as signing out of the app ends it,
  // shows the sign-in, with no error: the user simply isn't signed in.
  private async check() {
    this.state = storedSession() ? 'checking' : 'starting';
    this.state = (await liveSession(this.config)) ? 'signed-in' : 'signed-out';
  }

  private signedIn = (session: Session) => {
    storeSession(session);
    this.state = 'signed-in';
  };
}
