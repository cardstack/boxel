import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import window from 'ember-window-mock';

import { BoxelInput, Button } from '@cardstack/boxel-ui/components';
import { GoogleColor } from '@cardstack/boxel-ui/icons';

import ENV from '@cardstack/host/config/environment';
import { cliAuthLoopbackUrl } from '@cardstack/host/lib/cli-auth-loopback';
import type MatrixService from '@cardstack/host/services/matrix-service';

import AuthButton from './auth-button';
import AuthContainer from './auth-container';
import AuthFormField from './auth-form-field';
import ForgotPassword from './forgot-password';
import RegisterUser from './register-user';

import type { AuthMode } from './auth';
import type { ResetPasswordParams } from './forgot-password';
import type { LoginResponse } from 'matrix-js-sdk';

const { matrixURL } = ENV;
const GOOGLE_IDP_ID = 'oidc-google';

interface MatrixLoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

interface LoginFlow {
  type: string;
  identity_providers?: { id: string }[];
}

// The page boxel-cli opens to authorize a machine. It offers the same choices
// as the web sign-in, and each finishes by handing a session to the loopback
// listener the CLI is holding open:
//
//   Google   — Synapse redirects there itself with a single-use login token,
//              which the CLI redeems.
//   Password — this page signs in against the homeserver, producing a device
//              that belongs to the CLI, and POSTs it over.
//   Register — a brand-new user signs up through the same <RegisterUser> flow
//              the web app uses (email verification, invite token, personal
//              realm bootstrap); the device registration mints is POSTed over.
//
// Nothing here touches the browser's own session: the credential produced is
// the CLI's, and this app stays signed in (or out) exactly as it was.
export default class CliAuth extends Component {
  <template>
    <AuthContainer>
      {{#if this.redirectError}}
        <span class='title'>Can't authorize</span>
        <p class='subtitle' data-test-cli-auth-error>{{this.redirectError}}</p>
      {{else if this.completed}}
        <span class='title'>You're signed in</span>
        <p class='subtitle' data-test-cli-auth-complete>Return to your terminal
          to continue. You can close this tab.</p>
      {{else if this.showingPasswordReset}}
        <ForgotPassword
          @setMode={{this.setMode}}
          @nullifyResetPasswordParams={{this.nullifyResetPasswordParams}}
          @resetPasswordParams={{this.resetPasswordParams}}
        />
      {{else if this.registering}}
        <span class='title'>Authorize Boxel CLI</span>
        <p class='subtitle'>Create a Boxel account to give the Boxel CLI running
          on this computer access to your workspaces.</p>
        <RegisterUser
          @setMode={{this.setMode}}
          @onComplete={{this.onRegisterComplete}}
        />
      {{else}}
        <span class='title'>Authorize Boxel CLI</span>
        {{#if this.signedInUserId}}
          <p class='subtitle'>Confirm your password to give the Boxel CLI
            running on this computer access to the workspaces of
            <span
              class='signed-in-user'
              data-test-cli-auth-signed-in-as
            >{{this.signedInUserId}}</span>.</p>
        {{else}}
          <p class='subtitle'>Signing in gives the Boxel CLI running on this
            computer access to your workspaces.</p>
        {{/if}}
        {{#if this.resumedFromEmail}}
          <p class='notice' data-test-cli-auth-resumed>The CLI stops waiting
            after 15 minutes. If signing in doesn't reach it, run
            <code>boxel profile add</code>
            again.</p>
        {{/if}}
        <form data-test-cli-auth-form {{on 'submit' this.submitPassword}}>
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
            <div class='divider' aria-hidden='true'>
              <span class='divider-label'>or use your email</span>
            </div>
          {{/if}}
          <AuthFormField @label='Email Address or Username'>
            <BoxelInput
              data-test-cli-auth-username
              type='text'
              id='boxel-cli-auth-username'
              name='username'
              autocomplete='username'
              @value={{this.username}}
              @onInput={{this.setUsername}}
              @onKeyPress={{this.handleEnter}}
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
              @onKeyPress={{this.handleEnter}}
            />
          </AuthFormField>
          <Button
            type='button'
            class='forgot-password'
            @kind='link-muted'
            @size='extra-small'
            data-test-cli-auth-forgot-password
            {{on 'click' this.startPasswordReset}}
          >Forgot password?</Button>
          <AuthButton
            data-test-cli-auth-submit
            @variant='primary'
            @disabled={{this.isSubmitDisabled}}
            @loading={{this.doPasswordLogin.isRunning}}
            {{on 'click' this.submitPassword}}
          >Sign In</AuthButton>
          {{#if this.error}}
            <div
              class='error'
              data-test-cli-auth-form-error
            >{{this.error}}</div>
          {{/if}}
          <p class='register-prompt'>
            <span class='register-prompt-text'>Don't have an account?</span>
            <Button
              type='button'
              class='register-link'
              @kind='link-primary'
              data-test-cli-auth-register
              {{on 'click' this.startRegister}}
            >Create a new Boxel account</Button>
          </p>
        </form>
      {{/if}}
    </AuthContainer>

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
      }
      .title {
        font: 600 var(--boxel-font-md);
        color: var(--foreground);
        margin-bottom: var(--boxel-sp-sm);
        padding: 0;
      }
      .subtitle {
        margin: 0 0 var(--boxel-sp-lg);
        color: var(--foreground);
        font: var(--boxel-font-sm);
        line-height: 1.4;
      }
      .signed-in-user {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .notice {
        margin: 0 0 var(--boxel-sp-lg);
        color: var(--muted-foreground);
        font: var(--boxel-font-xs);
        line-height: 1.4;
      }
      .notice code {
        font-family: var(--boxel-monospace-font-family, monospace);
      }
      .forgot-password {
        --host-outline-offset: 2px;
        margin-top: var(--boxel-sp-4xs);
        margin-bottom: var(--boxel-sp-lg);
        margin-left: auto;
      }
      .google-button {
        margin-top: var(--boxel-sp-sm);
        gap: var(--boxel-sp-xs);
      }
      .google-g {
        width: 1.125rem;
        height: 1.125rem;
        flex-shrink: 0;
      }
      .divider {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin: var(--boxel-sp-lg) 0 var(--boxel-sp-xs);
      }
      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background-color: rgba(255, 255, 255, 0.18);
      }
      .divider-label {
        color: var(--muted-foreground);
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-lg);
        text-transform: uppercase;
      }
      .error {
        color: var(--boxel-error-100);
        padding: 0;
        font: 500 var(--boxel-font-xs);
        margin: var(--boxel-sp-2xs) auto 0 auto;
      }
      .register-prompt {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--boxel-sp-3xs);
        margin: var(--boxel-sp) 0 0;
        font: 500 var(--boxel-font-sm);
      }
      .register-prompt-text {
        color: var(--muted-foreground);
      }
      .register-link {
        --host-outline-offset: 2px;
      }
    </style>
  </template>

  @service declare private matrixService: MatrixService;

  @tracked private username = '';
  @tracked private password = '';
  @tracked private error: string | undefined;
  @tracked private googleSsoAvailable = false;
  @tracked private completed = false;
  @tracked private registering = false;
  @tracked private resettingPassword = false;
  @tracked private resetPasswordParams: ResetPasswordParams | undefined;
  // True when this page load came from a reset email, which means the CLI has
  // been waiting since before the email was sent and may have given up.
  @tracked private resumedFromEmail = false;

  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    this.detectGoogleSso.perform();
    // Whoever this browser is signed in as is overwhelmingly who they mean to
    // authorize, so fill it in — while leaving it editable, since authorizing a
    // different account is a legitimate thing to want. The password still has to
    // be given: it is what mints the CLI a device of its own.
    let localpart = this.signedInUserId?.replace(/^@/, '').split(':')[0];
    if (localpart) {
      this.username = localpart;
    }

    // A reset email links back to this same page, carrying the callback port and
    // nonce it was requested with — so finishing a reset can hand the waiting
    // CLI its session without the user starting over.
    let params = new URLSearchParams(window.location.search);
    let sid = params.get('sid');
    let clientSecret = params.get('clientSecret');
    if (sid && clientSecret) {
      this.resetPasswordParams = { sid, clientSecret };
      this.resumedFromEmail = true;
    }
  }

  private get showingPasswordReset() {
    return this.resettingPassword || Boolean(this.resetPasswordParams);
  }

  // ForgotPassword and RegisterUser speak in AuthMode, where 'login' means
  // "done here — return to the sign-in form". This page reads the other modes
  // as which panel to show instead. The password form is the 'login' state.
  @action private setMode(mode: AuthMode) {
    this.registering = mode === 'register';
    this.resettingPassword = mode === 'forgot-password';
  }

  @action private startRegister(ev: Event) {
    ev.preventDefault();
    this.registering = true;
  }

  // Registration bootstrapped a full account and minted one device; hand that
  // device to the CLI, and forget it locally so this browser doesn't keep it as
  // its own session (see MatrixService.forgetPersistedSession). The port and
  // nonce are still in the URL, so `redirect` resolves exactly as it did before
  // switching into register mode.
  @action private onRegisterComplete(session: LoginResponse) {
    let redirect = this.redirect;
    if (!redirect) {
      return;
    }
    this.completed = true;
    this.matrixService.forgetPersistedSession();
    this.deliver(redirect, session);
  }

  @action private nullifyResetPasswordParams() {
    this.resetPasswordParams = undefined;
    // Drop them from the URL too, so a refresh doesn't re-enter a reset that has
    // already been consumed. The port and nonce stay, since the CLI may still be
    // waiting on them.
    let url = new URL(window.location.href);
    url.searchParams.delete('sid');
    url.searchParams.delete('clientSecret');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  @action private startPasswordReset(ev: Event) {
    ev.preventDefault();
    this.resettingPassword = true;
  }

  private get signedInUserId(): string | undefined {
    return this.matrixService.persistedUserId;
  }

  // Where the result goes: loopback on this machine, on the port the CLI named.
  private get redirect(): string | undefined {
    let params = new URLSearchParams(window.location.search);
    return cliAuthLoopbackUrl(params.get('port'), params.get('state'));
  }

  private get redirectError(): string | undefined {
    if (!this.redirect) {
      return 'This page needs the `port` and `state` values that the Boxel CLI puts in its URL. Start it with `boxel profile add`.';
    }
    return undefined;
  }

  private get isSubmitDisabled() {
    return !this.username || !this.password;
  }

  @action private handleEnter(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      this.submitPassword(ev);
    }
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

  // Asked of the homeserver directly rather than through MatrixService, whose
  // `ready` waits on the card and file API modules to load from the realm
  // server. This page is standalone sign-in machinery — it should not need the
  // rest of the app running to decide whether to offer Google, and going through
  // the service meant a realm server that wasn't up left the button silently
  // missing rather than failing.
  private detectGoogleSso = restartableTask(async () => {
    try {
      let response = await fetch(
        new URL('_matrix/client/v3/login', matrixURL).href,
      );
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      let { flows } = (await response.json()) as { flows?: LoginFlow[] };
      this.googleSsoAvailable = (flows ?? []).some(
        (flow) =>
          flow.type === 'm.login.sso' &&
          (flow.identity_providers ?? []).some((p) => p.id === GOOGLE_IDP_ID),
      );
    } catch (e: any) {
      // Non-fatal: the password form still works. Say so rather than leaving a
      // missing button to be puzzled over.
      console.warn(
        `Could not read login flows from ${matrixURL}, so Google sign-in is not being offered:`,
        e,
      );
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
    let url = new URL(
      `_matrix/client/v3/login/sso/redirect/${encodeURIComponent(GOOGLE_IDP_ID)}`,
      matrixURL,
    );
    url.searchParams.set('redirectUrl', redirect);
    window.location.assign(url.href);
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
  private deliver(redirect: string, session: LoginResponse) {
    let state = new URL(redirect).searchParams.get('state') ?? '';
    let form = window.document.createElement('form');
    form.method = 'POST';
    form.action = redirect;
    for (let [name, value] of Object.entries({
      state,
      access_token: session.access_token,
      // Always present for both the password login and the registration device;
      // `?? ''` only narrows away LoginResponse's optional typing.
      device_id: session.device_id ?? '',
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
