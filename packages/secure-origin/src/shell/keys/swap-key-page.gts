// The `swap-key` page: one of the user's own keys put into a realm's suspended
// share, which then resumes under the same label with the user as its owner,
// so the cards using it keep working unchanged. Only a key the user already
// has goes in: adding one is a change of its own, made on the key page. Only a
// direct writer of the realm may swap a key in; anyone else is told an
// administrator needs to set it up.
//
// Opened by `boxel keys swap` (`#cli_port=…&cli_state=…`), for a swap that
// grants the key a destination it has none for, the page tells the CLI's
// listener when the swap is made, and nothing else.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  listKeys,
  realmShares,
  swapKey,
  windowContext,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import Tag from '../../components/icons/tag.gts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { KeyShare, UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeyPicker from './key-picker.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import NeedsAdmin from './needs-admin.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { cliOpenedFor, openedFor } from './opened-for.ts';
import { handToCli } from '../../security/cli-handoff.js';

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'needs-admin'; context: WindowContext }
  | { name: 'active'; context: WindowContext; share: KeyShare }
  | { name: 'choosing'; context: WindowContext; share: KeyShare }
  | { name: 'done'; context: WindowContext; share: KeyShare; key: string };

// Why a share stopped serving, in the words its writers see.
const SUSPENDED_BECAUSE: Record<string, string> = {
  'owner-lost-write':
    'The person who shared its key no longer has direct write access to this workspace.',
  'suspended-by-writer':
    'Someone with direct write access to this workspace suspended it.',
  'key-deleted': 'The person who shared its key deleted it.',
};

class SwapKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading='Share your key in place of one that stopped working'
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.needsAdmin}}
      <NeedsAdmin @realm={{this.needsAdmin.context.realm}} />
    {{else if this.active}}
      <EditPage @heading='This shared key is working' data-test-swap-key-active>
        <:intro><strong>{{this.active.share.label}}</strong>
          in
          <strong>{{this.active.context.realm.name}}</strong>
          isn’t suspended, so there is nothing to replace.</:intro>
      </EditPage>
    {{else if this.done}}
      <DonePage @heading='Key shared' @onClose={{@api.close}}>
        <strong data-test-keys-done-label>{{this.done.share.label}}</strong>
        in
        <strong>{{this.done.context.realm.name}}</strong>
        now uses your key
        <strong>{{this.done.key}}</strong>, and works again.
      </DonePage>
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.save}} data-test-swap-key-form>
        <EditPage
          @heading='Share your key in place of one that stopped working'
          data-test-swap-key
        >
          <:intro>This shared key stopped working. Share one of your own keys in
            its place: every request in the workspace that uses this shared key
            then sends your key instead, to wherever that request goes, and runs
            on your account at the service. You become the person sharing it.</:intro>
          <:default>
            <OpenedForSummary
              @context={{this.choosing.context}}
              @reason={{this.opened.reason}}
            />
            <FieldContainer
              @tag='div'
              @label='Shared key'
              @icon={{Tag}}
              data-test-swap-share
            >
              <div class='share'>
                <div class='share-label' data-test-swap-share-label>
                  {{this.choosing.share.label}}
                </div>
                <div class='share-state'>Suspended.
                  {{this.suspendedBecause}}</div>
              </div>
            </FieldContainer>
            <KeyPicker
              @keys={{this.form.keys}}
              @selected={{this.form.selected}}
              @onSelect={{this.select}}
              @onGoToKeys={{this.goToKeys}}
            />
            {{#if this.form.error}}
              <div class='keys-error' role='alert' data-test-keys-error>
                {{this.form.error}}
              </div>
            {{/if}}
          </:default>
          <:actions>
            <Button
              type='submit'
              @kind='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.form.saving}}
              data-test-swap-key-save
            >Share this key</Button>
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
      .share {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--card, var(--background));
        box-shadow: 0 0 0 1px var(--border);
        overflow-wrap: anywhere;
      }
      .share-label {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
      }
      .share-state {
        margin-top: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
    </style>
  </template>

  private opened = openedFor();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    keys: [] as UserKey[],
    selected: undefined as string | undefined,
    saving: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get needsAdmin() {
    return this.page.state.name === 'needs-admin' ? this.page.state : undefined;
  }
  private get active() {
    return this.page.state.name === 'active' ? this.page.state : undefined;
  }
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private get suspendedBecause() {
    let reason = this.choosing?.share.suspensionReason;
    return (reason && SUSPENDED_BECAUSE[reason]) ?? '';
  }

  private load = async () => {
    let { realm, share: shareId } = this.opened;
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      if (!realm || !shareId) {
        throw new LinkError(
          'this page names no workspace and shared key',
          'This link doesn’t name a workspace and a shared key.',
        );
      }
      let context = await windowContext(config, { realm });
      if (!context.realm.directWriter) {
        this.page.state = { name: 'needs-admin', context };
        this.args.api.visit.loaded();
        return;
      }
      let share = (await realmShares(config, context.realm.url)).find(
        (s) => s.id === shareId,
      );
      if (!share) {
        throw new LinkError(
          'that workspace has no such shared key',
          'This shared key isn’t in that workspace. It may have been removed.',
        );
      }
      if (share.state === 'active') {
        this.page.state = { name: 'active', context, share };
        this.args.api.visit.loaded();
        return;
      }
      let keys = await listKeys(config);
      this.form.keys = keys;
      let offered = keys.find((k) => k.id === this.opened.key)?.id;
      this.form.selected =
        offered ?? (keys.length === 1 ? keys[0].id : undefined);
      this.page.state = { name: 'choosing', context, share };
      this.args.api.visit.loaded();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.page.state = {
          name: 'load-failed',
          failure: loadFailure(e),
        };
      }
    }
  };

  private get submitDisabled() {
    return this.form.saving || !this.form.selected;
  }

  private select = (selected: string) => {
    this.form.selected = selected;
    this.form.error = undefined;
  };

  private goToKeys = () => navigation.back(pageURL('keys'));

  private save = async (event: Event) => {
    event.preventDefault();
    let choosing = this.choosing;
    let keyId = this.form.selected;
    if (this.submitDisabled || !choosing || !keyId) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let share = await swapKey(this.args.api.config, {
        keyId,
        shareId: choosing.share.id,
      });
      this.page.state = {
        name: 'done',
        context: choosing.context,
        share,
        key: this.form.keys.find((k) => k.id === keyId)?.name ?? '',
      };
      let { cli } = cliOpenedFor();
      if (cli) {
        handToCli(cli, { window: 'done' });
      } else {
        this.args.api.close();
      }
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.form.error = failureMessage(e);
    } finally {
      this.form.saving = false;
    }
  };
}

export default class SwapKeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='swap-key' as |api|>
      <SwapKey @api={{api}} />
    </KeysWindow>
  </template>
}
