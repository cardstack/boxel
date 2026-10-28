// The `connected` page, where the realm server sends the window once a
// service has sent the user back from signing in. Its fragment carries the
// service's one-use `code` and the sign-in's `state`, or `#error=<why>` when
// the service declined. The page reads it, takes it out of the address bar,
// and finishes the sign-in with the window's own session: the realm server
// exchanges the code, and only for the user who started the sign-in, so a
// sign-in link someone else started can't put this user's account under
// theirs. The page then says what happened in plain words, naming a new
// connection as the key listing does. The window can't tell whether it was opened for
// something, so it offers to close and to go back to the user's keys, and
// closes itself only when the user asks.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { completeConnect, showKey } from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import { isSignedOut, LinkError, loadFailure } from './context.ts';
import EditPage from './edit-page.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';

// Why a sign-in failed, as the realm server's callback names it, in the
// words the page uses.
const FAILURES: Record<string, { heading: string; message: string }> = {
  expired: {
    heading: 'The sign-in expired',
    message:
      'The sign-in took too long, or its link was already used. Nothing was connected. Connect again to start a new one.',
  },
  denied: {
    heading: 'The sign-in was declined',
    message:
      'The service didn’t give Boxel access, because the sign-in was cancelled there or the service refused it. Nothing was connected.',
  },
  failed: {
    heading: 'The sign-in didn’t finish',
    message:
      'The service didn’t complete the sign-in, so nothing was connected. Try connecting again. If it keeps happening, the app may need its settings checked.',
  },
  'name-taken': {
    heading: 'That name is taken',
    message:
      'While you were signing in, another of your keys was given the name this connection was to have, so nothing was connected. Connect again under another name.',
  },
};

// What the fragment says, read once as the page starts and then taken out of
// the address bar, so going back or reloading doesn't show it again.
function takeOutcome(): {
  code?: string;
  state?: string;
  connected?: string;
  error?: string;
} {
  let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (window.location.hash) {
    history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return {
    code: fragment.get('code') || undefined,
    state: fragment.get('state') || undefined,
    connected: fragment.get('connected') || undefined,
    error: fragment.get('error') || undefined,
  };
}

type State =
  | { name: 'loading' }
  | { name: 'connected'; keyName?: string }
  | { name: 'failed'; heading: string; message: string }
  | { name: 'unknown' };

class Connected extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.unknown}}
      <LoadFailed
        @heading='Connect an account'
        @failure={{this.linkFailure}}
        @onRetry={{this.keys}}
      />
    {{else}}
      <EditPage
        @heading={{this.heading}}
        role='status'
        data-test-connected={{if this.connected 'connected' 'failed'}}
      >
        <:default>
          <p class='info' data-test-connected-message>
            {{#if this.connected}}
              {{#if this.connected.keyName}}
                Your account is connected as
                <strong
                  data-test-connected-name
                >{{this.connected.keyName}}</strong>.
              {{else}}
                Your account is connected.
              {{/if}}
              Cards can use it only for the requests you approve.
            {{else if this.failed}}
              {{this.failed.message}}
            {{/if}}
          </p>
        </:default>
        <:actions>
          <Button
            @kind='secondary'
            data-test-connected-keys
            {{on 'click' this.keys}}
          >Back to your keys</Button>
          <Button
            @kind='primary'
            data-test-connected-close
            {{on 'click' @api.close}}
          >Close</Button>
        </:actions>
      </EditPage>
    {{/if}}

    <style scoped>
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .info {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private outcome = takeOutcome();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private linkFailure = loadFailure(
    new LinkError(
      'this page names no connection and no reason a sign-in failed',
      'This link doesn’t say how a sign-in ended.',
    ),
  );

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get unknown() {
    return this.page.state.name === 'unknown';
  }
  private get connected() {
    return this.page.state.name === 'connected' ? this.page.state : undefined;
  }
  private get failed() {
    return this.page.state.name === 'failed' ? this.page.state : undefined;
  }

  private get heading() {
    return this.failed?.heading ?? 'Connected';
  }

  private async load() {
    let { connected, error, code, state } = this.outcome;
    if (code && state) {
      try {
        ({ connected, error } = await completeConnect(this.args.api.config, {
          state,
          code,
        }));
      } catch (e) {
        if (isSignedOut(e)) {
          this.args.api.signedOut();
          return;
        }
        this.args.api.visit.loadFailed(e);
        error = 'failed';
      }
    }
    if (connected) {
      try {
        let key = await showKey(this.args.api.config, connected);
        this.page.state = { name: 'connected', keyName: key.name };
        this.args.api.visit.loaded();
      } catch (e) {
        if (isSignedOut(e)) {
          this.args.api.signedOut();
          return;
        }
        // The connection is made whether or not its name can be read.
        this.args.api.visit.loadFailed(e);
        this.page.state = { name: 'connected' };
      }
      return;
    }
    // A reason the page doesn't know of reads as a sign-in that didn't
    // finish.
    let failure = error
      ? Object.hasOwn(FAILURES, error)
        ? FAILURES[error]!
        : FAILURES.failed!
      : undefined;
    this.page.state = failure
      ? { name: 'failed', ...failure }
      : { name: 'unknown' };
    this.args.api.visit.loaded();
  }

  private keys = () => navigation.assign(pageURL('keys'));
}

export default class ConnectedPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='connected' as |api|>
      <Connected @api={{api}} />
    </KeysWindow>
  </template>
}
