// The Connected apps page: every app connected to the user's Boxel account
// through Boxel's OAuth provider, and a way to disconnect each connection.
// These are apps that act for the user in Boxel. The `connect` and `connected`
// pages are the other way round: Boxel signing in to outside services.
//
// An app's connections are grouped under its name, the one consent showed.
// Each connection lists what it reaches, when it was last used, connected and
// ends, and has its own Disconnect, confirmed in place: ending one never
// touches the app's others. After any answer to a disconnect the page reads
// the list again and shows what the server says, so a connection that ended
// some other way meanwhile is gone too, and a refusal is never taken for
// done. The list is read again when the window comes back into view or focus,
// and a connection whose end passes while the page is open drops off.
//
// The page lives in the secure window as the key pages do, under the window's
// own session, and never signs in itself.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { StatusChip } from '@cardstack/pretui/components/status-chip';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { focusWhen, listen } from '@cardstack/pretui/focus';

import BusyMessage from '../../components/busy-message.gts';
import {
  disconnectConnection,
  listConnections,
  type Connection,
} from '../../security/oauth-provider-connections.ts';
import type { AppName } from '../../security/oauth-provider.ts';
import { appNameShown } from '../authorize/copy.ts';
import { isSignedOut, loadFailure, type LoadFailure } from '../keys/context.ts';
import EditPage from '../keys/edit-page.gts';
import KeysWindow, { type KeysWindowAPI } from '../keys/keys-window.gts';
import LoadFailed from '../keys/load-failed.gts';

import {
  accessLine,
  connectedLine,
  endsLine,
  groupByApp,
  hasEnded,
  lastUsedLine,
  type AppGroup,
} from './format.ts';

const HEADING = 'Connected apps';
const DISCONNECT_FAILED =
  'Boxel couldn’t end this connection. Check that you’re online and try again.';
// How often the page's times ("Ends in 12 min") move on.
const TICK_MS = 60 * 1000;

// The app as a sentence names it: the name Boxel can check, or the name an
// app that registered itself gave, quoted. An app that registered itself
// without a name has none to put in a sentence, only a description of where
// it returns to ("an app on this computer"), so a sentence leaves it out.
function nameInSentence(app: AppName): string | undefined {
  if (app.kind === 'dynamic' && !app.claimedName) {
    return undefined;
  }
  return appNameShown(app);
}

// The app as its group's heading names it. An app that registered itself
// without a name is described rather than named ("an app on this computer"),
// and a heading starts that description with a capital; a name, such as a
// domain, is shown as it is.
function appHeading(app: AppName): string {
  let name = appNameShown(app);
  return nameInSentence(app) === undefined
    ? name.charAt(0).toUpperCase() + name.slice(1)
    : name;
}

function joinNames(names: string[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(names);
}

interface ConfirmSignature {
  Args: {
    connection: Connection;
    // The id of the element naming the connection's question.
    headingId: string;
    disconnecting: boolean;
    error: string | undefined;
    onCancel: () => void;
    onDisconnect: () => void;
  };
}

// The confirmation that stands in for a connection's Disconnect: what ending
// it does, with Cancel focused, so a stray Enter cancels. Escape cancels too.
// While the disconnect is under way its button shows that it's busy but stays
// focusable, so focus never falls out of the panel, and neither button acts.
class ConfirmDisconnect extends Component<ConfirmSignature> {
  <template>
    <div
      class='confirm-panel'
      role='group'
      aria-labelledby={{this.headingId}}
      data-test-connected-apps-confirm
      {{listen 'keydown' this.keydown}}
    >
      <p class='confirm-heading' id={{this.headingId}}>{{this.question}}</p>
      <p class='confirm-text'>{{this.consequence}}</p>
      {{#if @error}}
        <Alert @tone='danger' role='alert'>
          <span data-test-connected-apps-disconnect-error>{{@error}}</span>
        </Alert>
      {{/if}}
      <div class='confirm-actions'>
        <Button
          type='button'
          @variant='secondary'
          @size='s'
          data-test-connected-apps-cancel
          {{focusWhen true}}
          {{on 'click' @onCancel}}
        >Cancel</Button>
        <Button
          type='button'
          @variant='destructive'
          @size='s'
          @loading={{@disconnecting}}
          data-test-connected-apps-confirm-disconnect
          {{on 'click' @onDisconnect}}
        >Disconnect</Button>
      </div>
    </div>

    <style scoped>
      .confirm-panel {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
      }
      .confirm-heading {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .confirm-text {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>

  private get headingId(): string {
    return this.args.headingId;
  }

  private get name(): string | undefined {
    return nameInSentence(this.args.connection.app);
  }

  private get question(): string {
    return this.name
      ? `Disconnect this ${this.name} connection?`
      : 'Disconnect this connection?';
  }

  private get consequence(): string {
    let reaches = joinNames(
      this.args.connection.resources.map((resource) => resource.name),
    );
    let again = this.name
      ? `To use it again, connect it from ${this.name}.`
      : 'To use it again, connect it from the app.';
    return `It loses access to ${reaches} right away. Other connections stay as they are. ${again}`;
  }

  private keydown = (event: Event) => {
    if ((event as KeyboardEvent).key === 'Escape' && !this.args.disconnecting) {
      event.preventDefault();
      this.args.onCancel();
    }
  };
}

interface ConnectedAppsSignature {
  Args: { api: KeysWindowAPI };
}

class ConnectedApps extends Component<ConnectedAppsSignature> {
  <template>
    {{#if this.state.loadFailed}}
      <LoadFailed
        @heading={{HEADING}}
        @failure={{this.state.loadFailed}}
        @onRetry={{this.retry}}
      />
    {{else}}
      <EditPage @heading={{HEADING}} data-test-connected-apps>
        <:intro>Apps that can use your Boxel account.</:intro>
        <:default>
          <VisuallyHidden
            role='status'
            data-test-connected-apps-announcement
          >{{this.state.announcement}}</VisuallyHidden>
          {{#if this.state.loading}}
            <BusyMessage @title='Loading…' />
          {{else if this.groups.length}}
            <ul class='apps' data-test-connected-apps-list>
              {{#each this.groups key='key' as |group|}}
                <li class='app' data-test-connected-app={{group.app.shown}}>
                  <div class='app-header'>
                    <h2 class='app-name' data-test-connected-app-name>
                      {{this.appTitle group}}
                    </h2>
                    {{#if (this.isUnverified group)}}
                      <StatusChip
                        @value='Unverified'
                        @tone='warning'
                        @appearance='soft'
                        @dot={{false}}
                        data-test-connected-app-unverified
                      />
                    {{/if}}
                  </div>
                  {{#if (this.returnsTo group)}}
                    <p class='app-note' data-test-connected-app-note>
                      {{this.returnsTo group}}
                    </p>
                  {{/if}}
                  <ul class='connections'>
                    {{#each group.connections key='id' as |connection|}}
                      <li
                        class='connection'
                        data-test-connection={{connection.id}}
                      >
                        <div
                          class='connection-details'
                          id={{this.detailsId connection}}
                        >
                          {{#each connection.resources as |resource|}}
                            <p class='resource' data-test-connection-resource>
                              <span
                                class='resource-name'
                              >{{resource.name}}</span>
                              ·
                              <span data-test-connection-access>{{this.access
                                  resource.labels
                                }}</span>
                            </p>
                          {{/each}}
                          <p class='dates'>
                            <span data-test-connection-last-used>{{this.lastUsed
                                connection
                              }}</span>
                            ·
                            <span
                              data-test-connection-connected
                            >{{this.connected connection}}</span>
                            ·
                            <span data-test-connection-ends>{{this.ends
                                connection
                              }}</span>
                          </p>
                        </div>
                        {{#if (this.isConfirming connection)}}
                          <div class='confirm-slot'>
                            <ConfirmDisconnect
                              @connection={{connection}}
                              @headingId={{this.confirmId connection}}
                              @disconnecting={{this.state.disconnecting}}
                              @error={{this.state.disconnectError}}
                              @onCancel={{this.cancel}}
                              @onDisconnect={{fn this.disconnect connection}}
                            />
                          </div>
                        {{else}}
                          <Button
                            class='disconnect'
                            type='button'
                            @variant='secondary'
                            @size='s'
                            aria-describedby={{this.detailsId connection}}
                            data-disconnect-for={{connection.id}}
                            data-test-connection-disconnect
                            {{on 'click' (fn this.confirm connection)}}
                          >Disconnect</Button>
                        {{/if}}
                      </li>
                    {{/each}}
                  </ul>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <div
              class='empty'
              tabindex='-1'
              data-connected-apps-empty
              data-test-connected-apps-empty
            >
              <EmptyState
                @size='s'
                @title='No apps are connected to your Boxel account.'
                @message='Apps you connect, such as Claude or ChatGPT, appear here.'
              />
            </div>
          {{/if}}
        </:default>
      </EditPage>
    {{/if}}

    <style scoped>
      .apps,
      .connections {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .apps {
        gap: var(--boxel-sp-lg);
      }
      .app {
        display: grid;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .app + .app {
        padding-top: var(--boxel-sp-lg);
        border-top: 1px solid var(--border);
      }
      .app-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .app-name {
        margin: 0;
        font-size: var(--boxel-font-size);
        line-height: var(--boxel-line-height);
        font-weight: 600;
        color: var(--foreground);
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .app-note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .connections {
        gap: var(--boxel-sp-xs);
      }
      .connection {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--boxel-sp-xs) var(--boxel-sp);
        align-items: start;
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
      }
      .connection-details {
        display: grid;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }
      .resource {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .resource-name {
        font-weight: 600;
      }
      .dates {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      /* The confirmation takes the row's full width under its details. */
      .confirm-slot {
        grid-column: 1 / -1;
      }
      .empty:focus {
        outline: none;
      }
    </style>
  </template>

  private state = trackedObject({
    loading: true,
    connections: [] as Connection[],
    loadFailed: undefined as LoadFailure | undefined,
    // The connection whose Disconnect is being confirmed.
    confirming: undefined as string | undefined,
    disconnecting: false,
    disconnectError: undefined as string | undefined,
    // What the page last told a screen reader, politely.
    announcement: '',
    now: new Date(),
  });
  private loaded = false;
  // Each read of the list is numbered, and only the latest one's answer is
  // shown, so a read that started earlier can't land later and bring back a
  // connection that has since been disconnected.
  private reads = 0;
  // Alternates a trailing no-break space, so the same announcement made twice
  // in a row still changes the status and is read out again.
  private announcements = 0;
  private tick: ReturnType<typeof setInterval> | undefined;

  constructor(owner: Owner, args: ConnectedAppsSignature['Args']) {
    super(owner, args);
    this.load();
    this.tick = setInterval(() => {
      this.state.now = new Date();
    }, TICK_MS);
    document.addEventListener('visibilitychange', this.reread);
    window.addEventListener('focus', this.reread);
  }

  willDestroy() {
    super.willDestroy();
    clearInterval(this.tick);
    document.removeEventListener('visibilitychange', this.reread);
    window.removeEventListener('focus', this.reread);
  }

  private get groups(): AppGroup[] {
    let now = this.state.now;
    return groupByApp(
      this.state.connections.filter((connection) => !hasEnded(connection, now)),
    );
  }

  // Element ids for a connection's parts, made here rather than from the
  // connection's id, which the server chooses.
  private ids = new Map<string, number>();
  private idFor(connection: Connection): number {
    let n = this.ids.get(connection.id);
    if (n === undefined) {
      n = this.ids.size + 1;
      this.ids.set(connection.id, n);
    }
    return n;
  }
  private detailsId = (connection: Connection) =>
    `connection-details-${this.idFor(connection)}`;
  private confirmId = (connection: Connection) =>
    `connection-confirm-${this.idFor(connection)}`;

  private appTitle = (group: AppGroup): string => {
    let name = appHeading(group.app);
    let count = group.connections.length;
    return count > 1 ? `${name} · ${count} connections` : name;
  };

  private isUnverified = (group: AppGroup): boolean => !group.app.verified;

  // For an app that named itself, where it returns to: the address Boxel can
  // check, or "an app on this computer".
  private returnsTo = (group: AppGroup): string | undefined => {
    let { app } = group;
    if (app.kind !== 'dynamic' || !app.claimedName) {
      return undefined;
    }
    return `Returns to ${app.shown}`;
  };

  private access = (labels: string[]) => accessLine(labels);
  private lastUsed = (connection: Connection) =>
    lastUsedLine(connection.lastUsedAt, this.state.now);
  private connected = (connection: Connection) =>
    connectedLine(connection.connectedAt, this.state.now);
  private ends = (connection: Connection) =>
    endsLine(connection.endsAt, this.state.now);

  private isConfirming = (connection: Connection) =>
    this.state.confirming === connection.id;

  private async load() {
    let read = ++this.reads;
    try {
      let connections = await listConnections(this.args.api.config);
      if (read !== this.reads) {
        return;
      }
      this.state.connections = connections;
      this.state.now = new Date();
      if (!this.loaded) {
        this.loaded = true;
        this.args.api.visit.loaded();
      }
    } catch (e) {
      if (read !== this.reads) {
        return;
      }
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else if (!this.loaded) {
        this.args.api.visit.loadFailed(e);
        // The page says what went wrong in its own words alone.
        this.state.loadFailed = { ...loadFailure(e), details: [] };
      }
      // A list read again that fails keeps what the page shows.
    }
    this.state.loading = false;
  }

  private retry = () => {
    this.state.loadFailed = undefined;
    this.state.loading = true;
    this.load();
  };

  // Coming back into view or focus, the page reads the list again, unless
  // it's in the middle of a disconnect.
  private reread = () => {
    if (
      document.visibilityState !== 'visible' ||
      !this.loaded ||
      this.state.disconnecting
    ) {
      return;
    }
    this.load();
  };

  private confirm = (connection: Connection) => {
    this.state.disconnectError = undefined;
    this.state.confirming = connection.id;
  };

  private cancel = () => {
    if (this.state.disconnecting) {
      return;
    }
    let id = this.state.confirming;
    this.state.confirming = undefined;
    this.state.disconnectError = undefined;
    if (id) {
      this.focusDisconnect(id);
    }
  };

  private disconnect = async (connection: Connection) => {
    if (this.state.disconnecting) {
      return;
    }
    let order = this.groups.flatMap((group) =>
      group.connections.map((c) => c.id),
    );
    let at = order.indexOf(connection.id);
    let neighbours = [...order.slice(at + 1), ...order.slice(0, at).reverse()];
    this.state.disconnecting = true;
    this.state.disconnectError = undefined;
    let done = false;
    try {
      await disconnectConnection(this.args.api.config, connection.id);
      done = true;
    } catch (e) {
      if (isSignedOut(e)) {
        this.state.disconnecting = false;
        this.args.api.signedOut();
        return;
      }
      this.state.disconnectError = DISCONNECT_FAILED;
    }
    if (done) {
      // Gone at once, whatever the list read next says.
      this.state.connections = this.state.connections.filter(
        (c) => c.id !== connection.id,
      );
      this.state.confirming = undefined;
      let name = nameInSentence(connection.app);
      this.announce(
        name
          ? `Disconnected the ${name} connection.`
          : 'Disconnected the connection.',
      );
    }
    await this.load();
    this.state.disconnecting = false;
    if (done) {
      let next = neighbours.find((id) =>
        this.state.connections.some((c) => c.id === id),
      );
      this.focusAfterRemoval(next);
    }
  };

  private announce(text: string) {
    this.state.announcement = `${text}${++this.announcements % 2 ? '' : '\u00a0'}`;
  }

  // Focus goes to the Disconnect of the connection that took the removed
  // one's place, or of the one before it, or to the empty list.
  private focusAfterRemoval(next: string | undefined) {
    schedule('afterRender', () => {
      let target = next
        ? document.querySelector<HTMLElement>(
            `[data-disconnect-for="${CSS.escape(next)}"]`,
          )
        : document.querySelector<HTMLElement>('[data-connected-apps-empty]');
      target?.focus();
    });
  }

  private focusDisconnect(id: string) {
    schedule('afterRender', () => {
      document
        .querySelector<HTMLElement>(`[data-disconnect-for="${CSS.escape(id)}"]`)
        ?.focus();
    });
  }
}

export default class ConnectedAppsPage extends Component {
  <template>
    <KeysWindow
      @title='Boxel · Connected apps'
      @page='connected-apps'
      @reopen='Connected apps'
      as |api|
    >
      <ConnectedApps @api={{api}} />
    </KeysWindow>
  </template>
}
