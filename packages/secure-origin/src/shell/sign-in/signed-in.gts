// The window, signed in. When this tab's sign-in was started by the app with
// a page to come back to, it hands the sign-in over: a single-use login token,
// carried to that page by navigating there, which the app redeems for a Matrix
// session of its own. A hand-off to a program on the user's own machine waits
// for the user to confirm it. Otherwise the window says it is signed in, and
// offers a link to the key page: the app asks the realm server whether the
// window has a session, rather than hearing it from the window.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  appOrigins,
  forgetReturn,
  handOffURL,
  needsConfirmation,
  pendingReturn,
} from '../../security/app-handoff.js';
import {
  loginToken,
  readConfig,
  storedSession,
} from '../../security/session.js';
import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import { navigation } from '../navigation.js';
import { asSentence } from '../sign-in-copy.js';
import { pageURL } from '../urls.js';

import MessagePage from './message-page.gts';

type State =
  | { name: 'signed-in' }
  | { name: 'confirming'; target: string; origin: string }
  | { name: 'handing-off' }
  | { name: 'failed'; error: string };

export default class SignedIn extends Component {
  <template>
    {{#if this.confirming}}
      <MessagePage @heading='Continue to {{this.confirming.origin}}?'>
        <p class='info' data-test-secure-loopback-confirm>
          A program on this computer at
          {{this.confirming.origin}}
          wants to sign in to Boxel as you. Continue only if you started this
          sign-in from that program.
        </p>
        <div class='button-wrapper'>
          <AuthButton
            type='button'
            @variant='primary'
            data-test-secure-loopback-continue
            {{on 'click' this.confirm}}
          >Continue</AuthButton>
          <AuthButton
            type='button'
            @variant='secondary'
            data-test-secure-loopback-cancel
            {{on 'click' this.cancel}}
          >Cancel</AuthButton>
        </div>
      </MessagePage>
    {{else if this.handingOff}}
      <AuthContainer>
        <BusyMessage @title='Signing you in…' data-test-secure-handing-off />
      </AuthContainer>
    {{else if this.failure}}
      <MessagePage @heading='That didn’t work'>
        <div class='error' role='alert' data-test-secure-error>
          {{this.failure.error}}
        </div>
        <div class='button-wrapper'>
          <AuthButton
            type='button'
            @variant='secondary'
            data-test-secure-handoff-retry
            {{on 'click' this.handOff}}
          >Try again</AuthButton>
        </div>
      </MessagePage>
    {{else}}
      <MessagePage @heading='You’re signed in to Boxel'>
        <p class='info' data-test-secure-signed-in>You can close this window.</p>
        <div class='button-wrapper'>
          <AuthButton
            @as='anchor'
            @href={{this.keyPage}}
            @variant='secondary'
            data-test-secure-manage-keys
          >Manage your keys</AuthButton>
        </div>
      </MessagePage>
    {{/if}}

    <style scoped>
      .info {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-sm);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--foreground);
      }
      .error {
        color: var(--destructive-ink);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
      .button-wrapper {
        width: 100%;
        margin-top: var(--boxel-sp-xl);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>

  private config = readConfig();
  // The key page is a link away, never where signing in lands: a sign-in
  // the app started hands back to the app, and one that didn't ends here.
  private keyPage = pageURL('keys');
  private target = pendingReturn(appOrigins(this.config));
  private page = trackedObject<{ state: State }>({
    state: { name: 'signed-in' },
  });

  constructor(owner: Owner, args: object) {
    super(owner, args);
    if (!this.target) {
      return;
    }
    if (needsConfirmation(this.target, this.config)) {
      this.page.state = {
        name: 'confirming',
        target: this.target,
        origin: new URL(this.target).origin,
      };
      return;
    }
    this.handOff();
  }

  private get confirming() {
    return this.page.state.name === 'confirming' ? this.page.state : undefined;
  }

  private get handingOff() {
    return this.page.state.name === 'handing-off';
  }

  private get failure() {
    return this.page.state.name === 'failed' ? this.page.state : undefined;
  }

  private confirm = () => this.handOff();

  // Declining a loopback hand-off leaves the user signed in here, handing
  // nothing over.
  private cancel = () => {
    forgetReturn();
    this.page.state = { name: 'signed-in' };
  };

  private handOff = async () => {
    let target = this.target;
    let session = storedSession();
    if (!target || !session) {
      this.page.state = { name: 'signed-in' };
      return;
    }
    this.page.state = { name: 'handing-off' };
    let minted;
    try {
      minted = await loginToken(this.config, session);
    } catch (e: any) {
      if (e.code === 'signed-out') {
        // The session ended since the window checked it, as signing out in
        // another tab ends it: sign in again, and the hand-off this tab is
        // waiting on follows.
        navigation.replace(pageURL('sign-in'));
        return;
      }
      this.page.state = { name: 'failed', error: asSentence(e.message) };
      return;
    }
    forgetReturn();
    // Replaced, not pushed: Back from the app mustn't land on this page, nor
    // on the app's address with the spent token in it.
    navigation.replace(handOffURL(target, minted.loginToken, minted.deviceId));
  };
}
