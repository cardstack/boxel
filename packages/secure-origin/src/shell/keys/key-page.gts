// The key page: the user's own keys, laid out as a linksToMany field is in a
// card's edit format: each key a tile saying which services it is used with
// and listing the workspaces it is shared with, each of which it can be
// unshared from, with Share and Replace on it and a delete button beside it,
// and buttons under them to add another or connect an account. An OAuth key
// says what it is and when it has stopped working; a connection is signed in
// again (Reconnect) rather than replaced, as its value is the service's to
// issue.
// It is what the secure origin shows at its own address and at `keys`.
// No key's value is ever shown, here or anywhere: a key is replaced, never
// read back. Removing a key first lists the shares it would suspend, and
// can't be confirmed until that list has loaded. A key list that fails to
// load says why and offers to try again, rather than reading as no keys.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  deleteKey,
  listKeys,
  replaceKey,
  sharesOfKey,
  unshare,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import RefreshCw from '../../components/icons/refresh-cw.gts';
import ShareIcon from '../../components/icons/share-2.gts';
import Trash from '../../components/icons/trash-2.gts';
import IconPlus from '../../components/icons/icon-plus.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { keySharePath } from '../pages.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type {
  KeyShare,
  KeyValue,
  ListedKey,
  SharedWorkspace,
  UserKey,
} from './context.ts';
import EditPage from './edit-page.gts';
import KeyFields from './key-fields.gts';
import KeyTile from './key-tile.gts';
import ServiceAccountDetails from './service-account-details.gts';
import { ServiceAccountEntry } from './service-account-entry.ts';
import ServiceAccountFields from './service-account-fields.gts';
import KeyUse from './key-use.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OAuthKeyStatus from './oauth-key-status.gts';

type Action =
  | { name: 'none' }
  | { name: 'replacing'; key: UserKey; shares: KeyShare[] | undefined }
  // `shares` is undefined until the list of shares the key is in has loaded.
  | { name: 'deleting'; key: UserKey; shares: KeyShare[] | undefined };

class Keys extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.state.loadFailed}}
      <LoadFailed
        @heading='Your keys'
        @failure={{this.state.loadFailed}}
        @onRetry={{this.retry}}
      />
    {{else}}
      <EditPage @heading='Your keys' data-test-key-page>
        <:intro>Keys you add here are encrypted, and nothing can read them back.
          Cards can send a key only to the places you approve for it.</:intro>
        <:default>
          {{#if this.state.error}}
            <div class='keys-error' role='alert' data-test-keys-error>
              {{this.state.error}}
            </div>
          {{/if}}
          {{#if this.state.loading}}
            <BusyMessage @title='Loading…' />
          {{else}}
            {{#if this.state.keys.length}}
              <ul class='list' data-test-key-list>
                {{#each this.state.keys key='id' as |key|}}
                  <li class='item' data-test-key-row={{key.name}}>
                    <div class='entry'>
                      <KeyTile @key={{key}}>
                        <KeyUse @key={{key}} @onUnshare={{this.unshare}}>
                          <OAuthKeyStatus
                            @key={{key}}
                            @onReconnect={{this.reconnect}}
                          />
                          <ServiceAccountDetails @key={{key}} />
                        </KeyUse>
                        <div class='tile-actions'>
                          {{#unless (eq key.kind 'oauth-connection')}}
                            <Button
                              class='action'
                              @kind='secondary'
                              @size='extra-small'
                              aria-describedby='key-name-{{key.id}}'
                              data-test-key-share
                              {{on 'click' (fn this.share key)}}
                            ><ShareIcon
                                class='action-icon'
                                aria-hidden='true'
                              />Share with Workspace</Button>
                            <Button
                              class='action'
                              @kind='secondary'
                              @size='extra-small'
                              aria-describedby='key-name-{{key.id}}'
                              data-test-key-replace
                              {{on 'click' (fn this.startReplace key)}}
                            ><RefreshCw
                                class='action-icon'
                                aria-hidden='true'
                              />Replace</Button>
                          {{/unless}}
                        </div>
                      </KeyTile>
                      {{#if (this.isActing 'replacing' key)}}
                        <form
                          class='panel'
                          novalidate
                          {{on 'submit' this.replace}}
                          data-test-key-replace-form
                        >
                          <p class='confirm' data-test-key-replace-where>
                            {{#if (eq this.replacingWorkspaces 1)}}
                              One workspace uses this key. Replacing it switches
                              that workspace to the new key right away, so make
                              sure the new key is right for that workspace.
                            {{else if this.replacingWorkspaces}}
                              {{this.replacingWorkspaces}}
                              workspaces use this key. Replacing it switches
                              them all to the new key right away, so make sure
                              all of these workspaces use the same key.
                            {{else if this.replacingSharesKnown}}
                              No workspace uses this key. Make sure the new key
                              is for the same service.
                            {{else}}
                              Replacing this key switches every workspace that
                              uses it to the new key right away, so make sure
                              all of them use the same key.
                            {{/if}}
                          </p>
                          {{#if (this.isServiceAccount key)}}
                            {{#if key.serviceAccount}}
                              <p
                                class='confirm'
                                data-test-service-account-replace-note
                              >Choose the new key file.
                                <strong>Act as</strong>
                                and
                                <strong>Scopes</strong>
                                start as the key has them now: the replacement
                                keeps them as you leave them here.</p>
                            {{else}}
                              <p
                                class='confirm'
                                data-test-service-account-replace-note
                              >A replacement sets the key file, the scopes and
                                who it acts as all anew. Enter the scopes again,
                                and leave
                                <strong>Act as</strong>
                                empty only if it should act as the service
                                account itself.</p>
                            {{/if}}
                            <ServiceAccountFields
                              @entry={{this.serviceAccount}}
                            />
                            {{#if this.accountChange}}
                              <p
                                class='confirm'
                                role='status'
                                data-test-service-account-changed
                              >This key file is for
                                <strong>{{this.accountChange.to}}</strong>, not
                                <strong>{{this.accountChange.from}}</strong>.
                                Delegation and scopes are granted per service
                                account, so check
                                <strong>Act as</strong>
                                and
                                <strong>Scopes</strong>
                                for the new one.</p>
                            {{/if}}
                          {{else}}
                            <KeyFields
                              @value={{this.form.value}}
                              @onValue={{this.setValue}}
                            />
                          {{/if}}
                          <div class='panel-actions'>
                            <Button
                              type='button'
                              @kind='secondary'
                              @size='small'
                              {{on 'click' this.cancel}}
                            >Cancel</Button>
                            <Button
                              type='submit'
                              @kind='primary'
                              @size='small'
                              @disabled={{this.replaceDisabled}}
                              @loading={{this.form.saving}}
                              data-test-key-replace-save
                            >Replace key</Button>
                          </div>
                        </form>
                      {{else if (this.isActing 'deleting' key)}}
                        <div class='panel' data-test-key-delete-confirm>
                          {{#if this.loadingShares}}
                            <p class='confirm' data-test-key-delete-loading>
                              Checking where
                              <strong>{{key.name}}</strong>
                              is shared…
                            </p>
                          {{else if this.deletingShares.length}}
                            <p class='confirm'>Deleting
                              <strong>{{key.name}}</strong>
                              is permanent, and stops it working in the
                              workspaces it’s shared with:</p>
                            <ul class='shares' data-test-key-delete-shares>
                              {{#each this.deletingShares as |share|}}
                                <li>{{share.label}}
                                  <span
                                    class='share-realm'
                                  >{{share.realm}}</span></li>
                              {{/each}}
                            </ul>
                            <p class='confirm'>Someone with direct write access
                              to one of them can put their own key in its place.</p>
                          {{else}}
                            <p class='confirm'>Delete
                              <strong>{{key.name}}</strong>? This is permanent.
                              It isn’t shared with any workspace. Requests that
                              use it stop working.</p>
                          {{/if}}
                          <div class='panel-actions'>
                            <Button
                              type='button'
                              @kind='secondary'
                              @size='small'
                              {{on 'click' this.cancel}}
                            >Cancel</Button>
                            <Button
                              type='button'
                              @kind='destructive'
                              @size='small'
                              @disabled={{this.loadingShares}}
                              @loading={{this.form.saving}}
                              data-test-key-delete-confirm-button
                              {{on 'click' this.delete}}
                            >Delete key</Button>
                          </div>
                        </div>
                      {{/if}}
                    </div>
                    <button
                      type='button'
                      class='remove'
                      aria-label='Delete {{key.name}}'
                      data-test-key-delete
                      {{on 'click' (fn this.startDelete key)}}
                    ><Trash
                        width='18'
                        height='18'
                        aria-hidden='true'
                      /></button>
                  </li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty' data-test-key-list-empty>You haven’t added any
                keys.</p>
            {{/if}}
            <div class='add-actions'>
              <Button
                class='add-new'
                @kind='secondary'
                @size='tall'
                @rectangular={{true}}
                data-test-key-page-add
                {{on 'click' this.add}}
              ><IconPlus
                  class='plus'
                  width='12px'
                  height='12px'
                  role='presentation'
                />Add a key</Button>
              <Button
                class='add-new'
                @kind='secondary'
                @size='tall'
                @rectangular={{true}}
                data-test-key-page-connect
                {{on 'click' this.connect}}
              ><IconPlus
                  class='plus'
                  width='12px'
                  height='12px'
                  role='presentation'
                />Connect an account</Button>
            </div>
          {{/if}}
        </:default>
      </EditPage>
    {{/if}}

    <style scoped>
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp);
      }
      .item {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--boxel-sp-xs);
        align-items: start;
      }
      .remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--boxel-icon-lg);
        height: 4rem;
        padding: 0;
        border: 0;
        border-radius: var(--boxel-border-radius);
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .remove:focus-visible,
      .remove:hover {
        color: var(--destructive, var(--boxel-danger));
      }
      .remove:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
      }
      .action {
        gap: var(--boxel-sp-5xs, 0.25rem);
      }
      .action-icon {
        width: 0.75rem;
        height: 0.75rem;
      }
      .tile-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--boxel-sp-4xs);
        margin-top: var(--boxel-sp-xs);
      }
      .entry {
        display: grid;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .panel {
        display: grid;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
      }
      .panel-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
      }
      .confirm {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .shares {
        margin: 0;
        padding-inline-start: var(--boxel-sp-lg);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .share-realm {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
      }
      .empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .add-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .add-new {
        gap: var(--boxel-sp-3xs);
        width: fit-content;
      }
      .plus {
        --icon-color: currentColor;
      }
    </style>
  </template>

  private state = trackedObject({
    loading: true,
    keys: [] as ListedKey[],
    error: undefined as string | undefined,
    // What went wrong when the key list didn't load.
    loadFailed: undefined as LoadFailure | undefined,
    action: { name: 'none' } as Action,
  });
  private form = trackedObject({ value: '', saving: false });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  // Runs a request, answering whether it succeeded; a failure says why on the
  // page, and a session that has ended stops the window.
  private async guard(work: () => Promise<void>): Promise<boolean> {
    this.state.error = undefined;
    try {
      await work();
      return true;
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.state.error = failureMessage(e);
      }
      return false;
    }
  }

  private async load() {
    try {
      this.state.keys = await listKeys(this.args.api.config);
      this.args.api.visit.loaded();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.state.loadFailed = loadFailure(e);
      }
    }
    this.state.loading = false;
  }

  private retry = () => {
    this.state.loadFailed = undefined;
    this.state.loading = true;
    this.load();
  };

  private isActing = (name: Action['name'], key: UserKey) =>
    this.state.action.name === name &&
    'key' in this.state.action &&
    this.state.action.key.id === key.id;

  private get loadingShares() {
    let action = this.state.action;
    return action.name === 'deleting' && action.shares === undefined;
  }

  private get deletingShares() {
    let action = this.state.action;
    return action.name === 'deleting' ? action.shares : undefined;
  }

  // A service account is replaced with a whole new key file, subject and
  // scopes; any other key with a new value.
  private serviceAccount = new ServiceAccountEntry();

  private isServiceAccount = (key: UserKey) =>
    key.kind === 'google-service-account';

  private get replacement(): KeyValue | undefined {
    let action = this.state.action;
    if (action.name !== 'replacing') {
      return undefined;
    }
    if (this.isServiceAccount(action.key)) {
      return this.serviceAccount.value;
    }
    return this.form.value
      ? { kind: 'static', value: this.form.value }
      : undefined;
  }

  // The service account a chosen key file is for, when it isn't the one the
  // key is now: the prefilled Act as and Scopes were granted to the old one,
  // so the panel says so.
  private get accountChange(): { from: string; to: string } | undefined {
    let action = this.state.action;
    let from =
      action.name === 'replacing'
        ? action.key.serviceAccount?.email
        : undefined;
    let to = this.serviceAccount.clientEmail;
    return from && to && from !== to ? { from, to } : undefined;
  }

  private get replaceDisabled() {
    return this.form.saving || !this.replacement;
  }

  private add = () => navigation.assign(pageURL('keys/add'));

  private connect = () => navigation.assign(pageURL('connect'));

  // Signing a connection in again is made on the connect page, which names
  // it in its fragment.
  private reconnect = (key: UserKey) =>
    navigation.assign(
      `${pageURL('connect')}#${new URLSearchParams({ reconnect: key.id })}`,
    );

  // Sharing a key into a realm is a change of its own, made on the share
  // page, which asks which realm.
  private share = (key: UserKey) =>
    navigation.assign(pageURL(keySharePath(key.id)));

  private setValue = (value: string) => {
    this.form.value = value;
  };

  private cancel = () => {
    this.form.value = '';
    this.serviceAccount.clear();
    this.state.action = { name: 'none' };
  };

  // Replacing changes the key that every workspace it's shared with uses, so
  // the panel says how many. If the shares can't be listed, it says so in
  // general terms instead, and the replace is still offered. A service
  // account's form starts from the user it acts as and the scopes it asks for
  // now; its key file is always chosen anew.
  private startReplace = async (key: UserKey) => {
    this.form.value = '';
    if (key.serviceAccount) {
      this.serviceAccount.prefill(key.serviceAccount);
    } else {
      this.serviceAccount.clear();
    }
    this.state.action = { name: 'replacing', key, shares: undefined };
    let shares: KeyShare[] | undefined;
    try {
      shares = await sharesOfKey(this.args.api.config, key.id);
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
    }
    if (this.isActing('replacing', key) && shares) {
      this.state.action = { name: 'replacing', key, shares };
    }
  };

  private get replacingShares(): KeyShare[] | undefined {
    let action = this.state.action;
    return action.name === 'replacing' ? action.shares : undefined;
  }

  private get replacingSharesKnown(): boolean {
    return this.replacingShares !== undefined;
  }

  // The number of workspaces the key is shared with.
  private get replacingWorkspaces(): number {
    return new Set(this.replacingShares?.map((share) => share.realm)).size;
  }

  // A delete can't be confirmed until the page knows which shares it
  // suspends; if it can't find out, it offers no delete.
  private startDelete = async (key: UserKey) => {
    this.state.action = { name: 'deleting', key, shares: undefined };
    let shares: KeyShare[] = [];
    let loaded = await this.guard(async () => {
      shares = await sharesOfKey(this.args.api.config, key.id);
    });
    if (!this.isActing('deleting', key)) {
      return;
    }
    this.state.action = loaded
      ? { name: 'deleting', key, shares }
      : { name: 'none' };
  };

  // Takes the key out of one workspace: every one of its shares there, which
  // needs no ticket since a key's owner may always withdraw it. The key stays
  // shared everywhere else, and the list is read again to show it.
  private unshare = async (
    _key: ListedKey,
    workspace: SharedWorkspace,
  ): Promise<boolean> => {
    let removed = 0;
    let unshared = await this.guard(async () => {
      for (let share of workspace.shares) {
        await unshare(this.args.api.config, share.id);
        removed++;
      }
    });
    // Read the list again once any share is gone, even when a later one was
    // refused, so the page never offers to remove a share that no longer
    // exists. A refusal stays shown, as the load leaves it.
    if (removed > 0) {
      await this.load();
    }
    return unshared;
  };

  private replace = async (event: Event) => {
    event.preventDefault();
    let action = this.state.action;
    let entered = this.replacement;
    if (this.replaceDisabled || action.name !== 'replacing' || !entered) {
      return;
    }
    this.form.saving = true;
    let replaced = await this.guard(async () => {
      await replaceKey(this.args.api.config, {
        keyId: action.key.id,
        entered,
      });
    });
    this.form.saving = false;
    if (replaced) {
      this.form.value = '';
      this.serviceAccount.clear();
      this.state.action = { name: 'none' };
      await this.load();
    }
  };

  private delete = async () => {
    let action = this.state.action;
    if (action.name !== 'deleting' || action.shares === undefined) {
      return;
    }
    this.form.saving = true;
    let deleted = await this.guard(async () => {
      await deleteKey(this.args.api.config, { keyId: action.key.id });
    });
    this.form.saving = false;
    if (deleted) {
      this.state.action = { name: 'none' };
      await this.load();
    }
  };
}

export default class KeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='keys' as |api|>
      <Keys @api={{api}} />
    </KeysWindow>
  </template>
}
