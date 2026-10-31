// The secure window's key pages, around whichever one is open: a bar with the
// Boxel logo, what the window is for and a Close button, and the page under
// it while the window has a session of its own.
//
// The key pages never sign in, as they never sign out: the window's session
// is the one signing in to Boxel on this origin leaves here. Without one, or
// once it ends while the window is open (the user signs out of the app, which
// ends it too, or signs in as someone else in another window), the window
// says to sign in to Boxel from the window it was opened from, and shows
// nothing else. It learns that a session has ended from this origin's
// storage, from the realm server when the window comes back into view or
// focus, and from any request of its pages that the server refuses as signed
// out.
//
// A window opened for the CLI (`@cli`, the listener the CLI waits on) tells
// that listener how it ended, once: `done` when its page has made the change,
// or `cancelled` when the user closes the window or cancels before then, from
// whatever the window shows, so the terminal stops waiting at once. Closing
// the browser's own window or tab tells it nothing: a page that is closing
// can't start the navigation that reaches the listener, and the origin's
// `connect-src` names no loopback address for a request to. The CLI waits
// out its timeout then.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  liveSession,
  onStoredSessionChange,
  readConfig,
} from '../../security/session.js';
import type { Session } from '../../security/session.js';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import BoxelIcon from '../../components/icons/boxel-icon.gts';
import IconX from '../../components/icons/icon-x.gts';
import { handToCli } from '../../security/cli-handoff.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import { navigation } from '../navigation.js';
import { pageAwaitsData } from '../telemetry.ts';
import type { PageVisit } from '../../telemetry/instrument.ts';

import EditPage from './edit-page.gts';

export type Config = ReturnType<typeof readConfig>;

type State = 'checking' | 'signed-out' | 'signed-in';

export interface KeysWindowAPI {
  config: Config;
  // What a page calls when the server refuses a request as signed out.
  signedOut: () => void;
  // Where a page reports how loading its data ended, for the telemetry.
  visit: PageVisit;
  // Closes the window, or for a window opened for the CLI that hasn't told
  // it yet, tells it the change was cancelled.
  close: () => void;
  // Whether the window was opened for the CLI.
  forCli: boolean;
  // Tells the CLI the change is made, and answers whether it did: false when
  // the window wasn't opened for the CLI, or has told it already.
  tellCliDone: () => boolean;
}

interface Signature {
  Args: {
    // What the bar says the window is for.
    title: string;
    // Which key page this is, for tests to tell the pages apart while the
    // window shows only that it is signed out.
    page: string;
    // The CLI listener the window was opened for, if any.
    cli?: CliCallback;
  };
  Blocks: { default: [KeysWindowAPI] };
}

export default class KeysWindow extends Component<Signature> {
  <template>
    <div
      class='keys-window'
      data-theme='light'
      data-test-secure-page
      data-test-keys-page={{@page}}
    >
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
      <div class='body' data-test-keys-panel>
        {{#if (this.is 'checking')}}
          <BusyMessage
            class='checking'
            @title='Checking your sign-in…'
            data-test-keys-checking
          />
        {{else if (this.is 'signed-out')}}
          <EditPage
            @heading={{if
              this.page.wasSignedIn
              'You’re signed out'
              'You’re not signed in'
            }}
            data-test-keys-signed-out
          >
            <:intro>Sign in to Boxel in the Boxel window you opened this from,
              then open your keys from there.</:intro>
            <:actions>
              <Button
                @kind='primary'
                data-test-keys-signed-out-close
                {{on 'click' this.close}}
              >Close this window</Button>
            </:actions>
          </EditPage>
        {{else}}
          {{yield this.api}}
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* The window is the sign-in page's purple, and its page sits on it in
         a white panel with the purple showing all round. */
      .keys-window {
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        background-color: var(--auth-page-background);
        color: var(--foreground);
      }
      .bar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        color: var(--boxel-light);
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
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
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
      /* On the white panel the theme's teal is 1.31:1, too faint for an
         indicator, so focus rings, whether drawn in --ring or as the global
         --boxel-outline, take the primary ink (4.95:1) there. A checkbox's
         edge is the muted foreground unticked, which marks the box clearly,
         and the primary ink ticked, around the teal fill. The bar keeps the
         teal, which reads on the purple. */
      .body {
        --ring: var(--primary-ink);
        --boxel-outline-color: var(--ring);
        --boxel-outline: var(--boxel-outline-width) var(--boxel-outline-style)
          var(--boxel-outline-color);
        --boxel-checkbox-border-color: var(--muted-foreground);
        --boxel-checkbox-checked-border-color: var(--primary-ink);
        flex: 1;
        display: flex;
        flex-direction: column;
        margin: 0 var(--boxel-sp) var(--boxel-sp);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--background);
        overflow: hidden;
      }
      .checking {
        margin-top: var(--boxel-sp-xxl);
      }
    </style>
  </template>

  private config = readConfig();
  // `wasSignedIn`: whether the session ended while the window was open, rather
  // than the window opening without one.
  private page = trackedObject<{ state: State; wasSignedIn: boolean }>({
    state: 'checking',
    wasSignedIn: false,
  });
  // The page under it reports through this when its data has loaded.
  private visit = pageAwaitsData();
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
    window.removeEventListener('focus', this.recheck);
  }

  private is = (state: State) => this.page.state === state;

  private get api(): KeysWindowAPI {
    return {
      config: this.config,
      signedOut: this.ended,
      close: this.close,
      visit: this.visit,
      forCli: Boolean(this.args.cli),
      tellCliDone: () => this.tellCli('done'),
    };
  }

  private async check() {
    let session = await liveSession(this.config);
    if (session) {
      this.begin(session);
    } else {
      this.visit.signedOut();
      this.page.state = 'signed-out';
    }
  }

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
    window.addEventListener('focus', this.recheck);
  }

  // Coming back into view or focus, the window asks the server whether its
  // session still stands: the app's sign-out ends it on the server without
  // touching this origin's storage, and so does signing out in another
  // browser.
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
    this.page.wasSignedIn = true;
    this.visit.signedOut();
    this.stopListening?.();
    document.removeEventListener('visibilitychange', this.recheck);
    window.removeEventListener('focus', this.recheck);
    this.page.state = 'signed-out';
  };

  private toldCli = false;
  private tellCli(outcome: 'done' | 'cancelled'): boolean {
    let { cli } = this.args;
    if (!cli || this.toldCli) {
      return false;
    }
    this.toldCli = true;
    handToCli(cli, { window: outcome });
    return true;
  }
  private close = () => {
    if (!this.tellCli('cancelled')) {
      navigation.close();
    }
  };
}
