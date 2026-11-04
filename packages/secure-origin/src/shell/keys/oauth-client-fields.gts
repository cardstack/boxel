// What a person enters for an OAuth app, beside its name, client ID and
// client secret, in words that don't assume they know OAuth.
//
// `OAuthProviderChoice` comes first: which site the app is for. GitHub's
// settings are known, so choosing it fills every technical field and shows
// only the steps for creating the app on GitHub and the address to give it.
// For another site, `OAuthClientFields` asks for its settings, each with a
// line saying what it is and where to find it, and keeps how the secret is
// sent under Advanced, set to what most sites take.
//
// The API addresses decide only where connect mode offers the app: where a
// connection's tokens may go is granted when an operation using it is
// approved.
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';

import FieldContainer from '../../components/field-container.gts';
import Globe from '../../components/icons/globe.gts';
import KeyRound from '../../components/icons/key-round.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import BoxelInput from '../../components/input.gts';

import { readConfig } from '../../security/session.js';

import RadioChoices from './radio-choices.gts';

export interface OAuthClientForm {
  provider: 'github' | 'other';
  grantType: 'authorization_code' | 'client_credentials';
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  tokenAuth: 'client_secret_post' | 'client_secret_basic';
  // One per line.
  apiHosts: string;
}

export type OAuthClientField = keyof OAuthClientForm;

// GitHub's settings for a GitHub App people sign in with. A GitHub App's
// permissions are set on GitHub, so it asks for no scopes.
export const GITHUB_SETTINGS = {
  grantType: 'authorization_code',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: '',
  tokenAuth: 'client_secret_post',
  apiHosts: 'https://api.github.com/',
} as const;

const PROVIDERS = [
  {
    value: 'github',
    label: 'GitHub',
    hint: 'Boxel fills in GitHub’s settings for you.',
  },
  {
    value: 'other',
    label: 'Another site',
    hint: 'You enter the site’s settings, from its developer documentation.',
  },
];

const GRANTS = [
  {
    value: 'authorization_code',
    label: 'Each person signs in',
    hint: 'People sign in to their own account on the site, and cards act as them.',
  },
  {
    value: 'client_credentials',
    label: 'Nobody signs in',
    hint: 'Boxel uses the app’s own access, with no person’s account. Only some sites offer this.',
  },
];

const TOKEN_AUTHS = [
  {
    value: 'client_secret_post',
    label: 'With the request',
    hint: 'What most sites expect (client_secret_post).',
  },
  {
    value: 'client_secret_basic',
    label: 'In the request’s login header',
    hint: 'Only if the site’s documentation asks for it (client_secret_basic).',
  },
];

interface Signature {
  Args: {
    form: OAuthClientForm;
    onChange: (field: OAuthClientField, value: string) => void;
  };
}

export default class OAuthClientFields extends Component<Signature> {
  <template>
    <RadioChoices
      @label='Who signs in'
      @icon={{KeyRound}}
      @name='grant'
      @choices={{GRANTS}}
      @selected={{@form.grantType}}
      @onSelect={{this.setGrant}}
    />
    {{#if this.peopleSignIn}}
      <FieldContainer
        @tag='label'
        @label='Sign-in page'
        @icon={{Globe}}
        data-test-key-field='authorize-url'
      >
        <div class='with-hint'>
          <BoxelInput
            @type='url'
            @autocomplete='off'
            @placeholder='https://example.com/oauth/authorize'
            @value={{@form.authorizeUrl}}
            @onInput={{this.setAuthorizeUrl}}
            name='authorize-url'
            spellcheck='false'
            data-test-oauth-authorize-url
          />
          <span class='hint'>The address of the site’s page where people sign
            in. The site’s developer documentation calls it the authorization
            URL.</span>
        </div>
      </FieldContainer>
      <CallbackAddress />
    {{/if}}
    <FieldContainer
      @tag='label'
      @label='Token address'
      @icon={{Globe}}
      data-test-key-field='token-url'
    >
      <div class='with-hint'>
        <BoxelInput
          @type='url'
          @autocomplete='off'
          @placeholder='https://example.com/oauth/token'
          @value={{@form.tokenUrl}}
          @onInput={{this.setTokenUrl}}
          name='token-url'
          spellcheck='false'
          data-test-oauth-token-url
        />
        <span class='hint'>Where Boxel collects access once someone signs in.
          The documentation calls it the token URL.</span>
      </div>
    </FieldContainer>
    <FieldContainer
      @tag='label'
      @label='Permissions'
      @icon={{RectangleEllipsis}}
      data-test-key-field='scopes'
    >
      <div class='with-hint'>
        <BoxelInput
          @type='text'
          @autocomplete='off'
          @placeholder='For example: read:user'
          @value={{@form.scopes}}
          @onInput={{this.setScopes}}
          name='scopes'
          spellcheck='false'
          data-test-oauth-scopes
        />
        <span class='hint'>What the app asks to do, in the site’s own words (its
          documentation calls them scopes), separated by spaces. Leave this
          empty if you chose the app’s permissions on the site.</span>
      </div>
    </FieldContainer>
    <FieldContainer
      @tag='label'
      @label='Used for'
      @icon={{LayoutGrid}}
      data-test-key-field='api-hosts'
      as |labelId|
    >
      <div class='with-hint'>
        <textarea
          aria-labelledby={{labelId}}
          class='api-hosts'
          name='api-hosts'
          rows='2'
          autocomplete='off'
          spellcheck='false'
          placeholder='https://api.example.com/'
          value={{@form.apiHosts}}
          data-test-oauth-api-hosts
          {{on 'input' this.setApiHosts}}
        ></textarea>
        <span class='hint'>The addresses of the site’s API this app is for, one
          per line. When a card needs to reach one of them, Boxel offers this
          app for signing in.</span>
      </div>
    </FieldContainer>
    <details class='advanced' data-test-oauth-advanced>
      <summary>Advanced</summary>
      <RadioChoices
        @label='How Boxel sends the app’s secret'
        @icon={{KeyRound}}
        @name='token-auth'
        @choices={{TOKEN_AUTHS}}
        @selected={{@form.tokenAuth}}
        @onSelect={{this.setTokenAuth}}
      />
    </details>

    <style scoped>
      .with-hint {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .advanced summary {
        cursor: pointer;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .callback {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        margin: 0;
        overflow-wrap: anywhere;
      }
      .callback code {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-sm);
      }
      .hint {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-xs);
      }
      /* BoxelInput's look, for the one field that takes several lines. */
      .api-hosts {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: var(--boxel-form-control-height);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        border-radius: var(--boxel-form-control-border-radius);
        box-shadow: var(--boxel-form-control-box-shadow);
        outline: 1px solid transparent;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        resize: vertical;
      }
      .api-hosts:focus-visible {
        outline-color: var(--ring, var(--boxel-highlight));
        border-color: var(--ring, var(--boxel-highlight));
      }
      .api-hosts::placeholder {
        color: var(--muted-foreground);
      }
    </style>
  </template>

  private get peopleSignIn() {
    return this.args.form.grantType === 'authorization_code';
  }

  private setGrant = (value: string) => this.args.onChange('grantType', value);
  private setAuthorizeUrl = (value: string) =>
    this.args.onChange('authorizeUrl', value);
  private setTokenUrl = (value: string) =>
    this.args.onChange('tokenUrl', value);
  private setScopes = (value: string) => this.args.onChange('scopes', value);
  private setTokenAuth = (value: string) =>
    this.args.onChange('tokenAuth', value);
  private setApiHosts = (event: Event) =>
    this.args.onChange('apiHosts', (event.target as HTMLTextAreaElement).value);
}

// Where the site sends people back after they sign in: the realm server's own
// callback. The site must be told it, so it is shown to copy.
function callbackAddress(): string {
  try {
    return new URL('_oauth/callback', readConfig().realmServerURL).href;
  } catch {
    return '';
  }
}

const CallbackAddress: TemplateOnlyComponent<{ Args: {} }> = <template>
  <FieldContainer
    @label='Address to give the site'
    @icon={{Globe}}
    data-test-key-field='callback-url'
  >
    <p class='callback'>
      <code data-test-oauth-callback-url>{{(callbackAddress)}}</code>
      <span class='hint'>Paste this into the app’s settings on the site, where
        it asks for a callback URL (sometimes called a redirect URL).</span>
    </p>
  </FieldContainer>
  <style scoped>
    .callback {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-5xs);
      margin: 0;
      overflow-wrap: anywhere;
    }
    .callback code {
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-sm);
    }
    .hint {
      color: var(--muted-foreground, var(--boxel-450));
      font-size: var(--boxel-font-size-xs);
    }
  </style>
</template>;

// Which site the app is for, shown before its name, client ID and secret.
// For GitHub it also says, step by step, how to create the app there, and
// shows the address GitHub needs.
export class OAuthProviderChoice extends Component<{
  Args: {
    form: OAuthClientForm;
    onProvider: (provider: 'github' | 'other') => void;
  };
}> {
  <template>
    <RadioChoices
      @label='Which site'
      @icon={{Globe}}
      @name='provider'
      @choices={{PROVIDERS}}
      @selected={{@form.provider}}
      @onSelect={{this.setProvider}}
    />
    {{#if this.isGitHub}}
      <div class='steps' data-test-oauth-github-steps>
        <p>To let people sign in with GitHub, first create a
          <strong>GitHub App</strong>
          for them to sign in through:</p>
        <ol>
          <li>On GitHub, open Settings, then Developer settings, then GitHub
            Apps, and choose New GitHub App.</li>
          <li>Paste the address below into its Callback URL.</li>
          <li>Under Permissions, allow only reading, for what cards need.</li>
          <li>Create the app, then generate a client secret. Copy the Client ID
            and the client secret into the fields below.</li>
        </ol>
        <p class='hint'>Use a GitHub App, not an OAuth App: an OAuth App can
          read private repositories only if it can change them too.</p>
      </div>
      <CallbackAddress />
    {{/if}}
    <style scoped>
      .steps {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .steps p {
        margin: 0 0 var(--boxel-sp-xs);
      }
      .steps ol {
        margin: 0 0 var(--boxel-sp-xs);
        padding-inline-start: var(--boxel-sp-lg);
      }
      .hint {
        color: var(--muted-foreground, var(--boxel-450));
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>

  private get isGitHub() {
    return this.args.form.provider === 'github';
  }

  private setProvider = (value: string) =>
    this.args.onProvider(value as 'github' | 'other');
}
