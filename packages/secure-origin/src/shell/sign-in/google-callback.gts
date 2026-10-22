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
import LoadingIndicator from '../../components/loading-indicator.gts';
import { navigation } from '../navigation.js';
import { asSentence } from '../sign-in-copy.js';
import { modeURL, startURL } from '../urls.js';

import CliHandoff from './cli-handoff.gts';
import MessagePage from './message-page.gts';
import SignedIn from './signed-in.gts';

type State =
  | { name: 'signing-in' }
  | { name: 'failed'; error: string; startAgain: string }
  | { name: 'handing-to-cli'; callback: CliCallback; session: Session }
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
        <div class='centered-loading' data-test-secure-signing-in>
          <span class='loading-title'>Signing you in…</span>
          <LoadingIndicator class='loading-spinner' />
        </div>
      </AuthContainer>
    {{/if}}

    <style scoped>
      .centered-loading {
        align-self: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp);
        text-align: center;
      }
      .loading-title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
      }
      .loading-spinner {
        --boxel-loading-indicator-size: var(--boxel-icon-md);
        --loading-indicator-color: var(--boxel-highlight);
      }
      .error {
        color: var(--boxel-error-100);
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
      // nowhere: never kept as this window's own.
      if (!isCliCallback(resume.cli)) {
        this.page.state = {
          name: 'failed',
          error:
            'This sign-in link is not complete. Run the command in your terminal again to get a new link.',
          startAgain: modeURL('sign-in'),
        };
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
    history.replaceState(null, '', modeURL('sign-in'));
    this.page.state = { name: 'signed-in' };
  }
}
