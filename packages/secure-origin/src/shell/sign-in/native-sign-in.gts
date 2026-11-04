// Where a native (Studio) runtime's sign-in link lands: `#loginToken=<Matrix
// login token>`, minted on this computer by the runtime's control service for
// a session of one of its own local users, which have no password. The page
// takes the fragment out of the address bar at once, signs in with it, and
// goes on to the key page.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';
import {
  readConfig,
  signInWithLoginToken,
  storeSession,
} from '../../security/session.js';
import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import { navigation } from '../navigation.js';
import { asSentence } from '../sign-in-copy.js';
import { pageURL } from '../urls.js';
import MessagePage from './message-page.gts';

type State = { name: 'signing-in' } | { name: 'failed'; error: string };

export default class NativeSignIn extends Component {
  <template>
    {{#if this.failure}}
      <MessagePage @heading='That didn’t work'>
        <div class='error' role='alert' data-test-secure-native-sign-in-error>
          {{this.failure.error}}
        </div>
      </MessagePage>
    {{else}}
      <AuthContainer>
        <BusyMessage @title='Signing you in…' data-test-secure-native-sign-in />
      </AuthContainer>
    {{/if}}
    <style scoped>
      .error {
        color: var(--destructive-ink);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
    </style>
  </template>

  private page = trackedObject<{ state: State }>({
    state: { name: 'signing-in' },
  });

  constructor(owner: Owner, args: object) {
    super(owner, args);
    this.finish();
  }

  private get failure() {
    let { state } = this.page;
    return state.name === 'failed' ? state : undefined;
  }

  private async finish() {
    let fragment = new URLSearchParams(window.location.hash.slice(1));
    // The token never stays in the address bar or the history.
    history.replaceState(null, '', window.location.pathname);
    let loginToken = fragment.get('loginToken');
    if (!loginToken) {
      this.page.state = {
        name: 'failed',
        error: 'This sign-in link is incomplete. Ask for a new one.',
      };
      return;
    }
    try {
      let session = await signInWithLoginToken(readConfig(), { loginToken });
      storeSession(session);
      navigation.replace(pageURL('keys'));
    } catch (e: any) {
      this.page.state = {
        name: 'failed',
        error: asSentence(e?.message ?? 'Signing in failed.'),
      };
    }
  }
}
