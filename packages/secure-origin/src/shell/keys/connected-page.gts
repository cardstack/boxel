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
//
// A sign-in `boxel keys connect` started also names the CLI's loopback
// listener (`cli_port`, `cli_state`). The page then finishes nothing itself
// and needs no session of its own: once the user confirms, it hands the code
// and `state`, or why there is none, to the CLI, which finishes the sign-in
// with its own secure session.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { cliCallback, handToCli } from '../../security/cli-handoff.js';
import type { CliCallback } from '../../security/cli-handoff.js';
import { completeConnect, showKey } from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { navigation } from '../navigation.js';
import MessagePage from '../sign-in/message-page.gts';
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
      'The site didn’t give Boxel access: the sign-in was cancelled there, or the site refused it. Nothing was connected.',
  },
  failed: {
    heading: 'The sign-in didn’t finish',
    message:
      'The site didn’t complete the sign-in, so nothing was connected. Try connecting again. If it keeps happening, the sign-in app’s settings may need checking.',
  },
  'name-taken': {
    heading: 'That name is taken',
    message:
      'While you were signing in, another of your keys was given the name this connection was to have, so nothing was connected. Connect again under another name.',
  },
};

interface Outcome {
  code?: string;
  state?: string;
  connected?: string;
  error?: string;
  // The CLI waiting for this sign-in, when the CLI started it.
  cli?: CliCallback;
}

// What the fragment says, read once as the page starts and then taken out of
// the address bar, so going back or reloading doesn't show it again.
function takeOutcome(): Outcome {
  let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (window.location.hash) {
    history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }
  let cli = fragment.has('cli_port')
    ? cliCallback(
        new URLSearchParams({
          port: fragment.get('cli_port') ?? '',
          state: fragment.get('cli_state') ?? '',
        }),
        { profile: false },
      )
    : undefined;
  return {
    code: fragment.get('code') || undefined,
    state: fragment.get('state') || undefined,
    connected: fragment.get('connected') || undefined,
    error: fragment.get('error') || undefined,
    ...(cli ? { cli } : {}),
  };
}

type State =
  | { name: 'loading' }
  | { name: 'connected'; keyName?: string }
  | { name: 'failed'; heading: string; message: string }
  | { name: 'unknown' };

class Connected extends Component<{
  Args: { api: KeysWindowAPI; outcome: Outcome };
}> {
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

  private outcome = this.args.outcome;
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private linkFailure = loadFailure(
    new LinkError(
      'this page names no connection and no reason a sign-in failed',
      'This link doesn’t say how a sign-in ended.',
    ),
  );

  constructor(owner: Owner, args: { api: KeysWindowAPI; outcome: Outcome }) {
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

// Hands a sign-in the CLI started back to it, once the user says to: the
// service's code and `state`, or why the sign-in ended without them.
class ReturnToCli extends Component<{
  Args: { outcome: Outcome & { cli: CliCallback } };
}> {
  <template>
    {{#if this.state.handedOver}}
      <MessagePage @heading='Returning to your terminal…' @info='One moment.' />
    {{else}}
      <MessagePage
        @heading='Finish connecting in your terminal'
        @info={{this.info}}
      >
        <div class='actions'>
          <Button
            @kind='primary'
            data-test-connected-cli-continue
            {{on 'click' this.handOver}}
          >Continue in the terminal</Button>
        </div>
      </MessagePage>
    {{/if}}

    <style scoped>
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--boxel-sp-sm);
      }
    </style>
  </template>

  private state = trackedObject({ handedOver: false });

  private get info() {
    return this.args.outcome.code
      ? 'The Boxel CLI started this sign-in. Continue to hand it back to your terminal, which saves the connection as one of your keys.'
      : 'The Boxel CLI started this sign-in, and it didn’t finish. Continue to tell your terminal why.';
  }

  private handOver = () => {
    let { cli, code, state, error } = this.args.outcome;
    this.state.handedOver = true;
    handToCli(cli, {
      oauth: code && state ? { code, state } : { error: error ?? 'failed' },
    });
  };
}

export default class ConnectedPage extends Component {
  <template>
    {{#if this.cliOutcome}}
      <ReturnToCli @outcome={{this.cliOutcome}} />
    {{else}}
      <KeysWindow @title='Boxel · Your keys' @page='connected' as |api|>
        <Connected @api={{api}} @outcome={{this.outcome}} />
      </KeysWindow>
    {{/if}}
  </template>

  private outcome = takeOutcome();

  private get cliOutcome() {
    let { cli } = this.outcome;
    return cli ? { ...this.outcome, cli } : undefined;
  }
}
