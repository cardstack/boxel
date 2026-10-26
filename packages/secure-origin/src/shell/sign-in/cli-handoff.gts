// Hands a sign-in to the CLI waiting on its loopback port, once, as soon as
// the page is drawn, and says so while the browser navigates there.
//
// `boxel keys sign-in` is handed the secure session. A profile sign-in
// (`boxel profile add`) is handed a single-use Matrix login token, which the
// CLI redeems for a Matrix device of its own, and the secure session too when
// the CLI takes one (`handProfileSignIn`).
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { handProfileSignIn, handToCli } from '../../security/cli-handoff.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import { endSession, loginToken, readConfig } from '../../security/session.js';
import type { Session } from '../../security/session.js';
import { navigation } from '../navigation.js';
import { asSentence } from '../sign-in-copy.js';

import MessagePage from './message-page.gts';

interface Signature {
  Args: {
    // A value `isCliCallback` accepts; `handToCli` refuses anything else.
    callback: CliCallback;
    session: Session;
  };
}

export default class CliHandoff extends Component<Signature> {
  <template>
    {{#if this.state.error}}
      <MessagePage @heading='That didn’t work'>
        <div class='error' role='alert' data-test-secure-error>
          {{this.state.error}}
        </div>
        <p class='info' data-test-secure-cli-handoff-failed>Run
          <code>boxel profile add</code>
          in your terminal again.</p>
      </MessagePage>
    {{else}}
      <MessagePage @heading='Returning to your terminal…' @info='One moment.' />
    {{/if}}

    <style scoped>
      .error {
        color: var(--destructive-ink);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
      .info {
        margin: var(--boxel-sp-lg) 0 0;
        color: var(--foreground);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
      }
      .info code {
        font-family: var(--boxel-monospace-font-family, monospace);
      }
    </style>
  </template>

  private state = trackedObject({ error: undefined as string | undefined });

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.handOver();
  }

  private async handOver() {
    let { callback, session } = this.args;
    if (!callback.profile) {
      handToCli(callback, { session });
      return;
    }
    let config = readConfig();
    try {
      await handProfileSignIn(callback, session, {
        // A second sign-in within a minute waits out the Matrix server's
        // limit of one login token a minute, inside `loginToken`.
        mintLoginToken: async (s) => (await loginToken(config, s)).loginToken,
        endSession: (s) => endSession(config, s),
        navigate: (url: string) => navigation.replace(url),
      });
    } catch (e) {
      this.state.error = asSentence((e as Error).message);
    }
  }
}
