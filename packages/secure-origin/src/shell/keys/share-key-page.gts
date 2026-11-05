// The `share-key` page: one of the user's existing keys put into a realm under
// a label the realm's people see, so that others there can use it through the
// operations approved for it. Sharing is its own change, apart from adding a
// key: this page never takes a key's value.
//
// It is reached two ways. From the key page, for one key (at
// `keys/<key id>/share`, or `share-key#key=<id>`), it asks which realm,
// offering those the user is a direct writer of. Opened for a realm
// (`#realm=<realm>`), it asks which of the user's keys; only a direct writer
// of that realm may share into it, and anyone else is told an administrator
// needs to set it up, with nothing to enter.
//
// The page makes no choice about who can use the key. Whether people who
// aren't signed in may use a key is its owner's decision about the key itself,
// made when adding it or on the key page; whether they can use it in a
// workspace is that workspace's policy's to say. They are served only where
// both allow it, and the page reflects the two, reading one of three ways:
//
// - Where the policy lets only signed-in people make a call that sends a
//   shared key (`realm.opensToAnonymous` false in the window's context), the
//   intro says only signed-in people can use it, and nothing more is said of
//   anyone else.
// - Where the policy lets people who aren't signed in make such a call,
//   sharing a key there means they will use it, and the intro bolds that they
//   will. A chosen key that allows them is shared as any other, with a line
//   saying the key allows it, with its anonymous cap, and that sharing it here
//   means they will use it.
// - Where the policy lets them and the chosen key doesn't allow them, the key
//   can't be shared there: the line says so and points to the key page, where
//   its owner allows it, and Share key stays disabled. The realm server
//   refuses such a share too.
//
// Choosing another key or workspace reads the page again.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  listKeys,
  shareKey,
  windowContext,
  writableRealms,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import Tag from '../../components/icons/tag.gts';
import Users from '../../components/icons/users.gts';
import BoxelInput from '../../components/input.gts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';
import { keyPageURL, pageTitle, withWayBack } from './trail.ts';

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
import { servesVisitors } from './anonymous-use-fields.gts';
import KeyPicker from './key-picker.gts';
import KeyTile from './key-tile.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import NeedsAdmin from './needs-admin.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { openedForShare } from './opened-for.ts';
import WorkspaceDropdown, { addressOf } from './workspace-dropdown.gts';
import { anonymousCapsClause } from './anonymous-caps.ts';

interface Realm {
  url: string;
  name: string;
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'needs-admin'; realm: WindowContext['realm'] }
  // `key` is the key the page was opened for, if any, and `context` the
  // realm's, if it was opened for one; the other is chosen here.
  | {
      name: 'choosing';
      key?: UserKey;
      context?: WindowContext;
    }
  // `anonymous` is whether people who aren't signed in will use the key in
  // the realm, with the key's anonymous cap.
  | {
      name: 'done';
      realm: string;
      share: KeyShare;
      key: string;
      anonymous: boolean;
      anonymousDailyCap: number | null;
      anonymousMonthlyCap: number | null;
    };

interface ShareKeyArgs {
  api: KeysWindowAPI;
  // The key to share, when the router names it from the page's path.
  keyId?: string;
}

class ShareKey extends Component<{ Args: ShareKeyArgs }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading={{this.title}}
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.needsAdmin}}
      <NeedsAdmin @realm={{this.needsAdmin.realm}} />
    {{else if this.done}}
      <DonePage @heading='Key shared' @onClose={{this.finish}}>
        <strong>{{this.done.key}}</strong>
        is shared with
        <strong>{{this.done.realm}}</strong>
        as
        <strong data-test-keys-done-label>{{this.done.share.label}}</strong>.
        {{#if this.done.anonymous}}
          <strong data-test-share-key-done-anonymous>People who aren’t signed in
            will use it too</strong>{{anonymousCapsClause this.done}}.
        {{/if}}
      </DonePage>
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.save}} data-test-share-key-form>
        <EditPage @heading={{this.title}} data-test-share-key>
          <:intro>
            {{#if this.forAnyone}}
              <span data-test-share-key-intro='anyone'>People who can access the
                workspace can use the key in their requests,
                <strong>and so will people who aren’t signed in</strong>: this
                workspace lets anyone who opens its cards make calls with a
                shared key. Nobody sees the key itself. Requests made by anyone
                who opens those cards will consume your quota and/or be billed
                against your account with this service provider.</span>
            {{else}}
              <span data-test-share-key-intro='signed-in'>People who can access
                the workspace can use the key in their requests. They never see
                the key itself.
                <strong>Only signed-in people</strong>
                with access to this workspace can use it. People who aren’t
                signed in can’t. Requests made by people who have access to this
                workspace will consume your quota and/or be billed against your
                account with this service provider.</span>
            {{/if}}
          </:intro>
          <:default>
            {{#if this.choosing.context}}
              <OpenedForSummary
                @context={{this.choosing.context}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            {{#if this.choosing.key}}
              <FieldContainer
                @tag='div'
                @label='Key'
                @icon={{KeyRound}}
                data-test-share-key-key
              >
                <KeyTile @key={{this.choosing.key}} />
              </FieldContainer>
            {{else}}
              <KeyPicker
                @keys={{this.form.keys}}
                @selected={{this.form.key}}
                @onSelect={{this.selectKey}}
                @onGoToKeys={{this.goToKeys}}
              />
            {{/if}}
            {{#unless this.choosing.context}}
              <FieldContainer
                @tag='div'
                @label='Workspace'
                @icon={{LayoutGrid}}
                data-test-realm-picker
                as |labelId|
              >
                <WorkspaceDropdown
                  @workspaces={{this.form.realms}}
                  @selected={{this.form.realm}}
                  @onSelect={{this.selectRealm}}
                  @labelId={{labelId}}
                />
              </FieldContainer>
            {{/unless}}
            <FieldContainer
              @tag='label'
              @label='Shared as'
              @icon={{Tag}}
              data-test-key-field='label'
            >
              <BoxelInput
                @type='text'
                @autocomplete='off'
                @placeholder='What people with access to the workspace see it as'
                @value={{this.form.label}}
                @onInput={{this.setLabel}}
                name='share-label'
                data-test-share-label
              />
            </FieldContainer>
            {{#if this.policyUnknown}}
              {{! Asked of the workspace just chosen: which reading applies. }}
            {{else if this.keyAllowsAnonymous}}
              <FieldContainer
                @tag='div'
                @label='People who aren’t signed in'
                @icon={{Users}}
                data-test-share-key-key-allows
              >
                <p class='allows' data-test-share-key-key-allows-text>This key
                  allows it{{anonymousCapsClause this.chosenKey}}. Sharing it
                  here means they will use it.</p>
              </FieldContainer>
            {{else if this.keyRefusesAnonymous}}
              <FieldContainer
                @tag='div'
                @label='People who aren’t signed in'
                @icon={{Users}}
                data-test-share-key-key-refuses
              >
                <div class='refuses'>
                  <p class='allows' data-test-share-key-key-refuses-text>This
                    workspace lets people who aren’t signed in use the keys
                    shared into it, and this key doesn’t allow them. Allow it on
                    your key page first.</p>
                  <Button
                    type='button'
                    @kind='secondary'
                    @size='small'
                    data-test-share-key-go-to-key
                    {{on 'click' this.goToKeys}}
                  >Go to your keys</Button>
                </div>
              </FieldContainer>
            {{/if}}
            {{#if this.form.error}}
              <div class='keys-error' role='alert' data-test-keys-error>
                {{this.form.error}}
              </div>
            {{/if}}
          </:default>
          <:actions>
            {{#if this.fromKeyPage}}
              <Button
                type='button'
                @kind='secondary'
                data-test-share-key-cancel
                {{on 'click' this.goToKeys}}
              >Cancel</Button>
            {{/if}}
            <Button
              type='submit'
              @kind='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.form.saving}}
              data-test-share-key-save
            >Share key</Button>
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
      .refuses {
        display: grid;
        gap: var(--boxel-sp-xs);
        justify-items: start;
      }
      .allows {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
    </style>
  </template>

  private opened = openedForShare(this.args.keyId);
  // Reached from the key page for one of its keys, rather than opened for a
  // realm by a page elsewhere.
  private fromKeyPage = Boolean(this.opened.key && !this.opened.realm);

  private title = pageTitle('share-key');
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    keys: [] as UserKey[],
    realms: [] as Realm[],
    key: undefined as string | undefined,
    realm: undefined as string | undefined,
    label: '',
    // Whether the label was typed rather than filled in from the key's name.
    labelTyped: false,
    // Whether the chosen realm's policy opens a call that sends a shared key
    // to people who aren't signed in; undefined while it's being asked.
    opensToAnonymous: undefined as boolean | undefined,
    saving: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: ShareKeyArgs) {
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
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private load = async () => {
    let { realm, key: keyId } = this.opened;
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      if (!realm && !keyId) {
        throw new LinkError(
          'this page names neither a key nor a workspace',
          'This link doesn’t name a key or a workspace to share it with.',
        );
      }
      let context: WindowContext | undefined;
      if (realm) {
        context = await windowContext(config, { realm });
        if (!context.realm.directWriter) {
          this.page.state = { name: 'needs-admin', realm: context.realm };
          this.args.api.visit.loaded();
          return;
        }
        this.form.realm = context.realm.url;
        this.setOpensToAnonymous(context.realm.opensToAnonymous);
      } else {
        this.form.realms = await writableRealms(config);
        if (this.form.realms.length === 1) {
          this.selectRealm(this.form.realms[0].url);
        }
      }
      let keys = await listKeys(config);
      this.form.keys = keys;
      let key: UserKey | undefined;
      if (keyId) {
        key = keys.find((k) => k.id === keyId);
        if (!key) {
          throw new LinkError(
            'the key this page names isn’t one of your keys',
            'This key isn’t one of yours. It may have been deleted.',
          );
        }
        this.selectKey(key.id);
      } else if (keys.length === 1) {
        this.selectKey(keys[0].id);
      }
      this.page.state = { name: 'choosing', key, context };
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
    return (
      this.form.saving ||
      !this.form.key ||
      !this.form.realm ||
      !this.form.label.trim() ||
      this.form.opensToAnonymous === undefined ||
      this.keyRefusesAnonymous
    );
  }

  private get opensToAnonymous() {
    return this.form.opensToAnonymous === true;
  }

  // The intro tells of people who aren't signed in where the policy lets them
  // use a shared key: sharing a key there means they will use it, and only a
  // key whose owner allows it on the key is shared there.
  private get forAnyone() {
    let key = this.chosenKey;
    return this.opensToAnonymous && (!key || servesVisitors(key));
  }

  private get chosenKey(): UserKey | undefined {
    return this.form.keys.find((k) => k.id === this.form.key);
  }

  // Where the policy lets people who aren't signed in use a shared key, and
  // the chosen key allows them.
  private get keyAllowsAnonymous() {
    let key = this.chosenKey;
    return (
      this.opensToAnonymous &&
      key !== undefined &&
      servesVisitors(key) &&
      key.anonymous === true
    );
  }

  // Where the policy lets them and the chosen key doesn't: the key can't be
  // shared there until its owner allows them on the key page.
  private get keyRefusesAnonymous() {
    let key = this.chosenKey;
    return (
      this.opensToAnonymous &&
      key !== undefined &&
      servesVisitors(key) &&
      !key.anonymous
    );
  }

  // Neither reading is drawn until the chosen workspace says which applies.
  private get policyUnknown() {
    return Boolean(this.form.realm) && this.form.opensToAnonymous === undefined;
  }

  private setOpensToAnonymous(opens: boolean) {
    this.form.opensToAnonymous = opens;
  }

  private keyName(id: string | undefined): string {
    return this.form.keys.find((k) => k.id === id)?.name ?? '';
  }

  // A workspace sharing its name with another on offer is told apart by its
  // address.
  private realmName(url: string | undefined): string {
    let name =
      this.choosing?.context?.realm.name ??
      this.form.realms.find((r) => r.url === url)?.name ??
      '';
    let ambiguous = this.form.realms.some(
      (r) => r.url !== url && r.name === name,
    );
    return ambiguous && url ? `${name} (${addressOf(url)})` : name;
  }

  // Until a label is typed, a share is labelled with its key's name.
  private selectKey = (id: string) => {
    this.form.key = id;
    this.form.error = undefined;
    if (!this.form.labelTyped) {
      this.form.label = this.keyName(id);
    }
  };

  // A realm chosen here is asked whether its policy opens a shared key to
  // people who aren't signed in, which sets how the page reads.
  private selectRealm = async (url: string) => {
    this.form.realm = url;
    this.form.error = undefined;
    this.form.opensToAnonymous = undefined;
    try {
      let context = await windowContext(this.args.api.config, { realm: url });
      if (this.form.realm === url) {
        this.setOpensToAnonymous(context.realm.opensToAnonymous);
      }
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      if (this.form.realm === url) {
        this.form.error = failureMessage(e);
      }
    }
  };

  private setLabel = (value: string) => {
    this.form.label = value;
    this.form.labelTyped = true;
    this.form.error = undefined;
  };

  // From the key page, back to it; opened for a realm, on to the key page,
  // whose trail leads back here.
  private goToKeys = () =>
    this.fromKeyPage
      ? navigation.back(keyPageURL())
      : navigation.assign(withWayBack(pageURL('keys')));

  // Done, a share started from the key page goes back to it; one opened for a
  // realm closes the window.
  private finish = () => {
    if (this.fromKeyPage) {
      this.goToKeys();
    } else {
      this.args.api.close();
    }
  };

  private save = async (event: Event) => {
    event.preventDefault();
    let { key, realm } = this.form;
    if (this.submitDisabled || !key || !realm) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    // Shared into a workspace that lets people who aren't signed in use it,
    // the key allows them, so they will.
    let anonymous = this.opensToAnonymous;
    let anonymousDailyCap = this.chosenKey?.anonymousDailyCap ?? null;
    let anonymousMonthlyCap = this.chosenKey?.anonymousMonthlyCap ?? null;
    try {
      let share = await shareKey(this.args.api.config, {
        keyId: key,
        realm,
        label: this.form.label.trim(),
      });
      this.page.state = {
        name: 'done',
        realm: this.realmName(realm),
        share,
        key: this.keyName(key),
        anonymous,
        anonymousDailyCap: anonymous ? anonymousDailyCap : null,
        anonymousMonthlyCap: anonymous ? anonymousMonthlyCap : null,
      };
      if (!this.fromKeyPage) {
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

export default class ShareKeyPage extends Component<{
  Args: { keyId?: string };
}> {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='share-key' as |api|>
      <ShareKey @api={{api}} @keyId={{@keyId}} />
    </KeysWindow>
  </template>
}
