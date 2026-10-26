// The secure window's key pages, around whichever one is open: a bar with the
// Boxel logo, what the window is for and a Close button, and the page under
// it once the window is signed in with its own session.
//
// Opened signed out, the window signs in first, with the same sign-in as
// everywhere else, then shows its page. Signed out while it is open (the user
// signs out of the app, which ends the window's session too, or signs in as
// someone else in another window), it stops: it shows that the user must sign
// in again from Boxel, and offers no sign-in of its own, since the app that
// opened it is signing in again already. It learns of that from this origin's
// storage, from the realm server when the window comes back into view, and
// from any request of its pages that the server refuses as signed out.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  liveSession,
  onStoredSessionChange,
  readConfig,
  storeSession,
} from '../../security/session.js';
import type { Session } from '../../security/session.js';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import BoxelIcon from '../../components/icons/boxel-icon.gts';
import IconX from '../../components/icons/icon-x.gts';
import { navigation } from '../navigation.js';
import SignInForm from '../sign-in/sign-in-form.gts';

export type Config = ReturnType<typeof readConfig>;

type State = 'checking' | 'signed-out' | 'signed-in' | 'ended';

export interface KeysWindowAPI {
  config: Config;
  // What a page calls when the server refuses a request as signed out.
  signedOut: () => void;
  close: () => void;
}

interface Signature {
  Args: {
    // What the bar says the window is for.
    title: string;
  };
  Blocks: { default: [KeysWindowAPI] };
}

export default class KeysWindow extends Component<Signature> {
  <template>
    <div class='keys-window' data-theme='dark' data-test-secure-page>
      <header class='bar'>
        <span class='logo' aria-hidden='true'><BoxelIcon /></span>
        <span class='bar-title' data-test-keys-window-title>{{@title}}</span>
        <Button
          class='close'
          @kind='text-only'
          @size='small'
          aria-label='Close'
          data-test-keys-close
          {{on 'click' this.close}}
        ><IconX class='close-icon' aria-hidden='true' /><span
            class='close-label'
          >Close</span></Button>
      </header>
      <main class='body'>
        {{#if (this.is 'checking')}}
          <BusyMessage
            @title='Checking your sign-in…'
            data-test-keys-checking
          />
        {{else if (this.is 'signed-out')}}
          <SignInForm
            @config={{this.config}}
            @client='window'
            @resumePage={{this.here}}
            @title='Sign in to manage your keys'
            @onSignedIn={{this.signedIn}}
          >
            <:intro>Your keys are entered only here, on Boxel's secure page.
              Check that your address bar shows this page's address before you
              type one in.</:intro>
          </SignInForm>
        {{else if (this.is 'ended')}}
          <section class='ended' data-test-keys-signed-out>
            <h1 class='heading'>You’re signed out</h1>
            <p class='info'>Sign in to Boxel again in the Boxel window you
              opened this from, then open your keys from there.</p>
            <Button
              @kind='secondary'
              @size='touch'
              class='ended-close'
              data-test-keys-signed-out-close
              {{on 'click' this.close}}
            >Close this window</Button>
          </section>
        {{else}}
          {{yield this.api}}
        {{/if}}
      </main>
    </div>

    <style scoped>
      .keys-window {
        --background: #272432;
        --foreground: var(--boxel-light);
        --muted-foreground: #a7a5b0;
        --panel-background: #272432;
        --panel-border: #3b394a;
        --keys-background: #191624;

        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background-color: var(--keys-background);
        color: var(--foreground);
      }
      .bar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        border-bottom: 1px solid var(--panel-border);
      }
      .logo {
        --icon-color: var(--boxel-highlight);
        display: inline-flex;
        width: 1.5rem;
        height: 1.5rem;
      }
      .logo :deep(svg) {
        width: 100%;
        height: 100%;
      }
      .bar-title {
        flex: 1;
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .close {
        --boxel-button-text-color: var(--boxel-light);
        gap: var(--boxel-sp-4xs);
      }
      .close-icon {
        --icon-color: var(--boxel-light);
        width: 0.625rem;
        height: 0.625rem;
      }
      .body {
        flex: 1;
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 34rem;
        margin: 0 auto;
        padding: var(--boxel-sp-lg) var(--boxel-sp);
      }
      .heading {
        font: 600 var(--boxel-font-md);
        margin: 0 0 var(--boxel-sp-sm);
      }
      .info {
        margin: 0 0 var(--boxel-sp-lg);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
      }
      .ended {
        margin-top: var(--boxel-sp-xl);
      }
      .ended-close {
        width: 100%;
      }
    </style>
  </template>

  private config = readConfig();
  private page = trackedObject<{ state: State }>({ state: 'checking' });
  // Where a Google sign-in comes back to: this page, as it was opened.
  private here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  private stopListening: (() => void) | undefined;
  private signedInAs: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.check();
  }

  willDestroy() {
    super.willDestroy();
    this.stopListening?.();
    document.removeEventListener('visibilitychange', this.recheck);
  }

  private is = (state: State) => this.page.state === state;

  private get api(): KeysWindowAPI {
    return { config: this.config, signedOut: this.ended, close: this.close };
  }

  private async check() {
    let session = await liveSession(this.config);
    if (session) {
      this.begin(session);
    } else {
      this.page.state = 'signed-out';
    }
  }

  private signedIn = (session: Session) => {
    storeSession(session);
    this.begin(session);
  };

  private begin(session: Session) {
    this.signedInAs = session.user;
    this.page.state = 'signed-in';
    this.stopListening = onStoredSessionChange(
      (stored: Session | undefined) => {
        if (stored?.user !== this.signedInAs) {
          this.ended();
        }
      },
    );
    document.addEventListener('visibilitychange', this.recheck);
  }

  // Coming back into view, the window asks the server whether its session
  // still stands: one signed out in another browser has no storage event
  // here.
  private recheck = async () => {
    if (document.visibilityState !== 'visible' || !this.is('signed-in')) {
      return;
    }
    let session = await liveSession(this.config);
    if (!session || session.user !== this.signedInAs) {
      this.ended();
    }
  };

  private ended = () => {
    if (this.page.state !== 'signed-in') {
      return;
    }
    this.stopListening?.();
    document.removeEventListener('visibilitychange', this.recheck);
    this.page.state = 'ended';
  };

  private close = () => navigation.close();
}
