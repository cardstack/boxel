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
// Opened for an operation, the page asks only for the kinds of key the
// operation's `userKey` slots take, as the realm server says (the card's
// declared `keyKind`, or what fits where the slot stands). One kind is asked
// for without a choice; when that is a sign-in app, the page also offers the
// `connect` page, for an app that is set up already. Opened for nothing, or
// for an operation that leaves several kinds open, the user chooses. What
// tells a secret and a service account apart is then what the user has in
// hand, not the service: Google's own APIs take plain API keys too. So each
// kind says what it is for; a service account's key file pasted as a secret
// is caught and offered as a service account; and a window opened for an
// operation that sends to a Google API says when a service account fits,
// without choosing one.
//
// A key that can be sent in a card's request, a secret or a service account,
// also says whether people who aren't signed in may use it: its owner's
// decision about the key itself, not about any one workspace. Ticked, they
// can use it wherever a workspace it is shared into lets them use its cards,
// up to optional anonymous caps on their calls a day and a month, all
// together, across every such workspace. It can be changed later on the key
// page. An OAuth app isn't asked: people connect their own accounts through
// it.
//
// This is the one page a new key's value is typed into. Reached from the key
// page, at `keys/add`, it goes back there once the key is added, rather than
// closing the window. Reached from the approve page's "Add a new key"
// (`then=approve` or `then=review-changes` beside what that page was opened
// for), it goes back to that page with the new key chosen.
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

import AnonymousUseFields, { anonymousCapOf } from './anonymous-use-fields.gts';
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
  GITHUB_SETTINGS,
  OAuthProviderChoice,
  type OAuthClientField,
  type OAuthClientForm,
} from './oauth-client-fields.gts';
import OpenedForSummary from './opened-for-summary.gts';
import {
  cliOpenedFor,
  contextRequest,
  openedFor,
  returnsToKeyPage,
} from './opened-for.ts';
import RadioChoices, { type RadioChoice } from './radio-choices.gts';
import { ServiceAccountEntry } from './service-account-entry.ts';
import ServiceAccountFields from './service-account-fields.gts';
import {
  isGoogleAPIHost,
  isServiceAccountKeyFile,
} from './service-account-key-file.ts';

type Kind = 'static' | 'google-service-account' | 'oauth-client';

// Each kind the page adds, with the kind of key the realm server says a slot
// takes (`slotKind`) and the article its label reads with in a sentence.
const KINDS: (RadioChoice & {
  value: Kind;
  slotKind: string;
  article: string;
})[] = [
  {
    value: 'static',
    slotKind: 'static',
    article: 'an',
    label: 'API key or token',
    hint: 'A key or token you copy from the service and paste here, such as a GitHub token or a Google Maps API key.',
  },
  {
    value: 'google-service-account',
    slotKind: 'google-service-account',
    article: 'a',
    label: 'Google service account',
    hint: 'For Google APIs such as Sheets and Drive, when you have a service account’s key file (a .json file from Google Cloud). Boxel sends Google a short-lived token made from it, never the file itself.',
  },
  {
    value: 'oauth-client',
    slotKind: 'oauth',
    article: 'a',
    label: 'Sign-in app (OAuth)',
    hint: 'Lets people sign in with their own account on a site such as GitHub, instead of pasting a key. You create the app in that site’s developer settings, and it gives you a client ID and secret to enter here.',
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
          Your sign-in app
          <strong data-test-keys-done-name>{{this.done.key.name}}</strong>
          is saved. Nothing can read its secret back, here or anywhere in Boxel.
          To use it, choose Connect an account on your key page.
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
            {{#if this.onlyKind}}
              <p class='kind-hint' data-test-only-kind={{this.onlyKind.value}}>
                {{this.cardName}}
                needs
                {{this.onlyKind.article}}
                <strong>{{this.onlyKind.label}}</strong>.
                {{this.onlyKind.hint}}
              </p>
              {{#if this.isOAuthClient}}
                <div class='kind-hint' data-test-connect-instead>
                  <p>If a sign-in app for this site is set up already, connect
                    your account through it instead.</p>
                  <Button
                    type='button'
                    @kind='secondary'
                    @size='small'
                    data-test-go-to-connect
                    {{on 'click' this.goToConnect}}
                  >Connect an account</Button>
                </div>
              {{/if}}
            {{else}}
              <RadioChoices
                @label='Kind'
                @icon={{Tag}}
                @name='kind'
                @choices={{this.kindChoices}}
                @selected={{this.form.kind}}
                @onSelect={{this.setKind}}
              />
            {{/if}}
            {{#if this.suggestsServiceAccount}}
              <p class='kind-hint' data-test-google-destination-hint>
                This request goes to a Google API. If you were given a JSON key
                file for a Google Cloud service account, choose
                <strong>Google service account</strong>; if you have an API key,
                paste it as a key.
              </p>
            {{/if}}
            {{#if this.isOAuthClient}}
              <OAuthProviderChoice
                @form={{this.form.oauth}}
                @onProvider={{this.setProvider}}
              />
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
                        @placeholder='The app’s Client ID, shown on the site'
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
                  {{#if this.takesServiceAccount}}
                    <Button
                      type='button'
                      @kind='secondary'
                      @size='small'
                      data-test-use-service-account
                      {{on 'click' this.usePastedKeyFile}}
                    >Use it as a Google service account</Button>
                  {{else}}
                    <p>{{this.cardName}}
                      needs a key or token sent as it is, not a service account.</p>
                  {{/if}}
                </div>
              {{/if}}
            {{/if}}
            {{#if this.otherProvider}}
              <OAuthClientFields
                @form={{this.form.oauth}}
                @onChange={{this.setOAuth}}
              />
            {{/if}}
            {{#unless this.isOAuthClient}}
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
            {{/unless}}
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
    // Whether people who aren't signed in may use the key, and its anonymous
    // caps as typed.
    anonymous: false,
    cap: '',
    monthlyCap: '',
    oauth: trackedObject<OAuthClientForm>({
      provider: 'github',
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
      // The page starts on the first kind the operation takes.
      let [first] = this.kindChoices;
      if (first && first.value !== this.form.kind) {
        this.setKind(first.value);
      }
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

  // Connecting an account through an app that is set up already is the
  // `connect` page's, opened for the same card and operation.
  private goToConnect = () => {
    let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    fragment.delete('then');
    fragment.delete('after');
    navigation.assign(`${pageURL('connect')}#${fragment}`);
  };

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

  // The kinds the page offers: those the operation's `userKey` slots take, as
  // the realm server says, or every kind when it says nothing of them.
  private get kindChoices() {
    let slots = (this.entering?.context?.operation?.slots ?? []).filter(
      (slot) => slot.key === 'userKey' && slot.kinds,
    );
    if (slots.length === 0) {
      return KINDS;
    }
    let taken = new Set(slots.flatMap((slot) => slot.kinds!));
    let choices = KINDS.filter((kind) => taken.has(kind.slotKind));
    return choices.length > 0 ? choices : KINDS;
  }

  // The one kind the operation takes, asked for without a choice.
  private get onlyKind() {
    let choices = this.kindChoices;
    return choices.length === 1 ? choices[0] : undefined;
  }

  private get takesServiceAccount() {
    return this.kindChoices.some(
      (kind) => kind.value === 'google-service-account',
    );
  }

  private get cardName() {
    return this.entering?.context?.card?.name ?? 'This card';
  }

  // Opened for an operation that sends to a Google API, the page says when a
  // service account fits. It doesn't choose one: Google's APIs take plain API
  // keys too.
  private get suggestsServiceAccount() {
    return (
      this.form.kind === 'static' &&
      this.takesServiceAccount &&
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
    if (
      this.anonymousCap === undefined ||
      this.anonymousMonthlyCap === undefined
    ) {
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
        (oauth.provider === 'other' &&
          (!oauth.tokenUrl.trim() ||
            (oauth.grantType === 'authorization_code' &&
              !oauth.authorizeUrl.trim()))))
    );
  }

  private get otherProvider() {
    return this.isOAuthClient && this.form.oauth.provider === 'other';
  }

  // What the realm server is told of an OAuth app beside its secret. The
  // authorization URL goes only with a grant people sign in through.
  private get oauthSettings(): OAuthClientSettings {
    let { clientId } = this.form;
    // GitHub's settings are known; another site's are what was entered.
    let oauth =
      this.form.oauth.provider === 'github'
        ? { ...this.form.oauth, ...GITHUB_SETTINGS }
        : this.form.oauth;
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

  private setProvider = (provider: 'github' | 'other') => {
    this.form.oauth.provider = provider;
    this.form.error = undefined;
  };

  private setOAuth = (field: OAuthClientField, value: string) => {
    (this.form.oauth as unknown as Record<string, string>)[field] = value;
    this.form.error = undefined;
  };

  // The anonymous caps to send: none for an OAuth app, which isn't asked.
  private get anonymousCap() {
    return this.isOAuthClient
      ? null
      : anonymousCapOf(this.form.anonymous, this.form.cap);
  }

  private get anonymousMonthlyCap() {
    return this.isOAuthClient
      ? null
      : anonymousCapOf(this.form.anonymous, this.form.monthlyCap);
  }

  private toggleAnonymous = () => {
    this.form.anonymous = !this.form.anonymous;
    this.form.error = undefined;
  };

  private setCap = (value: string) => {
    this.form.cap = value;
    this.form.error = undefined;
  };

  private setMonthlyCap = (value: string) => {
    this.form.monthlyCap = value;
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
              anonymous: this.form.anonymous,
              ...(this.anonymousCap != null
                ? { anonymousDailyCap: this.anonymousCap }
                : {}),
              ...(this.anonymousMonthlyCap != null
                ? { anonymousMonthlyCap: this.anonymousMonthlyCap }
                : {}),
            });
      // The value is gone from the page the moment the server has it.
      this.form.value = '';
      this.serviceAccount.clear();
      if (this.returnsToKeyPage) {
        navigation.back(pageURL('keys'));
        return;
      }
      let approval = approvalPageAfter(key.id);
      if (approval) {
        navigation.replace(approval);
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

// The approve page this one was reached from (`then=approve` or
// `then=review-changes`), if any.
function approvalPageThen(): 'approve' | 'review-changes' | undefined {
  let then = new URLSearchParams(window.location.hash.replace(/^#/, '')).get(
    'then',
  );
  return then === 'approve' || then === 'review-changes' ? then : undefined;
}

// The approve page this one was opened from, to go back to once `keyId` is
// added, with what it was opened for and the new key chosen.
function approvalPageAfter(keyId: string): string | undefined {
  let then = approvalPageThen();
  if (!then) {
    return undefined;
  }
  let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  fragment.delete('then');
  // The approve page goes back to the key page it was reached from.
  if (fragment.get('after') === 'keys') {
    fragment.set('then', 'keys');
  }
  fragment.delete('after');
  fragment.set('key', keyId);
  return `${pageURL(then)}#${fragment}`;
}

export default class EnterKeyPage extends Component<{
  Args: { fromKeyPage?: boolean };
}> {
  <template>
    <KeysWindow
      @title='Boxel · Your keys'
      @page='enter-key'
      @cli={{this.cli}}
      as |api|
    >
      <EnterKey @api={{api}} @fromKeyPage={{@fromKeyPage}} />
    </KeysWindow>
  </template>

  // Reached from an approve page the CLI opened, the window is still the
  // CLI's: closing it here cancels the approval.
  private cli = approvalPageThen() ? cliOpenedFor().cli : undefined;
}
