// The `connect` page: connects one of the user's accounts at a service, by
// signing in there through an OAuth app. It lists the apps the realm server
// offers the user — those shared into the workspace the window was opened
// for, Boxel's own for services the workspace shares none for, then the
// user's own — each with the permissions it asks for. When one app is the
// workspace's or Boxel's, it starts out chosen.
// The user picks one and names the connection, and the window goes to the
// service's sign-in page. The service sends the user back to the realm
// server, which finishes the sign-in and sends the window on to `connected`.
// No token the service issues ever reaches this page.
//
// Opened for an operation, the page first says what it is for, as the realm
// server describes it, and offers only the apps that serve the operation's
// destination. Opened with `#reconnect=<key id>`, from a connection on the key
// page, it signs that connection in again under its own name. With no app to
// offer, it says who can set one up.
//
// Reached from an approve page's "Add a new key" (`then=approve` or
// `then=review-changes`, by way of `enter-key`), it keeps that page for
// `connected` to go back to once the user has signed in, with the new
// connection chosen (`approval-return.ts`). An approval `boxel keys approve`
// opened is still the CLI's here: closing the window cancels it.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  connectableClients,
  showKey,
  startConnect,
  windowContext,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import { Button } from '@cardstack/pretui/components/button';
import { Field } from '@cardstack/pretui/components/field';
import { Alert } from '@cardstack/pretui/components/alert';
import KeyRound from '@cardstack/boxel-icons/key-round';
import Tag from '@cardstack/boxel-icons/tag';
import { Input } from '@cardstack/pretui/components/input';
import { ignoredByPasswordManagers } from '@cardstack/pretui/password-managers';
import { navigation } from '../navigation.js';
import {
  addressAbove,
  isKeyPageAddress,
  keyPageURL,
  pageTitle,
} from './trail.ts';

import { approvalPageThen, keepApprovalForSignIn } from './approval-return.ts';
import ClientPicker from './client-picker.gts';
import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { ConnectableClient, ListedKey, WindowContext } from './context.ts';
import EditPage from './edit-page.gts';
import KeyTile from './key-tile.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { cliOpenedFor, contextRequest, openedFor } from './opened-for.ts';
import { addressOf } from './workspaces.ts';

// The app that starts out chosen: the only one offered, or the one app that
// is the workspace's or Boxel's, which the realm server lists ahead of the
// user's own. With several such apps (two shared, or apps for different
// services) the user picks.
export function defaultClient(
  clients: ConnectableClient[],
): number | undefined {
  if (clients.length === 1) {
    return 0;
  }
  let offered = clients.filter((client) => client.kind !== 'own');
  return offered.length === 1 && clients[0] === offered[0] ? 0 : undefined;
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  // `connection` is the connection being signed in again, if any.
  | {
      name: 'choosing';
      clients: ConnectableClient[];
      context?: WindowContext;
      connection?: ListedKey;
    };

class Connect extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading={{this.heading}}
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.choosing}}
      <form
        novalidate
        data-form-type='other'
        {{on 'submit' this.connect}}
        data-test-connect-form
      >
        <EditPage @heading={{this.heading}} data-test-connect>
          <:intro>You sign in on the site itself, in this window. Boxel keeps
            the sign-in encrypted, and cards can use it only for the requests
            you approve.</:intro>
          <:default>
            {{#if this.choosing.context}}
              <OpenedForSummary
                @context={{this.choosing.context}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            {{#if this.choosing.connection}}
              <Field
                @reserveMessage={{false}}
                @orientation='horizontal'
                @labelTag='span'
                @label='Connection'
                @icon={{KeyRound}}
                data-test-connect-connection
              >
                <KeyTile @key={{this.choosing.connection}} />
              </Field>
            {{/if}}
            {{#if this.choosing.clients.length}}
              <ClientPicker
                @clients={{this.choosing.clients}}
                @selected={{this.form.client}}
                @onSelect={{this.selectClient}}
                @realmName={{this.choosing.context.realm.name}}
              />
              {{#unless this.choosing.connection}}
                <Field
                  @reserveMessage={{false}}
                  @orientation='horizontal'
                  @label='Name'
                  @icon={{Tag}}
                  data-test-connect-field='name'
                  as |controlId|
                >
                  <Input
                    @controlId={{controlId}}
                    @type='text'
                    autocomplete='off'
                    @placeholder='A name you’ll recognize, such as “Work GitHub”'
                    @value={{this.form.name}}
                    @onInput={{this.setName}}
                    name='connection-name'
                    {{ignoredByPasswordManagers}}
                    data-test-connect-name
                  />
                </Field>
              {{/unless}}
            {{else}}
              <div class='no-clients' data-test-connect-no-clients>
                <p class='message'>No sign-in app is set up for this site.</p>
                {{#if this.needsAdmin}}
                  <p class='message' data-test-connect-needs-admin>Someone with
                    direct write access to
                    <strong>{{this.needsAdmin.name}}</strong>
                    (<span>{{addressOf this.needsAdmin.url}}</span>) needs to
                    share one with it.</p>
                {{else}}
                  <p class='message'>Add one on your key page with Add a key,
                    choosing Sign-in app. Then come back here to connect your
                    account.</p>
                {{/if}}
              </div>
            {{/if}}
            {{#if this.form.error}}
              <Alert @tone='danger' role='alert'>
                <span data-test-keys-error>{{this.form.error}}</span>
              </Alert>
            {{/if}}
          </:default>
          <:actions>
            {{#if this.backToKeys}}
              <Button
                type='button'
                @variant='secondary'
                data-test-connect-back
                {{on 'click' this.back}}
              >Back to your keys</Button>
            {{/if}}
            {{#if this.choosing.clients.length}}
              <Button
                type='submit'
                @variant='primary'
                @disabled={{this.submitDisabled}}
                @loading={{this.form.connecting}}
                data-test-connect-submit
              >{{if this.choosing.connection 'Reconnect' 'Connect'}}</Button>
            {{/if}}
          </:actions>
        </EditPage>
      </form>
    {{/if}}

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .no-clients {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .message {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
    </style>
  </template>

  private opened = openedFor();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    // The index of the chosen client.
    client: undefined as number | undefined,
    name: '',
    // Until a name is typed, a connection is named after its app.
    nameTyped: false,
    connecting: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private get heading() {
    return pageTitle('connect', Boolean(this.opened.reconnect));
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }

  // The workspace the window was opened for, when the user isn't one of its
  // direct writers: only a direct writer may share an app into it.
  private get needsAdmin() {
    let realm = this.choosing?.context?.realm;
    return realm && !realm.directWriter ? realm : undefined;
  }

  private load = async () => {
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      let connection: ListedKey | undefined;
      if (this.opened.reconnect) {
        connection = await this.connectionToReconnect(this.opened.reconnect);
      }
      let request = contextRequest(this.opened);
      let context = request
        ? ((await windowContext(config, request)) as WindowContext)
        : undefined;
      // A reconnect signs in through the connection's own client, wherever
      // it is shared, so only that one is offered.
      let clients = await connectableClients(
        config,
        this.opened.reconnect
          ? { reconnect: this.opened.reconnect }
          : {
              realm: context?.realm.url,
              destination: context?.operation?.destination?.href,
            },
      );
      this.page.state = { name: 'choosing', clients, context, connection };
      let client = connection?.oauth?.connection?.client;
      let same = client
        ? clients.findIndex(
            (c) =>
              client.ref !== null &&
              JSON.stringify(c.ref) === JSON.stringify(client.ref),
          )
        : -1;
      if (same !== -1) {
        this.selectClient(same);
      } else {
        let preferred = defaultClient(clients);
        if (preferred !== undefined) {
          this.selectClient(preferred);
        }
      }
      this.args.api.visit.loaded();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.page.state = { name: 'load-failed', failure: loadFailure(e) };
      }
    }
  };

  private async connectionToReconnect(keyId: string): Promise<ListedKey> {
    let notYours = new LinkError(
      'the connection this page names isn’t one of yours',
      'This connection isn’t one of yours. It may have been deleted.',
    );
    let key: ListedKey;
    try {
      key = await showKey(this.args.api.config, keyId);
    } catch (e) {
      if ((e as { status?: unknown })?.status === 404) {
        throw notYours;
      }
      throw e;
    }
    if (key.kind !== 'oauth-connection') {
      throw notYours;
    }
    return key;
  }

  private get submitDisabled() {
    return (
      this.form.connecting ||
      this.form.client === undefined ||
      (!this.choosing?.connection && !this.form.name.trim())
    );
  }

  private selectClient = (index: number) => {
    this.form.client = index;
    this.form.error = undefined;
    let client = this.choosing?.clients[index];
    if (client && !this.form.nameTyped) {
      this.form.name = client.label;
    }
  };

  private setName = (value: string) => {
    this.form.name = value;
    this.form.nameTyped = true;
    this.form.error = undefined;
  };

  private back = () => navigation.back(keyPageURL());

  // Opened for nothing, the page offers the way back to the key page. Reached
  // from another key page (replacing a key, say), its trail leads back there
  // instead.
  private get backToKeys() {
    let above = addressAbove();
    return (
      !this.choosing?.context &&
      (above === undefined || isKeyPageAddress(above))
    );
  }

  // Mints the ticket for this sign-in, asks the realm server to start it, and
  // sends the window to the service's sign-in page.
  private connect = async (event: Event) => {
    event.preventDefault();
    let choosing = this.choosing;
    let client =
      this.form.client === undefined
        ? undefined
        : choosing?.clients[this.form.client];
    if (this.submitDisabled || !choosing || !client) {
      return;
    }
    this.form.connecting = true;
    this.form.error = undefined;
    try {
      let { authorizeUrl } = await startConnect(
        this.args.api.config,
        choosing.connection
          ? { client: client.ref, reconnect: choosing.connection.id }
          : { client: client.ref, name: this.form.name.trim() },
      );
      keepApprovalForSignIn(authorizeUrl);
      navigation.assign(authorizeUrl);
    } catch (e) {
      this.form.connecting = false;
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.form.error = failureMessage(e);
    }
  };
}

export default class ConnectPage extends Component {
  <template>
    <KeysWindow
      @title='Boxel · Your keys'
      @page='connect'
      @cli={{this.cli}}
      as |api|
    >
      <Connect @api={{api}} />
    </KeysWindow>
  </template>

  private cli = approvalPageThen() ? cliOpenedFor().cli : undefined;
}
