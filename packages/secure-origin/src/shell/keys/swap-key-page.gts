// The `swap-key` mode: one of the user's own keys, or a new one entered here,
// put into a realm's suspended share, which then resumes under the same label
// with the user as its owner, so the cards using it keep working unchanged.
// Only a direct writer of the realm may swap a key in; anyone else is told an
// administrator needs to set it up.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  addKey,
  listKeys,
  realmShares,
  swapKey,
  windowContext,
} from '../../security/keys.js';
import AuthButton from '../../components/auth-button.gts';
import BusyMessage from '../../components/busy-message.gts';

import { failureMessage, isSignedOut } from './context.ts';
import type { KeyShare, UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import KeyPicker, { NEW_KEY } from './key-picker.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import NeedsAdmin from './needs-admin.gts';
import NotFound from './not-found.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { openedFor } from './opened-for.ts';

type State =
  | { name: 'loading' }
  | { name: 'not-found' }
  | { name: 'needs-admin'; context: WindowContext }
  | { name: 'active'; context: WindowContext; share: KeyShare }
  | { name: 'choosing'; context: WindowContext; share: KeyShare }
  | { name: 'done'; context: WindowContext; share: KeyShare; key: string };

// Why a share stopped serving, in the words its writers see.
const SUSPENDED_BECAUSE: Record<string, string> = {
  'owner-lost-write':
    'The person who shared its key can no longer edit this workspace.',
  'suspended-by-writer': 'Someone who edits this workspace suspended it.',
  'key-deleted': 'The person who shared its key deleted it.',
};

class SwapKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage @title='Loading…' />
    {{else if this.notFound}}
      <NotFound />
    {{else if this.needsAdmin}}
      <NeedsAdmin @realm={{this.needsAdmin.context.realm.name}} />
    {{else if this.active}}
      <section data-test-swap-key-active>
        <h1 class='heading'>This shared key is working</h1>
        <p class='info'><strong>{{this.active.share.label}}</strong>
          in
          <strong>{{this.active.context.realm.name}}</strong>
          isn’t suspended, so there is nothing to replace.</p>
      </section>
    {{else if this.done}}
      <DonePage @heading='Key swapped in' @onClose={{@api.close}}>
        <strong data-test-keys-done-label>{{this.done.share.label}}</strong>
        in
        <strong>{{this.done.context.realm.name}}</strong>
        now uses your key
        <strong>{{this.done.key}}</strong>, and works again.
      </DonePage>
    {{else if this.choosing}}
      <h1 class='heading' data-test-swap-key>Use your key for a shared key</h1>
      <OpenedForSummary
        @context={{this.choosing.context}}
        @reason={{this.opened.reason}}
      />
      <div class='share' data-test-swap-share>
        <div class='share-label' data-test-swap-share-label>
          {{this.choosing.share.label}}
        </div>
        <div class='share-state'>Suspended.
          {{this.suspendedBecause}}</div>
      </div>
      <p class='info'>Put one of your own keys in its place and it works again
        under the same name, with you as the one sharing it.</p>
      <form novalidate {{on 'submit' this.save}} data-test-swap-key-form>
        <KeyPicker
          @keys={{this.form.keys}}
          @selected={{this.form.selected}}
          @onSelect={{this.select}}
          @name={{this.form.name}}
          @value={{this.form.value}}
          @onName={{this.setName}}
          @onValue={{this.setValue}}
        />
        {{#if this.form.error}}
          <div class='error' role='alert' data-test-keys-error>
            {{this.form.error}}
          </div>
        {{/if}}
        <AuthButton
          class='submit'
          type='submit'
          @variant='primary'
          @disabled={{this.submitDisabled}}
          @loading={{this.form.saving}}
          data-test-swap-key-save
        >Use this key</AuthButton>
      </form>
    {{/if}}

    <style scoped>
      .heading {
        font: 600 var(--boxel-font-md);
        margin: 0 0 var(--boxel-sp);
      }
      .info {
        margin: 0;
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .share {
        margin-bottom: var(--boxel-sp);
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        border: 1px solid var(--panel-border);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--panel-background);
        overflow-wrap: anywhere;
      }
      .share-label {
        font: 600 var(--boxel-font-sm);
      }
      .share-state {
        margin-top: var(--boxel-sp-4xs);
        font: var(--boxel-font-xs);
        color: var(--muted-foreground);
      }
      .error {
        color: var(--destructive-ink, var(--boxel-danger));
        font: 500 var(--boxel-font-xs);
        margin-top: var(--boxel-sp-xs);
      }
      .submit {
        margin-top: var(--boxel-sp-lg);
        width: 100%;
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
    name: '',
    value: '',
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
  private get notFound() {
    return this.page.state.name === 'not-found';
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

  private async load() {
    let { realm, share: shareId } = this.opened;
    if (!realm || !shareId) {
      this.page.state = { name: 'not-found' };
      return;
    }
    let { config } = this.args.api;
    try {
      let context = (await windowContext(config, { realm })) as WindowContext;
      if (!context.realm.directWriter) {
        this.page.state = { name: 'needs-admin', context };
        return;
      }
      let share = (
        (await realmShares(config, context.realm.url)) as KeyShare[]
      ).find((s) => s.id === shareId);
      if (!share) {
        this.page.state = { name: 'not-found' };
        return;
      }
      if (share.state === 'active') {
        this.page.state = { name: 'active', context, share };
        return;
      }
      let keys = (await listKeys(config)) as UserKey[];
      this.form.keys = keys;
      this.form.selected =
        keys.length === 1 ? keys[0].id : keys.length ? undefined : NEW_KEY;
      this.page.state = { name: 'choosing', context, share };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.page.state = { name: 'not-found' };
    }
  }

  private get submitDisabled() {
    let { selected, name, value, saving } = this.form;
    return (
      saving || !selected || (selected === NEW_KEY && (!name.trim() || !value))
    );
  }

  private select = (selected: string) => {
    this.form.selected = selected;
    this.form.error = undefined;
  };

  private setName = (value: string) => {
    this.form.name = value;
    this.form.error = undefined;
  };

  private setValue = (value: string) => {
    this.form.value = value;
    this.form.error = undefined;
  };

  private save = async (event: Event) => {
    event.preventDefault();
    let choosing = this.choosing;
    if (this.submitDisabled || !choosing) {
      return;
    }
    let { config } = this.args.api;
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let keyId = this.form.selected!;
      let keyName =
        this.form.keys.find((k) => k.id === keyId)?.name ?? this.form.name;
      if (keyId === NEW_KEY) {
        let key = (await addKey(config, {
          name: this.form.name.trim(),
          value: this.form.value,
        })) as UserKey;
        this.form.value = '';
        this.form.keys = [...this.form.keys, key];
        this.form.selected = key.id;
        keyId = key.id;
        keyName = key.name;
      }
      let share = (await swapKey(config, {
        keyId,
        shareId: choosing.share.id,
      })) as KeyShare;
      this.page.state = {
        name: 'done',
        context: choosing.context,
        share,
        key: keyName,
      };
      this.args.api.close();
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
    <KeysWindow @title='Boxel · Your keys' as |api|>
      <SwapKey @api={{api}} />
    </KeysWindow>
  </template>
}
