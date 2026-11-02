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
// The page also asks whether people who aren't signed in may use the key, and
// it reads in one of two ways. Where the workspace's policy opens a call that
// sends a shared key to such people (`realm.opensToAnonymous` in the window's
// context), the intro bolds that they can use it, and the key is shared only
// once the owner ticks that they agree. Elsewhere the intro says only
// signed-in people can use it, and "Who can use it" lets the owner allow
// people who aren't signed in ahead of time, for when the policy opens such a
// call; choosing that switches the intro to the anonymous version. Either
// way, allowing them asks for an optional anonymous cap: their calls a day,
// all together, inside the share's daily budget.
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
import Checkbox from '../../components/checkbox.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import Tag from '../../components/icons/tag.gts';
import Users from '../../components/icons/users.gts';
import BoxelInput from '../../components/input.gts';
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
import KeyTile from './key-tile.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import NeedsAdmin from './needs-admin.gts';
import OpenedForSummary from './opened-for-summary.gts';
import RadioChoices, { type RadioChoice } from './radio-choices.gts';
import { openedForShare } from './opened-for.ts';
import WorkspaceDropdown, { addressOf } from './workspace-dropdown.gts';

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
  | { name: 'done'; realm: string; share: KeyShare; key: string };

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
        @heading='Share a key'
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
        {{#if this.done.share.anonymous}}
          <strong data-test-share-key-done-anonymous>People who aren’t signed in
            can use it too</strong>{{#if this.done.share.anonymousDailyCap}}, up
            to
            {{this.done.share.anonymousDailyCap}}
            calls a day all together{{/if}}.
        {{/if}}
      </DonePage>
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.save}} data-test-share-key-form>
        <EditPage @heading='Share a key' data-test-share-key>
          <:intro>
            {{#if this.forAnyone}}
              <span data-test-share-key-intro='anyone'>People who can access the
                workspace can use the key in their requests,
                <strong>and so can people who aren’t signed in</strong>,
                wherever this workspace lets them open its cards. Nobody sees
                the key itself. Requests made by anyone who opens those cards
                will consume your quota and/or be billed against your account
                with this service provider.</span>
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
            {{else if this.opensToAnonymous}}
              <FieldContainer
                @tag='label'
                @label='People who aren’t signed in'
                @icon={{Users}}
                data-test-share-key-agree
              >
                <span class='agree'>
                  <Checkbox
                    @checked={{this.form.anonymous}}
                    @onChange={{this.toggleAgree}}
                    data-test-share-key-agree-input
                  />
                  <span class='agree-text'>
                    <span>I agree that people who aren’t signed in can use this
                      key</span>
                    <span class='note'>This workspace lets them open cards that
                      call a service with a shared key, so a key is shared here
                      only for them too.</span>
                  </span>
                </span>
              </FieldContainer>
            {{else}}
              <RadioChoices
                @label='Who can use it'
                @icon={{Users}}
                @name='share-who'
                @choices={{this.whoChoices}}
                @selected={{if this.form.anonymous 'anyone' 'signed-in'}}
                @onSelect={{this.chooseWho}}
              />
            {{/if}}
            {{#if this.form.anonymous}}
              <FieldContainer
                @tag='label'
                @label='Anonymous cap (optional)'
                @icon={{KeyRound}}
                data-test-share-key-cap
              >
                <BoxelInput
                  @type='text'
                  @autocomplete='off'
                  @placeholder='No cap'
                  @value={{this.form.cap}}
                  @onInput={{this.setCap}}
                  @state={{if this.capValid 'none' 'invalid'}}
                  @errorMessage={{this.capError}}
                  inputmode='numeric'
                  data-test-share-key-cap-input
                />
                <span class='note cap-note'>How many calls people who aren’t
                  signed in can make with this key each day, all together. The
                  rest of its daily budget is kept for people who are signed in.
                  Leave it empty to let them use the whole budget.</span>
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
      .agree {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        cursor: pointer;
      }
      .agree-text {
        display: grid;
        min-width: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .note {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .cap-note {
        display: block;
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
    // The owner's agreement that such people may use the key, and the
    // optional cap on their calls a day, as typed.
    anonymous: false,
    cap: '',
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
      (this.form.opensToAnonymous && !this.form.anonymous) ||
      !this.capValid
    );
  }

  private whoChoices: RadioChoice[] = [
    {
      value: 'signed-in',
      label: 'Only people who are signed in',
      hint: 'People with access to this workspace.',
    },
    {
      value: 'anyone',
      label: 'Anyone, including people who aren’t signed in',
      hint: 'They can use it wherever this workspace lets them open a card that calls a service with a shared key. It lets them open none today.',
    },
  ];

  private get opensToAnonymous() {
    return this.form.opensToAnonymous === true;
  }

  // The intro tells of people who aren't signed in once they can use the key.
  private get forAnyone() {
    return this.opensToAnonymous || this.form.anonymous;
  }

  // Neither reading is drawn until the chosen workspace says which applies,
  // so no choice is made against one and then dropped by the other.
  private get policyUnknown() {
    return Boolean(this.form.realm) && this.form.opensToAnonymous === undefined;
  }

  // Where the workspace already lets such people use a shared key, the owner
  // ticks the agreement for it, so a choice made for another workspace isn't
  // taken as one. Elsewhere a choice already made stands.
  private setOpensToAnonymous(opens: boolean) {
    this.form.opensToAnonymous = opens;
    if (opens) {
      this.form.anonymous = false;
    }
  }

  private chooseWho = (value: string) => {
    this.form.anonymous = value === 'anyone';
    this.form.error = undefined;
  };

  private toggleAgree = () => {
    this.form.anonymous = !this.form.anonymous;
    this.form.error = undefined;
  };

  private setCap = (value: string) => {
    this.form.cap = value;
    this.form.error = undefined;
  };

  // The cap as typed: empty for none, else a whole number of calls, at least
  // one.
  private get cap(): number | null | undefined {
    let trimmed = this.form.cap.trim();
    if (!this.form.anonymous || trimmed === '') {
      return null;
    }
    let cap = Number(trimmed);
    return /^\d+$/.test(trimmed) && cap >= 1 && cap <= 2_147_483_647
      ? cap
      : undefined;
  }

  private get capValid() {
    return this.cap !== undefined;
  }

  private get capError() {
    return this.capValid
      ? undefined
      : 'A whole number of calls, at least one, or empty for no cap';
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

  private goToKeys = () => navigation.back(pageURL('keys'));

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
    try {
      let share = await shareKey(this.args.api.config, {
        keyId: key,
        realm,
        label: this.form.label.trim(),
        anonymous: this.form.anonymous,
        ...(this.cap != null ? { anonymousDailyCap: this.cap } : {}),
      });
      this.page.state = {
        name: 'done',
        realm: this.realmName(realm),
        share,
        key: this.keyName(key),
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
