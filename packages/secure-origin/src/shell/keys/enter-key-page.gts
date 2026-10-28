// The `enter-key` page: a new key, its name and its value, entered into this
// window and added to the user's own keys. A key holds no destination. Opened
// for an operation, the page first says which operation, card and realm the
// key is for and where that operation sends it, as the realm server describes
// them; where the key may be sent is granted when the operation is approved.
//
// A key is a secret pasted in; a Google service account's JSON key file,
// chosen from disk with the user to act as and its scopes; or an OAuth app the
// user registered with a service, whose client secret is its value and whose
// settings go beside it. Accounts are then connected through the app on the
// `connect` page.
//
// What tells a secret and a service account apart is what the user has in
// hand, not the service: Google's own APIs take plain API keys too. So each
// kind says what it is for; a service account's key file pasted as a secret
// is caught and offered as a service account; and a window opened for an
// operation that sends to a Google API says when a service account fits,
// without choosing one.
//
// This is the one page a new key's value is typed into. Reached from the key
// page, at `keys/add`, it goes back there once the key is added, rather than
// closing the window.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  addKey,
  addOAuthClient,
  windowContext,
  type KeyValue,
  type OAuthClientSettings,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import Tag from '../../components/icons/tag.gts';
import BoxelInput from '../../components/input.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  failureMessage,
  isSignedOut,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { UserKey, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeyFields from './key-fields.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OAuthClientFields, {
  type OAuthClientField,
  type OAuthClientForm,
} from './oauth-client-fields.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor, returnsToKeyPage } from './opened-for.ts';
import RadioChoices from './radio-choices.gts';
import { ServiceAccountEntry } from './service-account-entry.ts';
import ServiceAccountFields from './service-account-fields.gts';
import {
  isGoogleAPIHost,
  isServiceAccountKeyFile,
} from './service-account-key-file.ts';

type Kind = 'static' | 'google-service-account' | 'oauth-client';

const KINDS = [
  {
    value: 'static',
    label: 'API key or token',
    hint: 'A key or token you copy from the service and paste here, such as a GitHub token or a Google Maps API key.',
  },
  {
    value: 'google-service-account',
    label: 'Google service account',
    hint: 'For Google APIs such as Sheets and Drive, when you have a service account’s key file (a .json file from Google Cloud). Boxel sends Google a short-lived token made from it, never the file itself.',
  },
  {
    value: 'oauth-client',
    label: 'OAuth app',
    hint: 'An app you registered with the service, which accounts are connected through.',
  },
];

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'entering'; context?: WindowContext }
  | { name: 'done'; key: UserKey; context?: WindowContext; kind: Kind };

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
      <DonePage @heading='Key saved' @onClose={{@api.close}}>
        {{#if (eq this.done.kind 'oauth-client')}}
          Your OAuth app
          <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
          is saved. Nothing can read its secret back, here or anywhere in Boxel.
          Connect an account through it from your key page.
        {{else}}
          Your key
          <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
          is saved. Nothing can read it back, here or anywhere in Boxel.
        {{/if}}
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
            <RadioChoices
              @label='Kind'
              @icon={{Tag}}
              @name='kind'
              @choices={{KINDS}}
              @selected={{this.form.kind}}
              @onSelect={{this.setKind}}
            />
            {{#if this.suggestsServiceAccount}}
              <p class='kind-hint' data-test-google-destination-hint>
                This request goes to a Google API. If you were given a JSON key
                file for a Google Cloud service account, choose
                <strong>Google service account</strong>; if you have an API key,
                paste it as a key.
              </p>
            {{/if}}
            {{#if this.isOAuthClient}}
              <p class='note' data-test-oauth-github-note>For GitHub, register a
                GitHub App, not an OAuth App: an OAuth App’s only
                private-repository scope can write.</p>
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
                @valueLabel={{if this.isOAuthClient 'Client secret'}}
              >
                <:beforeValue>
                  {{#if this.isOAuthClient}}
                    <FieldContainer
                      @tag='label'
                      @label='Client ID'
                      @icon={{RectangleEllipsis}}
                      data-test-key-field='client-id'
                    >
                      <BoxelInput
                        @type='text'
                        @autocomplete='off'
                        @placeholder='The app’s client ID, from the service'
                        @value={{this.form.clientId}}
                        @onInput={{this.setClientId}}
                        name='client-id'
                        spellcheck='false'
                        data-test-oauth-client-id-input
                      />
                    </FieldContainer>
                  {{/if}}
                </:beforeValue>
              </KeyFields>
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
            {{#if this.isOAuthClient}}
              <OAuthClientFields
                @form={{this.form.oauth}}
                @onChange={{this.setOAuth}}
              />
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
      .note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
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
    kind: 'static' as Kind,
    name: '',
    value: '',
    clientId: '',
    oauth: trackedObject<OAuthClientForm>({
      grantType: 'authorization_code',
      authorizeUrl: '',
      tokenUrl: '',
      scopes: '',
      tokenAuth: 'client_secret_post',
      apiHosts: '',
    }),
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

  private get isOAuthClient() {
    return this.form.kind === 'oauth-client';
  }

  private serviceAccount = new ServiceAccountEntry();

  private get isServiceAccount() {
    return this.form.kind === 'google-service-account';
  }

  // A service account's key file pasted as a secret. It can't be saved
  // there; the page offers to take it as a service account.
  private get pastedKeyFile() {
    return (
      this.form.kind === 'static' && isServiceAccountKeyFile(this.form.value)
    );
  }

  // Opened for an operation that sends to a Google API, the page says when a
  // service account fits. It doesn't choose one: Google's APIs take plain API
  // keys too.
  private get suggestsServiceAccount() {
    return (
      this.form.kind === 'static' &&
      isGoogleAPIHost(this.entering?.context?.operation?.destination?.host)
    );
  }

  private usePastedKeyFile = () => {
    let text = this.form.value;
    this.setKind('google-service-account');
    this.serviceAccount.readText(text, 'the pasted key file');
  };

  private clearError = () => {
    this.form.error = undefined;
  };

  private get submitDisabled() {
    let { saving, name, value, clientId, oauth } = this.form;
    if (saving || !name.trim()) {
      return true;
    }
    if (this.isServiceAccount) {
      return !this.serviceAccount.value;
    }
    if (!value || this.pastedKeyFile) {
      return true;
    }
    return (
      this.isOAuthClient &&
      (!clientId.trim() ||
        !oauth.tokenUrl.trim() ||
        (oauth.grantType === 'authorization_code' &&
          !oauth.authorizeUrl.trim()))
    );
  }

  // What the realm server is told of an OAuth app beside its secret. The
  // authorization URL goes only with a grant people sign in through.
  private get oauthSettings(): OAuthClientSettings {
    let { clientId, oauth } = this.form;
    let scopes = oauth.scopes.trim();
    let apiHosts = oauth.apiHosts
      .split('\n')
      .map((host) => host.trim())
      .filter(Boolean);
    return {
      clientId: clientId.trim(),
      grantType: oauth.grantType,
      ...(oauth.grantType === 'authorization_code'
        ? { authorizeUrl: oauth.authorizeUrl.trim() }
        : {}),
      tokenUrl: oauth.tokenUrl.trim(),
      ...(scopes ? { scopes } : {}),
      tokenAuth: oauth.tokenAuth,
      ...(apiHosts.length > 0 ? { apiHosts } : {}),
    };
  }

  // Switching kinds drops a value or key file entered for another kind, so
  // nothing entered for one is sent as another.
  private setKind = (value: string) => {
    this.form.kind = value as Kind;
    this.form.value = '';
    this.serviceAccount.clear();
    this.form.error = undefined;
  };

  private setClientId = (value: string) => {
    this.form.clientId = value;
    this.form.error = undefined;
  };

  private setOAuth = (field: OAuthClientField, value: string) => {
    (this.form.oauth as unknown as Record<string, string>)[field] = value;
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
    if (this.submitDisabled) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let kind = this.form.kind;
      let entered: KeyValue | undefined = this.isServiceAccount
        ? this.serviceAccount.value
        : { kind: 'static', value: this.form.value };
      let key =
        kind === 'oauth-client'
          ? await addOAuthClient(this.args.api.config, {
              name: this.form.name.trim(),
              secret: this.form.value,
              oauth: this.oauthSettings,
            })
          : await addKey(this.args.api.config, {
              name: this.form.name.trim(),
              entered: entered!,
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
        kind,
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
