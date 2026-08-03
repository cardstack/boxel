import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import { BoxelInput, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { GoogleColor } from '@cardstack/boxel-ui/icons';

import ENV from '@cardstack/host/config/environment';
import { cliAuthLoopbackUrl } from '@cardstack/host/lib/cli-auth-loopback';
import type MatrixService from '@cardstack/host/services/matrix-service';

import AuthButton from './auth-button';
import AuthFormField from './auth-form-field';

const { matrixURL } = ENV;
const GOOGLE_IDP_ID = 'oidc-google';

interface MatrixLoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

// The page boxel-cli opens to authorize a machine. It offers the same two
// choices as the web sign-in, and each finishes by handing a session to the
// loopback listener the CLI is holding open:
//
//   Google   — Synapse redirects there itself with a single-use login token,
//              which the CLI redeems.
//   Password — this page signs in against the homeserver, producing a device
//              that belongs to the CLI, and POSTs it over.
//
// Nothing here touches the browser's own session: the credential produced is
// the CLI's, and this app stays signed in (or out) exactly as it was.
export default class CliAuth extends Component {
  <template>
    <div class='cli-auth'>
      {{#if this.redirectError}}
        <div class='panel' data-test-cli-auth-error>
          <h1 class='title'>Can't authorize</h1>
          <p class='body'>{{this.redirectError}}</p>
        </div>
      {{else if this.completed}}
        <div class='panel' data-test-cli-auth-complete>
          <h1 class='title'>Authorized</h1>
          <p class='body'>Return to your terminal to continue.</p>
        </div>
      {{else}}
        <div class='panel'>
          <h1 class='title'>Authorize Boxel CLI</h1>
          <p class='body'>Signing in here gives the Boxel CLI running on this
            computer access to your workspaces.</p>

          {{#if this.googleSsoAvailable}}
            <AuthButton
              class='google-button'
              data-test-cli-auth-google
              @loading={{this.startGoogleSso.isRunning}}
              {{on 'click' this.googleSso}}
            >
              <GoogleColor class='google-g' aria-hidden='true' />
              Continue with Google
            </AuthButton>
            <div class='divider'><span>or</span></div>
          {{/if}}

          <form data-test-cli-auth-form {{on 'submit' this.submitPassword}}>
            <AuthFormField @label='Email Address or Username'>
              <BoxelInput
                data-test-cli-auth-username
                type='text'
                id='boxel-cli-auth-username'
                name='username'
                autocomplete='username'
                @value={{this.username}}
                @onInput={{this.setUsername}}
              />
            </AuthFormField>
            <AuthFormField @label='Password'>
              <BoxelInput
                data-test-cli-auth-password
                type='password'
                id='boxel-cli-auth-password'
                name='password'
                autocomplete='current-password'
                @value={{this.password}}
                @onInput={{this.setPassword}}
              />
            </AuthFormField>
            {{#if this.error}}
              <div
                class='error'
                data-test-cli-auth-form-error
              >{{this.error}}</div>
            {{/if}}
            <AuthButton
              data-test-cli-auth-submit
              @loading={{this.doPasswordLogin.isRunning}}
              type='submit'
            >
              {{#if this.doPasswordLogin.isRunning}}
                <LoadingIndicator />
              {{else}}
                Sign in
              {{/if}}
            </AuthButton>
          </form>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .cli-auth {
        display: flex;
        justify-content: center;
        padding: var(--boxel-sp-xxl) var(--boxel-sp);
      }
      .panel {
        width: 100%;
        max-width: 24rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .title {
        font: 600 var(--boxel-font-lg);
        margin: 0;
      }
      .body {
        color: var(--boxel-450);
        margin: 0;
      }
      .divider {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-450);
      }
      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        border-top: 1px solid var(--boxel-300);
      }
      .google-g {
        width: 1rem;
        height: 1rem;
      }
      .error {
        color: var(--boxel-error-100);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>

  @service declare private matrixService: MatrixService;

  @tracked private username = '';
  @tracked private password = '';
  @tracked private error: string | undefined;
  @tracked private googleSsoAvailable = false;
  @tracked private completed = false;

  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    this.detectGoogleSso.perform();
  }

  // Where the result goes: loopback on this machine, on the port the CLI named.
  private get redirect(): string | undefined {
    let params = new URLSearchParams(window.location.search);
    return cliAuthLoopbackUrl(params.get('port'), params.get('state'));
  }

  private get redirectError(): string | undefined {
    if (!this.redirect) {
      return 'This page needs the listening port and request id that the Boxel CLI supplies. Start it with `boxel profile add`.';
    }
    return undefined;
  }

  @action private setUsername(value: string) {
    this.username = value;
    this.error = undefined;
  }

  @action private setPassword(value: string) {
    this.password = value;
    this.error = undefined;
  }

  @action private googleSso(ev: Event) {
    ev.preventDefault();
    this.startGoogleSso.perform();
  }

  @action private submitPassword(ev: Event) {
    ev.preventDefault();
    this.doPasswordLogin.perform();
  }

  private detectGoogleSso = restartableTask(async () => {
    try {
      let { flows } = await this.matrixService.loginFlows();
      this.googleSsoAvailable = flows.some(
        (f: any) =>
          f.type === 'm.login.sso' &&
          Array.isArray(f.identity_providers) &&
          f.identity_providers.some((p: any) => p.id === GOOGLE_IDP_ID),
      );
    } catch {
      this.googleSsoAvailable = false;
    }
  });

  // Hand the loopback URL to Synapse as the SSO redirect target, so the login
  // token lands on the CLI rather than coming back through this page.
  private startGoogleSso = restartableTask(async () => {
    let redirect = this.redirect;
    if (!redirect) {
      return;
    }
    try {
      let url = await this.matrixService.getSsoLoginUrl(
        redirect,
        GOOGLE_IDP_ID,
      );
      window.location.assign(url);
    } catch (e: any) {
      this.error = `Could not start Google sign-in: ${e.message}`;
    }
  });

  private doPasswordLogin = restartableTask(async () => {
    let redirect = this.redirect;
    if (!redirect || !this.username || !this.password) {
      this.error = 'Enter your username and password.';
      return;
    }

    let response = await fetch(
      new URL('_matrix/client/v3/login', matrixURL).href,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'm.login.password',
          identifier: { type: 'm.id.user', user: this.username },
          password: this.password,
        }),
      },
    );
    let json = (await response.json()) as MatrixLoginResponse & {
      error?: string;
    };
    if (!response.ok) {
      this.error = json.error ?? `Sign-in failed (${response.status}).`;
      return;
    }

    this.completed = true;
    this.deliver(redirect, json);
  });

  // A form POST rather than fetch: the CLI's listener is on a private address,
  // and a top-level navigation isn't subject to the private-network preflight
  // a cross-origin subresource request would need. It also keeps the access
  // token out of a URL.
  private deliver(redirect: string, session: MatrixLoginResponse) {
    let state = new URL(redirect).searchParams.get('state') ?? '';
    let form = window.document.createElement('form');
    form.method = 'POST';
    form.action = redirect;
    for (let [name, value] of Object.entries({
      state,
      access_token: session.access_token,
      device_id: session.device_id,
      user_id: session.user_id,
    })) {
      let input = window.document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    window.document.body.appendChild(form);
    form.submit();
  }
}
