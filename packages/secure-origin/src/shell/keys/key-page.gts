// The key page: the user's own keys, by name, and what they can do with each.
// It is what the secure origin shows at its own address, and its `keys` mode.
// No key's value is ever shown, here or anywhere: a key is replaced, never
// read back. Deleting a key first lists the shares it would suspend.
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
} from '../../security/keys.js';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { modeURL } from '../urls.js';

import { failureMessage, isSignedOut } from './context.ts';
import type { KeyShare, UserKey } from './context.ts';
import KeyFields from './key-fields.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import { RETURN_PARAM } from './opened-for.ts';

type Action =
  | { name: 'none' }
  | { name: 'replacing'; key: UserKey }
  | { name: 'deleting'; key: UserKey; shares: KeyShare[] | undefined };

function addedOn(iso: string): string {
  let date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

class Keys extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    <div class='head'>
      <h1 class='heading' data-test-key-page>Your keys</h1>
      <Button
        @kind='primary'
        @size='small'
        data-test-key-page-add
        {{on 'click' this.add}}
      >Add a key</Button>
    </div>
    <p class='info'>Keys you add here are encrypted, and nothing can read them
      back. Cards use a key only through requests you approve for it.</p>
    {{#if this.state.loading}}
      <BusyMessage @title='Loading…' />
    {{else if this.state.error}}
      <div class='error' role='alert' data-test-keys-error>
        {{this.state.error}}
      </div>
    {{/if}}
    {{#if this.state.keys}}
      <ul class='keys' data-test-key-list>
        {{#each this.state.keys as |key|}}
          <li class='key' data-test-key-row={{key.name}}>
            <div class='key-head'>
              <div class='key-text'>
                <div class='key-name' data-test-key-row-name>{{key.name}}</div>
                <div class='key-meta'>Static key · added
                  {{addedOn key.createdAt}}</div>
              </div>
              <div class='key-actions'>
                <Button
                  @kind='secondary'
                  @size='extra-small'
                  data-test-key-replace
                  {{on 'click' (fn this.startReplace key)}}
                >Replace</Button>
                <Button
                  @kind='destructive'
                  @size='extra-small'
                  data-test-key-delete
                  {{on 'click' (fn this.startDelete key)}}
                >Delete</Button>
              </div>
            </div>
            {{#if (this.isActing 'replacing' key)}}
              <form
                class='key-form'
                novalidate
                {{on 'submit' this.replace}}
                data-test-key-replace-form
              >
                <KeyFields
                  @value={{this.form.value}}
                  @onValue={{this.setValue}}
                />
                <div class='form-actions'>
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
              <div class='key-form' data-test-key-delete-confirm>
                {{#if this.deletingShares}}
                  <p class='confirm'>Deleting
                    <strong>{{key.name}}</strong>
                    stops it working in the workspaces it’s shared into:</p>
                  <ul class='shares' data-test-key-delete-shares>
                    {{#each this.deletingShares as |share|}}
                      <li>{{share.label}}
                        <span class='share-realm'>{{share.realm}}</span></li>
                    {{/each}}
                  </ul>
                {{else}}
                  <p class='confirm'>Delete
                    <strong>{{key.name}}</strong>? Requests that use it stop
                    working.</p>
                {{/if}}
                <div class='form-actions'>
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
                    @loading={{this.form.saving}}
                    data-test-key-delete-confirm-button
                    {{on 'click' this.delete}}
                  >Delete key</Button>
                </div>
              </div>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    {{else if (eq this.state.loading false)}}
      <p class='empty' data-test-key-list-empty>You haven’t added any keys.</p>
    {{/if}}

    <style scoped>
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp);
        margin-bottom: var(--boxel-sp-xs);
      }
      .heading {
        font: 600 var(--boxel-font-md);
        margin: 0;
      }
      .info {
        margin: 0 0 var(--boxel-sp);
        letter-spacing: var(--boxel-lsp);
        line-height: 20px;
        color: var(--muted-foreground);
      }
      .error {
        color: var(--destructive-ink, var(--boxel-danger));
        font: 500 var(--boxel-font-xs);
        margin-bottom: var(--boxel-sp-sm);
      }
      .keys {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .key {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        border: 1px solid var(--panel-border);
        border-radius: var(--boxel-border-radius-lg);
        background-color: var(--panel-background);
      }
      .key-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
      .key-text {
        flex: 1;
        min-width: 0;
      }
      .key-name {
        font: 600 var(--boxel-font-sm);
        overflow-wrap: anywhere;
      }
      .key-meta {
        font: var(--boxel-font-xs);
        color: var(--muted-foreground);
      }
      .key-actions,
      .form-actions {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .form-actions {
        justify-content: flex-end;
        margin-top: var(--boxel-sp-sm);
      }
      .key-form {
        margin-top: var(--boxel-sp-xs);
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--panel-border);
      }
      .confirm {
        margin: 0;
        line-height: 20px;
      }
      .shares {
        margin: var(--boxel-sp-xs) 0 0;
        padding-inline-start: var(--boxel-sp-lg);
        overflow-wrap: anywhere;
      }
      .share-realm {
        color: var(--muted-foreground);
        font: var(--boxel-font-xs);
      }
      .empty {
        margin: var(--boxel-sp) 0 0;
        color: var(--muted-foreground);
      }
    </style>
  </template>

  private state = trackedObject({
    loading: true,
    keys: [] as UserKey[],
    error: undefined as string | undefined,
    action: { name: 'none' } as Action,
  });
  private form = trackedObject({ value: '', saving: false });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private async guard(work: () => Promise<void>) {
    this.state.error = undefined;
    try {
      await work();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.state.error = failureMessage(e);
    }
  }

  private async load() {
    await this.guard(async () => {
      this.state.keys = (await listKeys(this.args.api.config)) as UserKey[];
    });
    this.state.loading = false;
  }

  private isActing = (name: Action['name'], key: UserKey) =>
    this.state.action.name === name &&
    'key' in this.state.action &&
    this.state.action.key.id === key.id;

  private get deletingShares() {
    let action = this.state.action;
    return action.name === 'deleting' && action.shares?.length
      ? action.shares
      : undefined;
  }

  private get replaceDisabled() {
    return this.form.saving || !this.form.value;
  }

  private add = () =>
    navigation.assign(modeURL('enter-key', { [RETURN_PARAM]: 'keys' }));

  private setValue = (value: string) => {
    this.form.value = value;
  };

  private cancel = () => {
    this.form.value = '';
    this.state.action = { name: 'none' };
  };

  private startReplace = (key: UserKey) => {
    this.form.value = '';
    this.state.action = { name: 'replacing', key };
  };

  private startDelete = async (key: UserKey) => {
    this.state.action = { name: 'deleting', key, shares: undefined };
    await this.guard(async () => {
      let shares = (await sharesOfKey(
        this.args.api.config,
        key.id,
      )) as KeyShare[];
      if (this.isActing('deleting', key)) {
        this.state.action = { name: 'deleting', key, shares };
      }
    });
  };

  private replace = async (event: Event) => {
    event.preventDefault();
    let action = this.state.action;
    if (this.replaceDisabled || action.name !== 'replacing') {
      return;
    }
    this.form.saving = true;
    await this.guard(async () => {
      await replaceKey(this.args.api.config, {
        keyId: action.key.id,
        value: this.form.value,
      });
      this.form.value = '';
      this.state.action = { name: 'none' };
      await this.load();
    });
    this.form.saving = false;
  };

  private delete = async () => {
    let action = this.state.action;
    if (action.name !== 'deleting') {
      return;
    }
    this.form.saving = true;
    await this.guard(async () => {
      await deleteKey(this.args.api.config, { keyId: action.key.id });
      this.state.action = { name: 'none' };
      await this.load();
    });
    this.form.saving = false;
  };
}

export default class KeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' as |api|>
      <Keys @api={{api}} />
    </KeysWindow>
  </template>
}
