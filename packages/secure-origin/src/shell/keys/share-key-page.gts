// The `share-key` mode: one of the user's keys, or a new one entered here, put
// into a realm under a label the realm's people see, so that others there can
// use it through the operations approved for it. Only a direct writer of the
// realm may share into it; anyone else is told an administrator needs to set
// it up, with nothing to enter.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  addKey,
  listKeys,
  shareKey,
  windowContext,
} from '../../security/keys.js';
import AuthButton from '../../components/auth-button.gts';
import AuthFormField from '../../components/auth-form-field.gts';
import BusyMessage from '../../components/busy-message.gts';
import BoxelInput from '../../components/input.gts';

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
  | { name: 'choosing'; context: WindowContext }
  | { name: 'done'; context: WindowContext; share: KeyShare; key: string };

class ShareKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage @title='Loading…' />
    {{else if this.notFound}}
      <NotFound />
    {{else if this.needsAdmin}}
      <NeedsAdmin @realm={{this.needsAdmin.context.realm.name}} />
    {{else if this.done}}
      <DonePage @heading='Key shared' @onClose={{@api.close}}>
        <strong>{{this.done.key}}</strong>
        is shared into
        <strong>{{this.done.context.realm.name}}</strong>
        as
        <strong data-test-keys-done-label>{{this.done.share.label}}</strong>.
      </DonePage>
    {{else if this.choosing}}
      <h1 class='heading' data-test-share-key>Share a key</h1>
      <OpenedForSummary
        @context={{this.choosing.context}}
        @reason={{this.opened.reason}}
      />
      <p class='info'>People in this workspace will be able to use the key
        through the requests you approve for it. They never see the key itself.</p>
      <form novalidate {{on 'submit' this.save}} data-test-share-key-form>
        <KeyPicker
          @keys={{this.form.keys}}
          @selected={{this.form.selected}}
          @onSelect={{this.select}}
          @name={{this.form.name}}
          @value={{this.form.value}}
          @onName={{this.setName}}
          @onValue={{this.setValue}}
        />
        <AuthFormField @label='Shared as' data-test-key-field='label'>
          <BoxelInput
            @type='text'
            @autocomplete='off'
            @placeholder='What people in this workspace will see it as'
            @value={{this.form.label}}
            @onInput={{this.setLabel}}
            name='share-label'
            data-test-share-label
          />
        </AuthFormField>
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
          data-test-share-key-save
        >Share key</AuthButton>
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
    label: '',
    // Whether the label was typed rather than filled in from the key's name.
    labelTyped: false,
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
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private async load() {
    if (!this.opened.realm) {
      this.page.state = { name: 'not-found' };
      return;
    }
    let { config } = this.args.api;
    try {
      let context = (await windowContext(config, {
        realm: this.opened.realm,
      })) as WindowContext;
      if (!context.realm.directWriter) {
        this.page.state = { name: 'needs-admin', context };
        return;
      }
      let keys = (await listKeys(config)) as UserKey[];
      this.form.keys = keys;
      this.select(keys.length === 1 ? keys[0].id : keys.length ? '' : NEW_KEY);
      this.page.state = { name: 'choosing', context };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.page.state = { name: 'not-found' };
    }
  }

  private get submitDisabled() {
    let { selected, name, value, label, saving } = this.form;
    return (
      saving ||
      !selected ||
      !label.trim() ||
      (selected === NEW_KEY && (!name.trim() || !value))
    );
  }

  private keyName(selected: string | undefined): string {
    return selected === NEW_KEY
      ? this.form.name
      : (this.form.keys.find((k) => k.id === selected)?.name ?? '');
  }

  // Until a label is typed, a share is labelled with its key's name.
  private select = (selected: string) => {
    this.form.selected = selected || undefined;
    this.form.error = undefined;
    if (!this.form.labelTyped) {
      this.form.label = this.keyName(this.form.selected);
    }
  };

  private setName = (value: string) => {
    this.form.name = value;
    this.form.error = undefined;
    if (!this.form.labelTyped) {
      this.form.label = value;
    }
  };

  private setValue = (value: string) => {
    this.form.value = value;
    this.form.error = undefined;
  };

  private setLabel = (value: string) => {
    this.form.label = value;
    this.form.labelTyped = true;
    this.form.error = undefined;
  };

  private save = async (event: Event) => {
    event.preventDefault();
    let context = this.choosing?.context;
    if (this.submitDisabled || !context) {
      return;
    }
    let { config } = this.args.api;
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let keyId = this.form.selected!;
      let keyName = this.keyName(keyId);
      if (keyId === NEW_KEY) {
        let key = (await addKey(config, {
          name: this.form.name.trim(),
          value: this.form.value,
        })) as UserKey;
        this.form.value = '';
        // Added, so a failure to share it next offers it as one of the
        // user's keys rather than adding it again.
        this.form.keys = [...this.form.keys, key];
        this.form.selected = key.id;
        keyId = key.id;
        keyName = key.name;
      }
      let share = (await shareKey(config, {
        keyId,
        realm: context.realm.url,
        label: this.form.label.trim(),
      })) as KeyShare;
      this.page.state = { name: 'done', context, share, key: keyName };
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

export default class ShareKeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' as |api|>
      <ShareKey @api={{api}} />
    </KeysWindow>
  </template>
}
