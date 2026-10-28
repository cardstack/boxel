// The `enter-key` page: a new key, its name, its kind and its value, entered
// into this window and added to the user's own keys. A key is either pasted in
// as it is, or a Google service account's JSON key file, chosen from disk with
// the user to act as and its scopes. A key holds no destination. Opened
// for an operation, the page first says which operation, card and realm the
// key is for and where that operation sends it, as the realm server describes
// them; where the key may be sent is granted when the operation is approved.
//
// This is the one page a new key's value is typed into. Reached from the key
// page, at `keys/add`, it goes back there once the key is added, rather than
// closing the window.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { addKey, windowContext } from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { KeyKind, KeyValue, UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeyFields from './key-fields.gts';
import KeyKindChoice from './key-kind-choice.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor, returnsToKeyPage } from './opened-for.ts';
import { ServiceAccountEntry } from './service-account-entry.ts';
import {
  isGoogleAPIHost,
  isServiceAccountKeyFile,
} from './service-account-key-file.ts';
import ServiceAccountFields from './service-account-fields.gts';

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'entering'; context?: WindowContext }
  | { name: 'done'; key: UserKey; context?: WindowContext };

interface EnterKeyArgs {
  api: KeysWindowAPI;
  // Whether the page is the key page's own `keys/add`, as the router names
  // it, rather than read from the address.
  fromKeyPage?: boolean;
}

class EnterKey extends Component<{ Args: EnterKeyArgs }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading='Enter a key'
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.done}}
      <DonePage @heading='Key saved' @onClose={{@api.close}}>Your key
        <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
        is saved. Nothing can read it back, here or anywhere in Boxel.
        {{#if this.done.context.card}}
          <span class='next' data-test-keys-done-next>Saving it doesn’t give
            <strong>{{this.done.context.card.name}}</strong>
            the key.
            <strong>{{this.done.context.card.name}}</strong>
            will ask you to approve where it sends the key before it can use it.</span>
        {{/if}}
      </DonePage>
    {{else if this.entering}}
      <form novalidate {{on 'submit' this.save}} data-test-enter-key-form>
        <EditPage @heading='Enter a key' data-test-enter-key>
          <:intro>The key is encrypted as soon as it is saved, and nothing can
            read it back. Cards can send it only to the places you approve for
            it.</:intro>
          <:default>
            {{#if this.entering.context}}
              <OpenedForSummary
                @context={{this.entering.context}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            <KeyKindChoice @kind={{this.form.kind}} @onKind={{this.setKind}} />
            {{#if this.suggestsServiceAccount}}
              <p class='kind-hint' data-test-google-destination-hint>
                This request goes to a Google API. If you were given a JSON key
                file for a Google Cloud service account, choose
                <strong>Google service account</strong>; if you have an API key,
                paste it as a key.
              </p>
            {{/if}}
            {{#if this.isServiceAccount}}
              <KeyFields @name={{this.form.name}} @onName={{this.setName}} />
              <ServiceAccountFields
                @entry={{this.serviceAccount}}
                @onChange={{this.clearError}}
              />
            {{else}}
              <KeyFields
                @name={{this.form.name}}
                @value={{this.form.value}}
                @onName={{this.setName}}
                @onValue={{this.setValue}}
              />
              {{#if this.pastedKeyFile}}
                <div class='kind-hint' role='alert' data-test-pasted-key-file>
                  <p>This is a Google service account’s JSON key file. It can’t
                    be sent as it is: Boxel makes short-lived tokens from it for
                    Google instead.</p>
                  <Button
                    type='button'
                    @kind='secondary'
                    @size='small'
                    data-test-use-service-account
                    {{on 'click' this.usePastedKeyFile}}
                  >Use it as a Google service account</Button>
                </div>
              {{/if}}
            {{/if}}
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
      .next {
        display: block;
        margin-top: var(--boxel-sp-xs);
      }
      form {
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .kind-hint {
        display: grid;
        gap: var(--boxel-sp-xs);
        justify-items: start;
        margin: 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .kind-hint p {
        margin: 0;
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
  private returnsToKeyPage = this.args.fromKeyPage ?? returnsToKeyPage();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    name: '',
    kind: 'static' as KeyKind,
    value: '',
    saving: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: EnterKeyArgs) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
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
      this.args.api.visit.loaded();
      return;
    }
    this.page.state = { name: 'loading' };
    try {
      let context = (await windowContext(
        this.args.api.config,
        request,
      )) as WindowContext;
      this.page.state = { name: 'entering', context };
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

  private back = () => navigation.back(pageURL('keys'));

  private serviceAccount = new ServiceAccountEntry();

  private get isServiceAccount() {
    return this.form.kind === 'google-service-account';
  }

  // What is entered, as the kind chosen says, or nothing while incomplete.
  private get entered(): KeyValue | undefined {
    if (this.isServiceAccount) {
      return this.serviceAccount.value;
    }
    return this.form.value
      ? { kind: 'static', value: this.form.value }
      : undefined;
  }

  private get submitDisabled() {
    return (
      this.form.saving ||
      !this.form.name.trim() ||
      !this.entered ||
      this.pastedKeyFile
    );
  }

  // A service account's key file pasted where a key sent as it is goes. It
  // can't be saved there; the page offers to take it as a service account.
  private get pastedKeyFile() {
    return !this.isServiceAccount && isServiceAccountKeyFile(this.form.value);
  }

  // Opened for an operation that sends to a Google API, the page says when a
  // service account fits. It doesn't choose one: Google's APIs take plain API
  // keys too.
  private get suggestsServiceAccount() {
    return (
      !this.isServiceAccount &&
      isGoogleAPIHost(this.entering?.context?.operation?.destination?.host)
    );
  }

  private usePastedKeyFile = () => {
    let text = this.form.value;
    this.setKind('google-service-account');
    this.serviceAccount.readText(text, 'the pasted key file');
  };

  // Switching kinds drops what was entered for the other, so a value typed
  // for one is never sent as the other.
  private setKind = (kind: KeyKind) => {
    this.form.kind = kind;
    this.form.value = '';
    this.serviceAccount.clear();
    this.form.error = undefined;
  };

  private clearError = () => {
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
    let entered = this.entered;
    if (this.submitDisabled || !entered) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let key = await addKey(this.args.api.config, {
        name: this.form.name.trim(),
        entered,
      });
      // The value is gone from the page the moment the server has it.
      this.form.value = '';
      this.serviceAccount.clear();
      if (this.returnsToKeyPage) {
        navigation.back(pageURL('keys'));
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

export default class EnterKeyPage extends Component<{
  Args: { fromKeyPage?: boolean };
}> {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='enter-key' as |api|>
      <EnterKey @api={{api}} @fromKeyPage={{@fromKeyPage}} />
    </KeysWindow>
  </template>
}
