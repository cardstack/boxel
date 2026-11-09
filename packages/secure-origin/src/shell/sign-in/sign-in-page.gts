// The `sign-in` page: the window's own session. Signed in, the window says so,
// or hands the sign-in over to the app page that sent the user here (the
// `return` in the address's fragment); otherwise it shows the sign-in form.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  liveSession,
  readConfig,
  signOut,
  storedSession,
  storeSession,
} from '../../security/session.js';
import type { Session } from '../../security/session.js';
import { appOrigins, rememberReturn } from '../../security/app-handoff.js';
import AuthContainer from '../../components/auth-container.gts';

import MessagePage from './message-page.gts';
import SignedIn from './signed-in.gts';
import SignInForm from './sign-in-form.gts';

type State = 'starting' | 'checking' | 'signed-in' | 'signed-out';

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
  private page = trackedObject<{ state: State }>({ state: 'starting' });

  constructor(owner: Owner, args: object) {
    super(owner, args);
    rememberReturn(appOrigins(this.config));
    // The window has no sign-out control; this ends its session from the
    // browser's console. Signed out here, the window shows its sign-in again.
    window.boxelSignOut = async () => {
      await signOut(this.config);
      await this.check();
    };
    this.check();
  }

  private is = (state: State) => this.page.state === state;

  // A stored session the server has ended, as signing out of the app ends it,
  // shows the sign-in, with no error: the user simply isn't signed in.
  private async check() {
    this.page.state = storedSession() ? 'checking' : 'starting';
    this.page.state = (await liveSession(this.config))
      ? 'signed-in'
      : 'signed-out';
  }

  private signedIn = (session: Session) => {
    storeSession(session);
    this.page.state = 'signed-in';
  };
}
