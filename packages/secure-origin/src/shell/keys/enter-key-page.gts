// The `enter-key` mode: a new key, its name and its value, entered into this
// window and added to the user's own keys. A key holds no destination. Opened
// for an operation, the page first says which operation, card and realm the
// key is for and where that operation sends it, as the realm server describes
// them; where the key may be sent is granted when the operation is approved.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { addKey, windowContext } from '../../security/keys.js';
import AuthButton from '../../components/auth-button.gts';
import BusyMessage from '../../components/busy-message.gts';

import { failureMessage, isSignedOut } from './context.ts';
import type { UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import KeyFields from './key-fields.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor, returnsToKeyPage } from './opened-for.ts';
import { navigation } from '../navigation.js';
import { modeURL } from '../urls.js';
import NotFound from './not-found.gts';

type State =
  | { name: 'loading' }
  | { name: 'not-found' }
  | { name: 'entering'; context?: WindowContext }
  | { name: 'done'; key: UserKey; context?: WindowContext };

class EnterKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage @title='Loading…' />
    {{else if this.notFound}}
      <NotFound />
    {{else if this.done}}
      <DonePage @heading='Key saved' @onClose={{@api.close}}>Your key
        <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
        is saved. Nothing can read it back, here or anywhere in Boxel.</DonePage>
    {{else if this.entering}}
      <h1 class='heading' data-test-enter-key>Enter a key</h1>
      {{#if this.entering.context}}
        <OpenedForSummary
          @context={{this.entering.context}}
          @reason={{this.opened.reason}}
        />
      {{/if}}
      <form novalidate {{on 'submit' this.save}} data-test-enter-key-form>
        <KeyFields
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
          data-test-enter-key-save
        >Save key</AuthButton>
        {{#if this.returnsToKeyPage}}
          <AuthButton
            class='back'
            type='button'
            @variant='secondary'
            data-test-enter-key-back
            {{on 'click' this.back}}
          >Back to your keys</AuthButton>
        {{/if}}
      </form>
    {{/if}}

    <style scoped>
      .heading {
        font: 600 var(--boxel-font-md);
        margin: 0 0 var(--boxel-sp);
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
      .back {
        margin-top: var(--boxel-sp-sm);
        width: 100%;
      }
    </style>
  </template>

  private opened = openedFor();
  private returnsToKeyPage = returnsToKeyPage();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
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
  private get entering() {
    return this.page.state.name === 'entering' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private async load() {
    let request = contextRequest(this.opened);
    if (!request) {
      this.page.state = { name: 'entering' };
      return;
    }
    try {
      let context = (await windowContext(
        this.args.api.config,
        request,
      )) as WindowContext;
      this.page.state = { name: 'entering', context };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.page.state = { name: 'not-found' };
    }
  }

  private back = () => navigation.replace(modeURL('keys'));

  private get submitDisabled() {
    return this.form.saving || !this.form.name.trim() || !this.form.value;
  }

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
    if (this.submitDisabled) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let key = (await addKey(this.args.api.config, {
        name: this.form.name.trim(),
        value: this.form.value,
      })) as UserKey;
      // The value is gone from the page the moment the server has it.
      this.form.value = '';
      if (returnsToKeyPage()) {
        navigation.replace(modeURL('keys'));
        return;
      }
      this.page.state = {
        name: 'done',
        key,
        context: this.entering?.context,
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

export default class EnterKeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' as |api|>
      <EnterKey @api={{api}} />
    </KeysWindow>
  </template>
}
