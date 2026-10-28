// Where Google sends the window back to. It finishes whichever sign-in began
// there: the window's own, which it keeps, or the CLI's, which it hands to the
// CLI's listener.
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  finishGoogleSignIn,
  readConfig,
  storeSession,
} from '../../security/session.js';
import { isCliCallback } from '../../security/cli-handoff.js';
import type { Session } from '../../security/session.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import AuthButton from '../../components/auth-button.gts';
import AuthContainer from '../../components/auth-container.gts';
import BusyMessage from '../../components/busy-message.gts';
import { navigation } from '../navigation.js';
import { asSentence } from '../sign-in-copy.js';
import { pageURL, startURL } from '../urls.js';

import CliHandoff from './cli-handoff.gts';
import IncompleteCliLink from './incomplete-cli-link.gts';
import MessagePage from './message-page.gts';
import SignedIn from './signed-in.gts';

type State =
  | { name: 'signing-in' }
  | { name: 'failed'; error: string; startAgain: string }
  | { name: 'handing-to-cli'; callback: CliCallback; session: Session }
  | { name: 'incomplete-cli-link' }
  | { name: 'signed-in' };

export default class GoogleCallback extends Component {
  <template>
    {{#if this.signedIn}}
      <SignedIn />
    {{else if this.handoff}}
      <CliHandoff
        @callback={{this.handoff.callback}}
        @session={{this.handoff.session}}
      />
    {{else if this.incompleteCliLink}}
      <IncompleteCliLink />
    {{else if this.failure}}
      <MessagePage @heading='That didn’t work'>
        <div class='error' role='alert' data-test-secure-error>
          {{this.failure.error}}
        </div>
        <div class='button-wrapper'>
          <AuthButton
            @as='anchor'
            @href={{this.failure.startAgain}}
            @variant='secondary'
            data-test-secure-start-again
          >Start again</AuthButton>
        </div>
      </MessagePage>
    {{else}}
      <AuthContainer>
        <BusyMessage @title='Signing you in…' data-test-secure-signing-in />
      </AuthContainer>
    {{/if}}

    <style scoped>
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
        color: var(--muted-foreground);
      }
    </style>
  </template>

  private page = trackedObject<{ state: State }>({
    state: { name: 'signing-in' },
  });

  private get state(): State {
    return this.page.state;
  }

  constructor(owner: Owner, args: object) {
    super(owner, args);
    this.finish();
  }

  private get signedIn() {
    return this.state.name === 'signed-in';
  }

  private get handoff() {
    return this.state.name === 'handing-to-cli' ? this.state : undefined;
  }

  private get incompleteCliLink() {
    return this.state.name === 'incomplete-cli-link';
  }

  private get failure() {
    return this.state.name === 'failed' ? this.state : undefined;
  }

  private async finish() {
    let result;
    try {
      result = await finishGoogleSignIn(readConfig());
    } catch (e: any) {
      let startAgain = startURL(e.resume);
      if (e.code === 'google-cancelled') {
        // Pressing Cancel at Google isn't a failure: back to the page the
        // sign-in started from, to try again or sign in with a password.
        navigation.replace(startAgain);
        return;
      }
      this.page.state = {
        name: 'failed',
        error: asSentence(e.message),
        startAgain,
      };
      return;
    }
    let { session, resume } = result;
    if (resume?.client === 'cli') {
      // A session signed in for the CLI goes to the CLI's listener or
      // nowhere: never kept as this window's own. Without a listener there is
      // nothing to start again here; the CLI makes a new link.
      if (!isCliCallback(resume.cli)) {
        this.page.state = { name: 'incomplete-cli-link' };
        return;
      }
      this.page.state = {
        name: 'handing-to-cli',
        callback: resume.cli,
        session,
      };
      return;
    }
    storeSession(session);
    // Back to the window's own address, so a reload shows the signed-in window
    // rather than this callback.
    history.replaceState(null, '', pageURL('sign-in'));
    this.page.state = { name: 'signed-in' };
  }
}
