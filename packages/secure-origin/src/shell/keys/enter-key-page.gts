// The `enter-key` mode: a new key, its name and its value, entered into this
// window and added to the user's own keys. A key holds no destination. Opened
// for an operation, the page first says which operation, card and realm the
// key is for and where that operation sends it, as the realm server describes
// them; where the key may be sent is granted when the operation is approved.
//
// This is the one page a new key's value is typed into. Reached from the key
// page (`?then=keys`), it goes back there once the key is added, rather than
// closing the window.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { addKey, windowContext } from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { navigation } from '../navigation.js';
import { modeURL } from '../urls.js';

import { failureMessage, isNotFound, isSignedOut } from './context.ts';
import type { UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeyFields from './key-fields.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import NotFound from './not-found.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor, returnsToKeyPage } from './opened-for.ts';

type State =
  | { name: 'loading' }
  | { name: 'not-found' }
  | { name: 'load-failed'; message: string }
  | { name: 'entering'; context?: WindowContext }
  | { name: 'done'; key: UserKey; context?: WindowContext };

class EnterKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.notFound}}
      <NotFound />
    {{else if this.loadFailed}}
      <LoadFailed @message={{this.loadFailed.message}} @onRetry={{this.load}} />
    {{else if this.done}}
      <DonePage @heading='Key saved' @onClose={{@api.close}}>Your key
        <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
        is saved. Nothing can read it back, here or anywhere in Boxel.</DonePage>
    {{else if this.entering}}
      <form novalidate {{on 'submit' this.save}} data-test-enter-key-form>
        <EditPage @heading='Enter a key' data-test-enter-key>
          <:intro>The key is encrypted as soon as it is saved, and nothing can
            read it back. Cards use it only through requests you approve.</:intro>
          <:default>
            {{#if this.entering.context}}
              <OpenedForSummary
                @context={{this.entering.context}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            <KeyFields
              @name={{this.form.name}}
              @value={{this.form.value}}
              @onName={{this.setName}}
              @onValue={{this.setValue}}
            />
            {{#if this.form.error}}
              <div class='keys-error' role='alert' data-test-keys-error>
                {{this.form.error}}
              </div>
            {{/if}}
          </:default>
          <:actions>
            {{#if this.returnsToKeyPage}}
              <Button
                type='button'
                @kind='secondary'
                data-test-enter-key-back
                {{on 'click' this.back}}
              >Cancel</Button>
            {{/if}}
            <Button
              type='submit'
              @kind='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.form.saving}}
              data-test-enter-key-save
            >Save key</Button>
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
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
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
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get entering() {
    return this.page.state.name === 'entering' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  private load = async () => {
    let request = contextRequest(this.opened);
    if (!request) {
      this.page.state = { name: 'entering' };
      return;
    }
    this.page.state = { name: 'loading' };
    try {
      let context = (await windowContext(
        this.args.api.config,
        request,
      )) as WindowContext;
      this.page.state = { name: 'entering', context };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else if (isNotFound(e)) {
        this.page.state = { name: 'not-found' };
      } else {
        this.page.state = { name: 'load-failed', message: failureMessage(e) };
      }
    }
  };

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
      let key = await addKey(this.args.api.config, {
        name: this.form.name.trim(),
        value: this.form.value,
      });
      // The value is gone from the page the moment the server has it.
      this.form.value = '';
      if (this.returnsToKeyPage) {
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
