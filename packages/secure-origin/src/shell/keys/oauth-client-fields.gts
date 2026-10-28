// The settings of an OAuth app the user registered with a service, entered
// beside its client secret: who signs in through it, its authorization and
// token endpoints, the scopes it asks for, how it presents its secret to the
// token endpoint, and the API hosts it serves, one per line. None of these is
// secret; the client secret is the one value entered masked (`KeyFields`).
// The API hosts decide only where connect mode offers the app: where a
// connection's tokens may go is granted when an operation using it is
// approved.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import FieldContainer from '../../components/field-container.gts';
import Globe from '../../components/icons/globe.gts';
import KeyRound from '../../components/icons/key-round.gts';
import LayoutGrid from '../../components/icons/layout-grid.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import BoxelInput from '../../components/input.gts';

import RadioChoices from './radio-choices.gts';

export interface OAuthClientForm {
  grantType: 'authorization_code' | 'client_credentials';
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  tokenAuth: 'client_secret_post' | 'client_secret_basic';
  // One per line.
  apiHosts: string;
}

export type OAuthClientField = keyof OAuthClientForm;

const GRANTS = [
  {
    value: 'authorization_code',
    label: 'People sign in',
    hint: 'Each person connects their own account through the app.',
  },
  {
    value: 'client_credentials',
    label: 'No person signs in',
    hint: 'The app signs in as itself (client credentials).',
  },
];

const TOKEN_AUTHS = [
  {
    value: 'client_secret_post',
    label: 'In the request body',
    hint: 'client_secret_post, which most services take.',
  },
  {
    value: 'client_secret_basic',
    label: 'As HTTP Basic authentication',
    hint: 'client_secret_basic.',
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
        @label='Authorization URL'
        @icon={{Globe}}
        data-test-key-field='authorize-url'
      >
        <BoxelInput
          @type='url'
          @autocomplete='off'
          @placeholder='https://github.com/login/oauth/authorize'
          @value={{@form.authorizeUrl}}
          @onInput={{this.setAuthorizeUrl}}
          name='authorize-url'
          spellcheck='false'
          data-test-oauth-authorize-url
        />
      </FieldContainer>
    {{/if}}
    <FieldContainer
      @tag='label'
      @label='Token URL'
      @icon={{Globe}}
      data-test-key-field='token-url'
    >
      <BoxelInput
        @type='url'
        @autocomplete='off'
        @placeholder='https://github.com/login/oauth/access_token'
        @value={{@form.tokenUrl}}
        @onInput={{this.setTokenUrl}}
        name='token-url'
        spellcheck='false'
        data-test-oauth-token-url
      />
    </FieldContainer>
    <FieldContainer
      @tag='label'
      @label='Scopes'
      @icon={{RectangleEllipsis}}
      data-test-key-field='scopes'
    >
      <BoxelInput
        @type='text'
        @autocomplete='off'
        @placeholder='Separated by spaces, as the service lists them'
        @value={{@form.scopes}}
        @onInput={{this.setScopes}}
        name='scopes'
        spellcheck='false'
        data-test-oauth-scopes
      />
    </FieldContainer>
    <RadioChoices
      @label='How it sends its secret'
      @icon={{KeyRound}}
      @name='token-auth'
      @choices={{TOKEN_AUTHS}}
      @selected={{@form.tokenAuth}}
      @onSelect={{this.setTokenAuth}}
    />
    <FieldContainer
      @tag='label'
      @label='API hosts'
      @icon={{LayoutGrid}}
      data-test-key-field='api-hosts'
      as |labelId|
    >
      <textarea
        aria-labelledby={{labelId}}
        class='api-hosts'
        name='api-hosts'
        rows='3'
        autocomplete='off'
        spellcheck='false'
        placeholder='One per line, such as https://api.github.com/'
        value={{@form.apiHosts}}
        data-test-oauth-api-hosts
        {{on 'input' this.setApiHosts}}
      ></textarea>
    </FieldContainer>

    <style scoped>
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
