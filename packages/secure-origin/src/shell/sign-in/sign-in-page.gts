// The `sign-in` page: the window's own session. Signed in, the window says so,
// or hands the sign-in over to the app page that sent the user here (the
// `return` in the address's fragment); otherwise it shows the sign-in form.
// A page that names the account it needs (`user`, beside `return`) gets that
// account's form, filled in, when the window is signed in as another.
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
import {
  appOrigins,
  forgetReturn,
  pendingReturn,
  pendingReturnUser,
  rememberReturn,
  withoutHandOff,
} from '../../security/app-handoff.js';
import AuthContainer from '../../components/auth-container.gts';
import { navigation } from '../navigation.js';

import MessagePage from './message-page.gts';
import SignedIn from './signed-in.gts';
import SignInForm from './sign-in-form.gts';

type State =
  | 'starting'
  | 'checking'
  | 'signed-in'
  | 'signed-out'
  // Signed in as an account other than the one the page to go back to needs.
  | 'other-account';

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
          @username={{this.wantedUser}}
          @onSignedIn={{this.signedIn}}
        />
      </AuthContainer>
    {{else if (this.is 'other-account')}}
      <AuthContainer>
        <SignInForm
          @config={{this.config}}
          @client='window'
          @username={{this.wantedUser}}
          @onSignedIn={{this.signedIn}}
          @onCancel={{this.keepAccount}}
        >
          <:intro>
            <p class='intro-text' data-test-secure-other-account>
              You’re signed in as
              <span class='user-id'>{{this.page.signedInAs}}</span>. The page
              that sent you here needs
              <span class='user-id'>{{this.wantedUser}}</span>. Sign in as that
              account to continue.
            </p>
          </:intro>
        </SignInForm>
      </AuthContainer>
    {{else if (this.is 'checking')}}
      <MessagePage @heading='Checking your sign-in…' @info='One moment.' />
    {{/if}}

    <style scoped>
      .intro-text {
        margin: 0;
      }
      .user-id {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private config = readConfig();
  private page = trackedObject<{ state: State; signedInAs?: string }>({
    state: 'starting',
  });

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

  // The account the page to go back to needs, when it named one.
  private get wantedUser() {
    return pendingReturn(appOrigins(this.config))
      ? pendingReturnUser()
      : undefined;
  }

  // A stored session the server has ended, as signing out of the app ends it,
  // shows the sign-in, with no error: the user simply isn't signed in.
  private async check() {
    this.page.state = storedSession() ? 'checking' : 'starting';
    let session = await liveSession(this.config);
    let wanted = this.wantedUser;
    if (session && wanted && session.user !== wanted) {
      this.page.signedInAs = session.user;
      this.page.state = 'other-account';
      return;
    }
    this.page.state = session ? 'signed-in' : 'signed-out';
  }

  // Staying signed in as the window's account hands nothing over, since the
  // page that sent the user here needs another account: the user goes back to
  // that page with no login token.
  private keepAccount = () => {
    let target = pendingReturn(appOrigins(this.config));
    forgetReturn();
    if (target) {
      navigation.replace(withoutHandOff(target));
      return;
    }
    this.page.state = 'signed-in';
  };

  private signedIn = (session: Session) => {
    storeSession(session);
    this.page.state = 'signed-in';
  };
}
