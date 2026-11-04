// The key page: the user's own keys, laid out as a linksToMany field is in a
// card's edit format: each key a tile saying which services it is used with
// and listing the workspaces it is shared with, each of which it can be
// unshared from, with Share and Replace on it and a delete button beside it,
// and buttons under them to add another or connect an account. An OAuth key
// says what it is and when it has stopped working; a connection is signed in
// again (Reconnect) rather than replaced, as its value is the service's to
// issue.
// Each key also lists where it may be sent, its grants, with the approvals
// that send it there; removing a grant lists those first, then revokes them.
// Use with a card sets a key up for a card's requests ahead of the card
// asking, on the approve page. Usage and limits opens what the key spent
// against its budgets, who used it and how, and its limits, which the owner
// changes there.
// Above the keys, where a share's or key's use reached its high-water mark or
// its budget this day or month, each with what to do about it (see
// `key-limit-notices.gts`), and what workspaces' policies did with the user's
// shared keys. Listing them marks them read, which clears the app's badge.
// Each key that can be shared says whether people who aren't signed in can
// use it, with its optional daily and monthly anonymous caps, and Change
// opens a panel to turn that on or off and set the caps. It is the key's own
// setting, its owner's decision whatever workspaces it is shared into; a
// workspace's policy says only whether such people can use its cards there.
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
  listBindings,
  declinePolicyNotice,
  limitNotices,
  listKeys,
  markLimitNoticesRead,
  markPolicyNoticesRead,
  policyNotices,
  removeGrant,
  replaceKey,
  setAnonymousUse,
  sharesOfKey,
  unshare,
  type KeyBinding,
  type KeyGrant,
  type KeyLimitNotice,
  type KeyPolicyNotice,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import RefreshCw from '../../components/icons/refresh-cw.gts';
import ShareIcon from '../../components/icons/share-2.gts';
import Trash from '../../components/icons/trash-2.gts';
import IconPlus from '../../components/icons/icon-plus.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { keySharePath, keyUsePath } from '../pages.js';
import { pageURL } from '../urls.js';

import AnonymousUseFields, {
  anonymousCapOf,
  servesVisitors,
} from './anonymous-use-fields.gts';
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
import KeyGrants from './key-grants.gts';
import KeyLimitNotices from './key-limit-notices.gts';
import KeyPolicyNotices from './key-policy-notices.gts';
import KeyTile from './key-tile.gts';
import ServiceAccountDetails from './service-account-details.gts';
import { ServiceAccountEntry } from './service-account-entry.ts';
import ServiceAccountFields, {
  type ServiceAccountReplacing,
} from './service-account-fields.gts';
import KeyUse from './key-use.gts';
import KeyUsagePanel from './key-usage-panel.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OAuthKeyStatus from './oauth-key-status.gts';

type Action =
  | { name: 'none' }
  | { name: 'replacing'; key: UserKey; shares: KeyShare[] | undefined }
  // Changing whether people who aren't signed in can use the key.
  | { name: 'anonymous-use'; key: UserKey }
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
            <KeyLimitNotices
              @notices={{this.state.limitNotices}}
              @showsKeyUsage={{this.showsKeyUsage}}
              @onOpenKeyUsage={{this.showKeyUsage}}
              @onOpenShareUsage={{this.openShareUsage}}
            />
            <KeyPolicyNotices
              @notices={{this.state.notices}}
              @keys={{this.state.keys}}
              @onAllow={{this.startAllowingAnonymousUse}}
              @onDecline={{this.declineRequest}}
              @declining={{this.state.declining}}
            />
            {{#if this.state.keys.length}}
              <ul class='list' data-test-key-list>
                {{#each this.state.keys key='id' as |key|}}
                  <li class='item' data-test-key-row={{key.name}}>
                    <div class='entry'>
                      <KeyTile @key={{key}}>
                        <KeyUse
                          @key={{key}}
                          @onUnshare={{this.unshare}}
                          @onChangeAnonymousUse={{if
                            (this.servesVisitors key)
                            this.startAnonymousUse
                          }}
                        >
                          <OAuthKeyStatus
                            @key={{key}}
                            @onReconnect={{this.reconnect}}
                          />
                          <ServiceAccountDetails @key={{key}} />
                        </KeyUse>
                        <KeyGrants
                          @key={{key}}
                          @bindings={{this.state.bindings}}
                          @onRemove={{this.removeGrant}}
                        />
                        {{#if (this.hasUsage key)}}
                          <KeyUsagePanel
                            @key={{key}}
                            @api={{@api}}
                            @onRegister={{this.registerUsagePanel}}
                          />
                        {{/if}}
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
                          {{#if (this.usableWithCard key)}}
                            <Button
                              class='action'
                              @kind='secondary'
                              @size='extra-small'
                              aria-describedby='key-name-{{key.id}}'
                              data-test-key-use
                              {{on 'click' (fn this.useWithCard key)}}
                            >Use with a card…</Button>
                          {{/if}}
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
                            <ServiceAccountFields
                              @entry={{this.serviceAccount}}
                              @replacing={{this.serviceAccountReplacing}}
                            />
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
                      {{else if (this.isActing 'anonymous-use' key)}}
                        <form
                          class='panel'
                          novalidate
                          {{on 'submit' this.saveAnonymousUse}}
                          data-anonymous-use-panel
                          data-test-key-anonymous-use-form
                        >
                          <AnonymousUseFields
                            @anonymous={{this.form.anonymous}}
                            @cap={{this.form.cap}}
                            @monthlyCap={{this.form.monthlyCap}}
                            @agreement='Allow people who aren’t signed in to use this key'
                            @note='Only where a workspace you share it into lets them use its cards. Their calls are made with your key and count against your quota.'
                            @onToggle={{this.toggleAnonymous}}
                            @onCap={{this.setCap}}
                            @onMonthlyCap={{this.setMonthlyCap}}
                          />
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
                              @disabled={{this.anonymousUseDisabled}}
                              @loading={{this.form.saving}}
                              data-test-key-anonymous-use-save
                            >Save</Button>
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
    // The user's approvals, each under one of their keys' grants.
    bindings: undefined as KeyBinding[] | undefined,
    // What workspaces' policies opened the user's shares to people who aren't
    // signed in. Empty when there are none, or when they can't be read.
    notices: [] as KeyPolicyNotice[],
    // Where the user's shares and keys reached a limit this day or month.
    // Empty when there are none, or when they can't be read.
    limitNotices: [] as KeyLimitNotice[],
    // The request being declined, while it is.
    declining: undefined as string | undefined,
    error: undefined as string | undefined,
    // What went wrong when the key list didn't load.
    loadFailed: undefined as LoadFailure | undefined,
    action: { name: 'none' } as Action,
  });
  private form = trackedObject({
    value: '',
    // Whether people who aren't signed in may use the key, and its anonymous
    // caps as typed, while changing them.
    anonymous: false,
    cap: '',
    monthlyCap: '',
    saving: false,
  });

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
      this.state.bindings = await this.readBindings();
      this.state.notices = await this.readNotices();
      this.state.limitNotices = await this.readLimitNotices();
      this.args.api.visit.loaded();
      this.markNoticesRead();
      this.markLimitNoticesRead();
      this.openAnonymousUseFromFragment();
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

  // A service account being replaced, as its fields describe it: the listing
  // carries its details, and the form starts from them whenever it does.
  private get serviceAccountReplacing(): ServiceAccountReplacing | undefined {
    let action = this.state.action;
    if (action.name !== 'replacing') {
      return undefined;
    }
    let current = action.key.serviceAccount;
    return { current, prefilled: Boolean(current) };
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

  // A key a card's request can send: any but an OAuth app people sign in
  // through, which only connects accounts.
  // An OAuth client is never sent anywhere itself, so it has no use to show
  // and no limits to set; its connections do.
  // Every key but an OAuth app that signs people in: one that signs in as
  // itself (`client_credentials`) is sent as a key, so it is counted.
  private hasUsage = (key: ListedKey) =>
    key.kind !== 'oauth-client' ||
    key.oauth?.client?.grantType === 'client_credentials';

  private usableWithCard = (key: ListedKey) =>
    key.kind !== 'oauth-client' ||
    key.oauth?.client?.grantType === 'client_credentials';

  // Setting a key up for a card's requests is made on its own page, which
  // asks which workspace and card, then approves them.
  private useWithCard = (key: UserKey) =>
    navigation.assign(pageURL(keyUsePath(key.id)));

  // Removing a grant revokes the approvals that send under it, so both lists
  // are read again.
  private removeGrant = async (grant: KeyGrant) =>
    await this.guard(async () => {
      await removeGrant(this.args.api.config, grant.id);
      this.state.keys = await listKeys(this.args.api.config);
      this.state.bindings = await this.readBindings();
    });

  // The approvals each grant is used by. The keys are the page; when these
  // can't be read, each grant is listed without them, and removing one says
  // it revokes whatever uses it.
  private readBindings = async (): Promise<KeyBinding[] | undefined> => {
    try {
      return await listBindings(this.args.api.config);
    } catch (e) {
      if (isSignedOut(e)) {
        throw e;
      }
      return undefined;
    }
  };

  // The keys are the page; notices that can't be read are left out.
  private readNotices = async (): Promise<KeyPolicyNotice[]> => {
    try {
      return await policyNotices(this.args.api.config);
    } catch (e) {
      if (isSignedOut(e)) {
        throw e;
      }
      return [];
    }
  };

  // The notices this page lists have been seen, so the app's badge for them
  // clears. One that can't be marked stays unread and is marked the next time
  // the page lists it.
  private markNoticesRead() {
    let unread = this.state.notices
      .filter((notice) => !notice.readAt)
      .map((notice) => notice.id);
    if (unread.length === 0) {
      return;
    }
    markPolicyNoticesRead(this.args.api.config, unread).catch((e) => {
      console.warn(`Could not mark the key notices read: ${e}`);
    });
  }

  // The keys are the page; limit notices that can't be read are left out.
  private readLimitNotices = async (): Promise<KeyLimitNotice[]> => {
    try {
      return await limitNotices(this.args.api.config);
    } catch (e) {
      if (isSignedOut(e)) {
        throw e;
      }
      return [];
    }
  };

  // As for policy notices: what this page lists has been seen.
  private markLimitNoticesRead() {
    let unread = this.state.limitNotices
      .filter((notice) => !notice.readAt)
      .map((notice) => notice.id);
    if (unread.length === 0) {
      return;
    }
    markLimitNoticesRead(this.args.api.config, unread).catch((e) => {
      console.warn(`Could not mark the key limit notices read: ${e}`);
    });
  }

  // Each key's usage panel, by key id, so a limit notice about the key can
  // open it.
  private usagePanels = new Map<string, () => void>();

  private registerUsagePanel = (
    keyId: string,
    show: (() => void) | undefined,
  ) => {
    if (show) {
      this.usagePanels.set(keyId, show);
    } else {
      this.usagePanels.delete(keyId);
    }
  };

  // Whether the page shows this key's usage and limits on its tile.
  private showsKeyUsage = (keyId: string) => {
    let key = this.state.keys.find((candidate) => candidate.id === keyId);
    return !!key && this.hasUsage(key);
  };

  // A personal key's usage and limits are on its own tile.
  private showKeyUsage = (keyId: string) => {
    this.usagePanels.get(keyId)?.();
  };

  // A share's usage and limits are on the share's own page, where its key's
  // owner changes them and anyone else is told who can. It comes back to this
  // page when it is done.
  private openShareUsage = (notice: KeyLimitNotice) => {
    if (!notice.realm || !notice.share) {
      return;
    }
    navigation.assign(
      `${pageURL('share-limits')}#${new URLSearchParams({
        realm: notice.realm,
        share: notice.share,
        then: 'keys',
      })}`,
    );
  };

  // Declining a workspace's request leaves the key as it is; the request
  // isn't shown again.
  private declineRequest = async (notice: KeyPolicyNotice) => {
    this.state.declining = notice.id;
    try {
      await this.guard(async () => {
        await declinePolicyNotice(this.args.api.config, notice.id);
        this.state.notices = await this.readNotices();
      });
    } finally {
      this.state.declining = undefined;
    }
  };

  // `keys#anonymous=<key id>` opens that key's setting for people who aren't
  // signed in, which is where a workspace that wants them to use a key sends
  // its owner.
  private openAnonymousUseFromFragment() {
    let keyId = new URLSearchParams(window.location.hash.slice(1)).get(
      'anonymous',
    );
    let key = keyId
      ? this.state.keys.find((candidate) => candidate.id === keyId)
      : undefined;
    if (key && servesVisitors(key)) {
      this.startAllowingAnonymousUse(key);
    }
  }

  // A key that can be shared: any but a connection, which is its owner's own
  // sign-in.

  private servesVisitors = (key: ListedKey) => servesVisitors(key);

  // The panel starts from the key's setting as the listing gives it.
  private startAnonymousUse = (key: ListedKey) => {
    this.form.anonymous = key.anonymous;
    this.form.cap =
      key.anonymousDailyCap == null ? '' : String(key.anonymousDailyCap);
    this.form.monthlyCap =
      key.anonymousMonthlyCap == null ? '' : String(key.anonymousMonthlyCap);
    this.state.error = undefined;
    this.state.action = { name: 'anonymous-use', key };
  };

  // Opened to answer a workspace's request, the panel starts allowing it, so
  // one Save finishes it and Cancel changes nothing.
  // The panel opens beside the key, which can be far down the page from the
  // request, so it is brought into view.
  private startAllowingAnonymousUse = (key: ListedKey) => {
    this.startAnonymousUse(key);
    this.form.anonymous = true;
    requestAnimationFrame(() =>
      document
        .querySelector('[data-anonymous-use-panel]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };

  private toggleAnonymous = () => {
    this.form.anonymous = !this.form.anonymous;
  };

  private setCap = (value: string) => {
    this.form.cap = value;
  };

  private setMonthlyCap = (value: string) => {
    this.form.monthlyCap = value;
  };

  private get anonymousCap() {
    return anonymousCapOf(this.form.anonymous, this.form.cap);
  }

  private get anonymousMonthlyCap() {
    return anonymousCapOf(this.form.anonymous, this.form.monthlyCap);
  }

  private get anonymousUseDisabled() {
    return (
      this.form.saving ||
      this.anonymousCap === undefined ||
      this.anonymousMonthlyCap === undefined
    );
  }

  private saveAnonymousUse = async (event: Event) => {
    event.preventDefault();
    let action = this.state.action;
    let cap = this.anonymousCap;
    let monthlyCap = this.anonymousMonthlyCap;
    if (
      this.anonymousUseDisabled ||
      action.name !== 'anonymous-use' ||
      cap === undefined ||
      monthlyCap === undefined
    ) {
      return;
    }
    this.form.saving = true;
    let saved = await this.guard(async () => {
      await setAnonymousUse(this.args.api.config, {
        keyId: action.key.id,
        anonymous: this.form.anonymous,
        anonymousDailyCap: cap,
        anonymousMonthlyCap: monthlyCap,
      });
    });
    this.form.saving = false;
    if (saved) {
      this.state.action = { name: 'none' };
      await this.load();
    }
  };

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
    this.serviceAccount.clear();
    if (key.serviceAccount) {
      this.serviceAccount.prefill(key.serviceAccount);
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
